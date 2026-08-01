import type { ProbeContext } from "./types";

/**
 * Probe a running MCP server over HTTP and normalize what we observe.
 *
 * This is deliberately conservative: it sends one legacy-style `initialize`
 * JSON-RPC request and inspects the response headers and advertised
 * capabilities, then makes a best-effort check for OAuth protected-resource
 * metadata. It never sends anything destructive.
 */

const INITIALIZE_BODY = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "mcpcheck", version: "0.1.0" },
  },
};

export interface ProbeOptions {
  timeoutMs?: number;
  /** Injected for testing; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Stop reading a response body past this many bytes. */
  maxBodyBytes?: number;
}

/**
 * We only need the head of the response to find the initialize result, but the
 * endpoint is untrusted and can reply with anything. On a constrained runtime
 * (Cloudflare Workers gives a request 10ms of CPU) an unbounded `res.text()`
 * is a denial-of-service handed to us by a stranger.
 */
const DEFAULT_MAX_BODY_BYTES = 256 * 1024;

export async function probeEndpoint(
  url: string,
  opts: ProbeOptions = {},
): Promise<ProbeContext> {
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 8000;

  const base: ProbeContext = {
    reachable: false,
    sessionIdHeaderPresent: false,
    respondsToInitialize: false,
    advertisedCapabilities: [],
    authRequired: false,
    oauthResourceMetadata: false,
  };

  let wwwAuthenticate: string | null = null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await doFetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(INITIALIZE_BODY),
      signal: controller.signal,
    });

    base.reachable = true;
    base.sessionIdHeaderPresent = res.headers.has("mcp-session-id");

    wwwAuthenticate = res.headers.get("www-authenticate");
    if (res.status === 401 || wwwAuthenticate !== null) {
      base.authRequired = true;
    }

    const text = await readCapped(
      res,
      opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
    ).catch(() => "");
    const payload = parseMaybeSse(text);
    if (payload && payload.result) {
      base.respondsToInitialize = true;
      const caps = payload.result.capabilities;
      if (caps && typeof caps === "object") {
        base.advertisedCapabilities = Object.keys(caps);
      }
    }
  } catch (err) {
    base.rawError = err instanceof Error ? err.message : String(err);
  } finally {
    clearTimeout(timer);
  }

  // Best-effort OAuth 2.1 resource-server metadata check.
  if (base.reachable) {
    base.oauthResourceMetadata = await checkOAuthMetadata(
      url,
      wwwAuthenticate,
      doFetch,
      timeoutMs,
    ).catch(() => false);
  }

  return base;
}

/**
 * Read at most `limit` bytes of the body, then stop and drop the connection.
 * Falls back to `res.text()` only when the runtime gives us no stream.
 */
async function readCapped(res: Response, limit: number): Promise<string> {
  if (!res.body) return res.text();

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  let seen = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      seen += value.byteLength;
      if (seen > limit) {
        const keep = value.subarray(0, value.byteLength - (seen - limit));
        out += decoder.decode(keep);
        break;
      }
      out += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  return out;
}

/** MCP responses may be JSON or an SSE frame; extract the first JSON object. */
function parseMaybeSse(text: string): any | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    // Look for a `data:` line (SSE).
    for (const line of trimmed.split(/\r?\n/)) {
      const m = line.match(/^data:\s*(.*)$/);
      if (m) {
        try {
          return JSON.parse(m[1]);
        } catch {
          /* keep scanning */
        }
      }
    }
    return null;
  }
}

/**
 * Look for OAuth 2.1 protected-resource metadata.
 *
 * Three placements are tried, in the order the spec itself prescribes:
 *
 * 1. Whatever the server advertised. A 401 is supposed to carry
 *    `WWW-Authenticate: Bearer resource_metadata="https://…"`, and the spec
 *    tells clients to take the URL from there rather than guess. If a server
 *    says where its metadata lives, believe it.
 * 2. The path-suffixed RFC 9728 location — for `https://example.com/mcp`,
 *    that is `/.well-known/oauth-protected-resource/mcp`.
 * 3. The bare origin root.
 *
 * Guessing only at the root produced false MCP006 criticals against servers
 * whose posture was fine; any one of the three counts.
 */
async function checkOAuthMetadata(
  url: string,
  wwwAuthenticate: string | null,
  doFetch: typeof fetch,
  timeoutMs: number,
): Promise<boolean> {
  const parsed = new URL(url);
  const base = `${parsed.origin}/.well-known/oauth-protected-resource`;
  const suffix = parsed.pathname.replace(/\/+$/, "");

  const candidates = [
    ...advertisedMetadataUrl(wwwAuthenticate),
    ...(suffix && suffix !== "/" ? [`${base}${suffix}`] : []),
    base,
  ];

  const sameOrigin = candidates.filter((c) => new URL(c).origin === parsed.origin);

  for (const candidate of sameOrigin) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(candidate, {
        method: "GET",
        signal: controller.signal,
      });
      if (res.ok) return true;
    } catch {
      // Try the next candidate; a failure here is not itself a finding.
    } finally {
      clearTimeout(timer);
    }
  }

  return false;
}

/**
 * Pull `resource_metadata="…"` out of a `WWW-Authenticate` challenge.
 *
 * The value is attacker-controlled — it comes from the endpoint under test —
 * so this only parses and normalizes it. The caller drops anything that is not
 * same-origin with the probed URL, which is both what RFC 9728 describes (the
 * resource server publishes its own metadata) and what keeps a hostile server
 * from using us to fetch a third party.
 */
function advertisedMetadataUrl(header: string | null): string[] {
  if (!header) return [];

  const m = header.match(/resource_metadata\s*=\s*"([^"]+)"|resource_metadata\s*=\s*([^\s,]+)/i);
  const raw = m?.[1] ?? m?.[2];
  if (!raw) return [];

  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return [];
    return [u.toString()];
  } catch {
    return [];
  }
}
