import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CURRENT_PROTOCOL_VERSION,
  LEGACY_PROTOCOL_VERSION,
  probeEndpoint,
} from "../src/probe";

/**
 * `ProbeOptions.fetchImpl` exists so the network can be replaced in tests.
 *
 * The probe now sends up to three POSTs to the same URL — modern
 * `server/discover`, a modern `tools/list` if that was inconclusive, and the
 * legacy `initialize` handshake — so the mock dispatches on what is *in* the
 * request, not just on its URL. That is the point: the old probe only ever
 * spoke as a legacy client, and a mock keyed on the URL alone could not have
 * caught it.
 */

const ENDPOINT = "https://example.com/mcp";

interface Sent {
  url: string;
  method: string | null;
  headers: Headers;
  body: any;
}

interface Reply {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  throws?: string;
}

/** Build a fetch impl from a handler, recording every request it sees. */
function mock(handler: (sent: Sent) => Reply | undefined): {
  impl: typeof fetch;
  sent: Sent[];
} {
  const sent: Sent[] = [];
  const impl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const body = typeof init?.body === "string" ? safeParse(init.body) : null;
    const record: Sent = {
      url,
      method: body?.method ?? null,
      headers: new Headers((init?.headers ?? {}) as Record<string, string>),
      body,
    };
    sent.push(record);

    const reply = handler(record);
    if (!reply) return new Response("not found", { status: 404 });
    if (reply.throws) throw new Error(reply.throws);
    return new Response(reply.body ?? "", {
      status: reply.status ?? 200,
      headers: reply.headers,
    });
  }) as typeof fetch;

  return { impl, sent };
}

function safeParse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const rpc = (payload: unknown) => JSON.stringify(payload);

const DISCOVER_RESULT = rpc({
  jsonrpc: "2.0",
  id: "discover-1",
  result: {
    resultType: "complete",
    supportedVersions: [CURRENT_PROTOCOL_VERSION],
    capabilities: { tools: {}, resources: {} },
  },
});

const LEGACY_INITIALIZE_RESULT = rpc({
  jsonrpc: "2.0",
  id: 1,
  result: {
    protocolVersion: LEGACY_PROTOCOL_VERSION,
    capabilities: { tools: {}, logging: {}, roots: {} },
    serverInfo: { name: "old", version: "1.0.0" },
  },
});

/** What a JSON-RPC server answers for a method it has never heard of. */
const METHOD_NOT_FOUND = rpc({
  jsonrpc: "2.0",
  id: "discover-1",
  error: { code: -32601, message: "Method not found" },
});

// ---------------------------------------------------------------------------
// Era detection
// ---------------------------------------------------------------------------

test("a dual-era server is recognized as dual, not as legacy drift", async () => {
  const { impl, sent } = mock((s) => {
    if (s.method === "server/discover") return { body: DISCOVER_RESULT };
    if (s.method === "initialize") return { body: LEGACY_INITIALIZE_RESULT };
    return undefined;
  });

  const ctx = await probeEndpoint(ENDPOINT, { fetchImpl: impl });

  assert.equal(ctx.era, "dual");
  assert.equal(ctx.modernRequestsServed, true);
  assert.equal(ctx.discoverImplemented, true);
  assert.equal(ctx.respondsToLegacyInitialize, true);
  assert.equal(ctx.legacyProtocolVersion, LEGACY_PROTOCOL_VERSION);
  assert.deepEqual(ctx.supportedVersions, [CURRENT_PROTOCOL_VERSION]);
  // Capabilities come off the modern surface when it answered.
  assert.equal(ctx.capabilitiesEra, "modern");
  assert.ok(!ctx.advertisedCapabilities.includes("logging"));
  assert.equal(sent.filter((s) => s.method === "tools/list").length, 0, "discover settled it");
});

test("a legacy-only server is the one that grades as legacy", async () => {
  const { impl } = mock((s) => {
    if (s.method === "initialize") return { body: LEGACY_INITIALIZE_RESULT };
    // A v1 server answers anything modern with a plain method-not-found.
    return { body: METHOD_NOT_FOUND };
  });

  const ctx = await probeEndpoint(ENDPOINT, { fetchImpl: impl });

  assert.equal(ctx.era, "legacy");
  assert.equal(ctx.modernRequestsServed, false);
  assert.equal(ctx.respondsToLegacyInitialize, true);
  assert.equal(ctx.capabilitiesEra, "legacy");
  assert.deepEqual(ctx.advertisedCapabilities.sort(), ["logging", "roots", "tools"]);
});

test("a modern-only server does not answer the legacy handshake", async () => {
  const { impl } = mock((s) => {
    if (s.method === "server/discover") return { body: DISCOVER_RESULT };
    if (s.method === "initialize") {
      return {
        status: 400,
        body: rpc({
          jsonrpc: "2.0",
          id: 1,
          error: {
            code: -32022,
            message: "Unsupported protocol version",
            data: { supported: [CURRENT_PROTOCOL_VERSION] },
          },
        }),
      };
    }
    return undefined;
  });

  const ctx = await probeEndpoint(ENDPOINT, { fetchImpl: impl });
  assert.equal(ctx.era, "modern");
  assert.equal(ctx.respondsToLegacyInitialize, false);
});

test("-32601 alone is not evidence of the modern era", async () => {
  // Regression guard. Every JSON-RPC server answers unknown methods with
  // -32601, so treating it as a modern signal would grade every v1 server as
  // current. Only the range the spec reserves for itself (-32020…-32099)
  // counts.
  const { impl } = mock(() => ({ status: 404, body: METHOD_NOT_FOUND }));

  const ctx = await probeEndpoint(ENDPOINT, { fetchImpl: impl });
  assert.equal(ctx.era, "unknown");
  assert.equal(ctx.modernRequestsServed, false);
});

test("an UnsupportedProtocolVersionError identifies a modern server", async () => {
  const { impl } = mock(() => ({
    status: 400,
    body: rpc({
      jsonrpc: "2.0",
      id: "discover-1",
      error: {
        code: -32022,
        message: "Unsupported protocol version",
        data: { supported: ["2026-11-01"], requested: CURRENT_PROTOCOL_VERSION },
      },
    }),
  }));

  const ctx = await probeEndpoint(ENDPOINT, { fetchImpl: impl });
  assert.equal(ctx.era, "modern");
  assert.deepEqual(ctx.supportedVersions, ["2026-11-01"]);
});

test("tools/list rescues a modern server that lacks server/discover", async () => {
  const { impl } = mock((s) => {
    if (s.method === "server/discover") return { status: 404, body: METHOD_NOT_FOUND };
    if (s.method === "tools/list") {
      return {
        body: rpc({
          jsonrpc: "2.0",
          id: "list-1",
          result: { resultType: "complete", tools: [], ttlMs: 3600000, cacheScope: "public" },
        }),
      };
    }
    return undefined;
  });

  const ctx = await probeEndpoint(ENDPOINT, { fetchImpl: impl });
  assert.equal(ctx.era, "modern");
  assert.equal(ctx.modernRequestsServed, true);
  assert.equal(ctx.discoverImplemented, false, "MCP008 keys off this");
});

test("a tools/list result without resultType is not modern evidence", async () => {
  // A lenient v1 server that answers tools/list without a handshake. It looks
  // like an answer, but `resultType` is required on every result in this
  // revision and absent from every earlier one.
  const { impl } = mock((s) => {
    if (s.method === "tools/list") {
      return { body: rpc({ jsonrpc: "2.0", id: "list-1", result: { tools: [] } }) };
    }
    if (s.method === "initialize") return { body: LEGACY_INITIALIZE_RESULT };
    return { status: 404, body: METHOD_NOT_FOUND };
  });

  const ctx = await probeEndpoint(ENDPOINT, { fetchImpl: impl });
  assert.equal(ctx.era, "legacy");
});

// ---------------------------------------------------------------------------
// What the probe actually sends
// ---------------------------------------------------------------------------

test("the modern probe speaks the current revision, not the legacy one", async () => {
  // The original probe sent `protocolVersion: 2025-11-25` and nothing else, so
  // it saw only what a v1 client would see and then reported that as drift.
  const { impl, sent } = mock((s) => {
    if (s.method === "server/discover") return { body: DISCOVER_RESULT };
    if (s.method === "initialize") return { body: LEGACY_INITIALIZE_RESULT };
    return undefined;
  });

  await probeEndpoint(ENDPOINT, { fetchImpl: impl });

  const discover = sent.find((s) => s.method === "server/discover");
  assert.ok(discover, "the probe must ask the modern surface first");
  assert.equal(sent[0], discover, "and ask it before the legacy handshake");
  assert.equal(
    discover.headers.get("mcp-protocol-version"),
    CURRENT_PROTOCOL_VERSION,
    "the required version header",
  );
  assert.equal(discover.headers.get("mcp-method"), "server/discover");
  assert.equal(
    discover.body.params._meta["io.modelcontextprotocol/protocolVersion"],
    CURRENT_PROTOCOL_VERSION,
    "the header MUST match the _meta field or the server answers HeaderMismatch",
  );
  assert.ok(discover.body.params._meta["io.modelcontextprotocol/clientInfo"]);

  const init = sent.find((s) => s.method === "initialize");
  assert.ok(init);
  assert.equal(init.body.params.protocolVersion, LEGACY_PROTOCOL_VERSION);
  assert.equal(
    init.headers.get("mcp-protocol-version"),
    null,
    "the legacy probe must look like a legacy client",
  );
});

test("skipLegacyProbe sends no handshake", async () => {
  const { impl, sent } = mock((s) =>
    s.method === "server/discover" ? { body: DISCOVER_RESULT } : undefined,
  );

  const ctx = await probeEndpoint(ENDPOINT, { fetchImpl: impl, skipLegacyProbe: true });
  assert.equal(ctx.era, "modern");
  assert.equal(sent.filter((s) => s.method === "initialize").length, 0);
});

// ---------------------------------------------------------------------------
// Sessions, auth, transport
// ---------------------------------------------------------------------------

test("a session id on a modern request is separated from one on the handshake", async () => {
  const { impl } = mock((s) => {
    if (s.method === "server/discover") {
      return { headers: { "mcp-session-id": "abc-123" }, body: DISCOVER_RESULT };
    }
    if (s.method === "initialize") {
      return { headers: { "mcp-session-id": "def-456" }, body: LEGACY_INITIALIZE_RESULT };
    }
    return undefined;
  });

  const ctx = await probeEndpoint(ENDPOINT, { fetchImpl: impl });
  assert.equal(ctx.sessionIdOnModernRequest, true, "this one is the violation");
  assert.equal(ctx.sessionIdOnLegacyHandshake, true, "this one is how v1 works");
});

test("a legacy-only session id is not attributed to the modern surface", async () => {
  const { impl } = mock((s) => {
    if (s.method === "server/discover") return { body: DISCOVER_RESULT };
    if (s.method === "initialize") {
      return { headers: { "mcp-session-id": "def-456" }, body: LEGACY_INITIALIZE_RESULT };
    }
    return undefined;
  });

  const ctx = await probeEndpoint(ENDPOINT, { fetchImpl: impl });
  assert.equal(ctx.sessionIdOnModernRequest, false);
  assert.equal(ctx.sessionIdOnLegacyHandshake, true);
});

test("parses an SSE-framed response", async () => {
  const { impl } = mock((s) =>
    s.method === "server/discover"
      ? {
          headers: { "content-type": "text/event-stream" },
          body: `event: message\ndata: ${DISCOVER_RESULT}\n\n`,
        }
      : undefined,
  );

  const ctx = await probeEndpoint(ENDPOINT, { fetchImpl: impl });
  assert.equal(ctx.modernRequestsServed, true);
  assert.deepEqual(ctx.advertisedCapabilities.sort(), ["resources", "tools"]);
});

test("treats a 401 as auth required and stops probing protocol", async () => {
  const { impl, sent } = mock(() => ({ status: 401, body: "" }));

  const ctx = await probeEndpoint(ENDPOINT, { fetchImpl: impl });
  assert.equal(ctx.authRequired, true);
  assert.equal(ctx.era, "unknown", "behind auth, neither era can be observed");
  assert.equal(
    sent.filter((s) => s.method === "initialize").length,
    0,
    "no point sending a handshake that will also 401",
  );
});

test("an unreachable endpoint is recorded, not thrown", async () => {
  const { impl } = mock(() => ({ throws: "ECONNREFUSED" }));

  const ctx = await probeEndpoint(ENDPOINT, { fetchImpl: impl });
  assert.equal(ctx.reachable, false);
  assert.equal(ctx.era, "unknown");
  assert.match(ctx.rawError ?? "", /ECONNREFUSED/);
});

test("stops reading the body at maxBodyBytes", async () => {
  // Valid JSON, but the closing brace sits past the cap. If the cap bites, the
  // truncated text cannot parse and the result goes unrecognized.
  const padded = `{"jsonrpc":"2.0","id":"discover-1",${" ".repeat(
    5000,
  )}"result":{"resultType":"complete","capabilities":{}}}`;
  const handler = (s: Sent) => (s.method === "server/discover" ? { body: padded } : undefined);

  const capped = await probeEndpoint(ENDPOINT, {
    fetchImpl: mock(handler).impl,
    maxBodyBytes: 100,
  });
  assert.equal(capped.modernRequestsServed, false, "cap should have truncated the body");

  const uncapped = await probeEndpoint(ENDPOINT, {
    fetchImpl: mock(handler).impl,
    maxBodyBytes: 1_000_000,
  });
  assert.equal(uncapped.modernRequestsServed, true, "same body parses when not capped");
});

// ---------------------------------------------------------------------------
// OAuth protected-resource metadata
// ---------------------------------------------------------------------------

test("follows the resource_metadata URL advertised in WWW-Authenticate", async () => {
  const advertised = "https://example.com/oauth/prm";
  const { impl, sent } = mock((s) => {
    if (s.url === ENDPOINT) {
      return {
        status: 401,
        headers: {
          "www-authenticate": `Bearer resource_metadata="${advertised}", scope="files:read"`,
        },
      };
    }
    if (s.url === advertised) return { body: '{"resource":"https://example.com/mcp"}' };
    return undefined;
  });

  const ctx = await probeEndpoint(ENDPOINT, { fetchImpl: impl });

  assert.equal(ctx.authRequired, true);
  assert.equal(ctx.oauthResourceMetadata, true);
  assert.ok(
    sent.some((s) => s.url === advertised),
    "the advertised URL should be tried first",
  );
});

test("ignores a cross-origin resource_metadata URL", async () => {
  // A hostile endpoint must not be able to point the checker at a third party.
  const evil = "https://attacker.example/collect";
  const { impl, sent } = mock((s) => {
    if (s.url === ENDPOINT) {
      return { status: 401, headers: { "www-authenticate": `Bearer resource_metadata="${evil}"` } };
    }
    // Only the attacker's host serves metadata. Nothing same-origin does, so a
    // `true` here could only have come from following the cross-origin URL.
    if (s.url === evil) return { body: "{}" };
    return undefined;
  });

  const ctx = await probeEndpoint(ENDPOINT, { fetchImpl: impl });

  assert.equal(ctx.oauthResourceMetadata, false);
  assert.ok(!sent.some((s) => s.url === evil), "must never fetch a cross-origin metadata URL");
});

test("falls back to the RFC 9728 path-suffixed location", async () => {
  const suffixed = "https://example.com/.well-known/oauth-protected-resource/mcp";
  const { impl, sent } = mock((s) => {
    if (s.url === ENDPOINT) return { status: 401 };
    if (s.url === suffixed) return { body: "{}" };
    return undefined;
  });

  const ctx = await probeEndpoint(ENDPOINT, { fetchImpl: impl });

  assert.equal(ctx.oauthResourceMetadata, true);
  assert.ok(sent.some((s) => s.url === suffixed));
});

test("falls back to the origin root", async () => {
  const root = "https://example.com/.well-known/oauth-protected-resource";
  const { impl } = mock((s) => {
    if (s.url === ENDPOINT) return { status: 401 };
    if (s.url === root) return { body: "{}" };
    return undefined;
  });

  const ctx = await probeEndpoint(ENDPOINT, { fetchImpl: impl });
  assert.equal(ctx.oauthResourceMetadata, true);
});

test("reports no metadata when nothing is served", async () => {
  const { impl } = mock((s) => (s.url === ENDPOINT ? { status: 401 } : undefined));

  const ctx = await probeEndpoint(ENDPOINT, { fetchImpl: impl });
  assert.equal(ctx.oauthResourceMetadata, false);
});
