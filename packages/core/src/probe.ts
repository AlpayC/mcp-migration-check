import type { ProbeContext, ServerEra } from "./types";

/**
 * Probe a running MCP server over HTTP and normalize what we observe.
 *
 * WHY THIS PROBES TWICE
 *
 * The first version of this file sent one `initialize` request carrying
 * `protocolVersion: "2025-11-25"` — that is, it dialled every endpoint as a
 * legacy client and then reported the legacy answer it got as a defect. Two
 * things were wrong with that:
 *
 * 1. A server answering `initialize` is not evidence that it fails the current
 *    revision. `2026-07-28` §Backward Compatibility says a dual-era server
 *    "MAY implement both behaviors", and picks its era from how the client
 *    opens: modern `_meta` is served statelessly, an `initialize` request
 *    selects legacy semantics. Answering the old handshake is politeness
 *    toward clients still in the wild, not drift.
 * 2. It could not see the modern surface at all. A server that serves
 *    `2026-07-28` perfectly *and* keeps a legacy path was indistinguishable
 *    from one that only speaks the old protocol.
 *
 * So the probe now asks both questions and reports the pair:
 *
 *   modern  — `server/discover` with per-request `_meta` and the required
 *             headers (the spec's own compatibility probe: "Servers MUST
 *             implement server/discover"). A result, or an error from the
 *             range the spec reserves for itself, means the modern era is
 *             served. `-32601` does not: a legacy JSON-RPC server answers
 *             unknown methods with exactly that code, so it falls through to
 *             a modern `tools/list`, which is only counted when the result
 *             carries the `resultType` field this revision made required.
 *   legacy  — `initialize` the way a v1 client sends it.
 *
 * `era` is the join of the two, and it is what the rules score. Nothing here
 * is destructive and no authentication is attempted.
 */

/** The revision this checker is written against. */
export const CURRENT_PROTOCOL_VERSION = "2026-07-28";

/** The last handshake-based revision — what a v1 client would ask for. */
export const LEGACY_PROTOCOL_VERSION = "2025-11-25";

const CLIENT_INFO = { name: "mcpcheck", version: "0.2.0" };

/**
 * JSON-RPC error codes the 2026-07-28 revision reserves for itself
 * (`basic/index#error-codes`): `-32020` … `-32099`. An error in this range can
 * only come from a server that implements this revision, which is what makes
 * it usable as era evidence. `-32601` (method not found) is *outside* the
 * range on purpose — every JSON-RPC server in existence emits it.
 */
const MODERN_ERROR_MIN = -32099;
const MODERN_ERROR_MAX = -32020;

export interface ProbeOptions {
  timeoutMs?: number;
  /** Injected for testing; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Stop reading a response body past this many bytes. */
  maxBodyBytes?: number;
  /**
   * Skip the legacy `initialize` request. The era then reads "modern" or
   * "unknown" and never "dual", so the legacy-compat rules stay quiet — use it
   * only when the extra request is the problem, not to save time.
   */
  skipLegacyProbe?: boolean;
}

/**
 * We only need the head of the response to find the result, but the endpoint
 * is untrusted and can reply with anything. On a constrained runtime
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
  const maxBodyBytes = opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  const ctx: ProbeContext = {
    reachable: false,
    era: "unknown",
    supportedVersions: [],
    discoverImplemented: null,
    modernRequestsServed: false,
    respondsToLegacyInitialize: false,
    legacyProtocolVersion: null,
    sessionIdOnModernRequest: false,
    sessionIdOnLegacyHandshake: false,
    advertisedCapabilities: [],
    capabilitiesEra: null,
    authRequired: false,
    oauthResourceMetadata: false,
  };

  let wwwAuthenticate: string | null = null;
  let modernEra = false;

  const send = (body: unknown, headers: Record<string, string>) =>
    request(doFetch, url, body, headers, timeoutMs, maxBodyBytes);

  // ---- 1. Modern probe: server/discover -----------------------------------
  const discover = await send(
    modernBody("discover-1", "server/discover"),
    modernHeaders("server/discover"),
  );

  if (discover.error) {
    ctx.rawError = discover.error;
  } else {
    ctx.reachable = true;
    ctx.sessionIdOnModernRequest = discover.sessionId;
    wwwAuthenticate = discover.wwwAuthenticate;
    if (discover.status === 401 || wwwAuthenticate !== null) ctx.authRequired = true;

    const result = discover.payload?.result;
    const code = numericErrorCode(discover.payload);

    if (result && typeof result === "object") {
      // A legacy server has no `server/discover` at all, so a result here is
      // conclusive on its own.
      modernEra = true;
      ctx.discoverImplemented = true;
      ctx.modernRequestsServed = true;
      ctx.supportedVersions = stringList(result.supportedVersions);
      if (result.capabilities && typeof result.capabilities === "object") {
        ctx.advertisedCapabilities = Object.keys(result.capabilities);
        ctx.capabilitiesEra = "modern";
      }
    } else if (code !== null && code >= MODERN_ERROR_MIN && code <= MODERN_ERROR_MAX) {
      // UnsupportedProtocolVersion / HeaderMismatch / MissingRequiredClient-
      // Capability. The server rejected *this* request but only a server
      // implementing this revision knows these codes.
      modernEra = true;
      ctx.discoverImplemented = true;
      ctx.supportedVersions = stringList(discover.payload?.error?.data?.supported);
    } else if (!ctx.authRequired) {
      // Inconclusive — `-32601`, a legacy "not initialized" error, an HTML
      // error page. Fall through to an ordinary modern request.
      ctx.discoverImplemented = false;
    }
  }

  // ---- 2. Modern probe, fallback: a real request ---------------------------
  // Only worth sending when discover did not settle the era. `resultType` is
  // required on every result in this revision and absent from every earlier
  // one, so it — not the mere fact of an answer — is what counts.
  if (ctx.reachable && !modernEra && !ctx.authRequired) {
    const list = await send(
      modernBody("list-1", "tools/list"),
      modernHeaders("tools/list"),
    );
    if (!list.error) {
      if (list.sessionId) ctx.sessionIdOnModernRequest = true;
      const result = list.payload?.result;
      const code = numericErrorCode(list.payload);

      if (result && typeof result === "object" && typeof result.resultType === "string") {
        modernEra = true;
        ctx.modernRequestsServed = true;
      } else if (code !== null && code >= MODERN_ERROR_MIN && code <= MODERN_ERROR_MAX) {
        modernEra = true;
        ctx.supportedVersions = stringList(list.payload?.error?.data?.supported);
      }
    }
  }

  // ---- 3. Legacy probe: the v1 initialize handshake -----------------------
  // Skipped behind auth: without a token every path returns 401 and the answer
  // would say nothing about the server's era.
  if (ctx.reachable && !ctx.authRequired && !opts.skipLegacyProbe) {
    const init = await send(legacyInitializeBody(), {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    });
    if (!init.error) {
      const result = init.payload?.result;
      if (result && typeof result === "object") {
        ctx.respondsToLegacyInitialize = true;
        ctx.sessionIdOnLegacyHandshake = init.sessionId;
        if (typeof result.protocolVersion === "string") {
          ctx.legacyProtocolVersion = result.protocolVersion;
        }
        // Only fill capabilities from the legacy handshake if the modern
        // surface did not already report them — a deprecated capability
        // offered to v1 clients alone is a different claim from one on the
        // current surface, and `capabilitiesEra` is how the rules tell.
        if (
          ctx.capabilitiesEra === null &&
          result.capabilities &&
          typeof result.capabilities === "object"
        ) {
          ctx.advertisedCapabilities = Object.keys(result.capabilities);
          ctx.capabilitiesEra = "legacy";
        }
      }
    }
  }

  ctx.era = deriveEra(modernEra, ctx.respondsToLegacyInitialize);

  // Best-effort OAuth 2.1 resource-server metadata check.
  if (ctx.reachable) {
    ctx.oauthResourceMetadata = await checkOAuthMetadata(
      url,
      wwwAuthenticate,
      doFetch,
      timeoutMs,
    ).catch(() => false);
  }

  return ctx;
}

function deriveEra(modern: boolean, legacy: boolean): ServerEra {
  if (modern && legacy) return "dual";
  if (modern) return "modern";
  if (legacy) return "legacy";
  return "unknown";
}

/**
 * The `_meta` envelope every modern request carries. Version, identity and
 * capabilities moved here when the handshake was removed, so this is what
 * makes a request "modern" as far as the server is concerned.
 */
function modernBody(id: string, method: string): unknown {
  return {
    jsonrpc: "2.0",
    id,
    method,
    params: {
      _meta: {
        "io.modelcontextprotocol/protocolVersion": CURRENT_PROTOCOL_VERSION,
        "io.modelcontextprotocol/clientInfo": CLIENT_INFO,
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    },
  };
}

/**
 * `MCP-Protocol-Version` and `Mcp-Method` are REQUIRED on every modern POST,
 * and the version header MUST match the `_meta` field or the server answers
 * `HeaderMismatch`. `Mcp-Name` is only required for `tools/call`,
 * `resources/read` and `prompts/get`, none of which this probe sends.
 */
function modernHeaders(method: string): Record<string, string> {
  return {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": CURRENT_PROTOCOL_VERSION,
    "mcp-method": method,
  };
}

function legacyInitializeBody(): unknown {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: LEGACY_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    },
  };
}

interface Attempt {
  status: number;
  sessionId: boolean;
  wwwAuthenticate: string | null;
  payload: any | null;
  /** Set when the request never produced a response at all. */
  error?: string;
}

async function request(
  doFetch: typeof fetch,
  url: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs: number,
  maxBodyBytes: number,
): Promise<Attempt> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await doFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await readCapped(res, maxBodyBytes).catch(() => "");
    return {
      status: res.status,
      sessionId: res.headers.has("mcp-session-id"),
      wwwAuthenticate: res.headers.get("www-authenticate"),
      payload: parseMaybeSse(text),
    };
  } catch (err) {
    return {
      status: 0,
      sessionId: false,
      wwwAuthenticate: null,
      payload: null,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** JSON-RPC allows any number here; anything else is not an error code. */
function numericErrorCode(payload: any | null): number | null {
  const code = payload?.error?.code;
  return typeof code === "number" && Number.isFinite(code) ? code : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
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
      // Release the connection before doing anything else. Only the status
      // matters here, but an HTTP client does not consider a request finished
      // until its body is read or cancelled — undici keeps the socket checked
      // out, and the next candidate is same-origin by construction, so it
      // queues behind a response nobody is going to read. Across one endpoint
      // that is invisible; across thousands it leaks sockets until requests
      // stop settling at all.
      await res.body?.cancel().catch(() => {});
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
