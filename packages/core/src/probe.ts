import type { ProbeContext } from "./types.js";

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
}

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

    if (res.status === 401 || res.headers.has("www-authenticate")) {
      base.authRequired = true;
    }

    const text = await res.text().catch(() => "");
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
    base.oauthResourceMetadata = await checkOAuthMetadata(url, doFetch, timeoutMs).catch(
      () => false,
    );
  }

  return base;
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

async function checkOAuthMetadata(
  url: string,
  doFetch: typeof fetch,
  timeoutMs: number,
): Promise<boolean> {
  const origin = new URL(url).origin;
  const well = `${origin}/.well-known/oauth-protected-resource`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await doFetch(well, { method: "GET", signal: controller.signal });
    return res.ok;
  } finally {
    clearTimeout(timer);
  }
}
