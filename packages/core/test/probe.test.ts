import assert from "node:assert/strict";
import { test } from "node:test";

import { probeEndpoint } from "../src/probe";

/**
 * `ProbeOptions.fetchImpl` exists so the network can be replaced in tests. It
 * had no callers until this file — every behaviour below is reachable without
 * touching a real endpoint.
 */

interface Route {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  throws?: string;
}

function mockFetch(routes: Record<string, Route>): {
  impl: typeof fetch;
  calls: string[];
} {
  const calls: string[] = [];
  const impl = (async (input: Parameters<typeof fetch>[0]) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    calls.push(url);

    const route = routes[url];
    if (!route) return new Response("not found", { status: 404 });
    if (route.throws) throw new Error(route.throws);

    return new Response(route.body ?? "", {
      status: route.status ?? 200,
      headers: route.headers,
    });
  }) as typeof fetch;

  return { impl, calls };
}

const OK_INITIALIZE = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  result: { capabilities: { tools: {}, logging: {}, roots: {} } },
});

test("parses a plain JSON initialize response", async () => {
  const { impl } = mockFetch({
    "https://example.com/mcp": { body: OK_INITIALIZE },
  });

  const ctx = await probeEndpoint("https://example.com/mcp", { fetchImpl: impl });

  assert.equal(ctx.reachable, true);
  assert.equal(ctx.respondsToInitialize, true);
  assert.deepEqual(ctx.advertisedCapabilities.sort(), ["logging", "roots", "tools"]);
});

test("parses an SSE-framed initialize response", async () => {
  const { impl } = mockFetch({
    "https://example.com/mcp": {
      headers: { "content-type": "text/event-stream" },
      body: `event: message\ndata: ${OK_INITIALIZE}\n\n`,
    },
  });

  const ctx = await probeEndpoint("https://example.com/mcp", { fetchImpl: impl });

  assert.equal(ctx.respondsToInitialize, true);
  assert.ok(ctx.advertisedCapabilities.includes("logging"));
});

test("notices the Mcp-Session-Id response header", async () => {
  const { impl } = mockFetch({
    "https://example.com/mcp": {
      headers: { "mcp-session-id": "abc-123" },
      body: OK_INITIALIZE,
    },
  });

  const ctx = await probeEndpoint("https://example.com/mcp", { fetchImpl: impl });
  assert.equal(ctx.sessionIdHeaderPresent, true);
});

test("treats a 401 as auth required", async () => {
  const { impl } = mockFetch({
    "https://example.com/mcp": { status: 401, body: "" },
  });

  const ctx = await probeEndpoint("https://example.com/mcp", { fetchImpl: impl });
  assert.equal(ctx.authRequired, true);
  assert.equal(ctx.respondsToInitialize, false);
});

test("an unreachable endpoint is recorded, not thrown", async () => {
  const { impl } = mockFetch({
    "https://example.com/mcp": { throws: "ECONNREFUSED" },
  });

  const ctx = await probeEndpoint("https://example.com/mcp", { fetchImpl: impl });
  assert.equal(ctx.reachable, false);
  assert.match(ctx.rawError ?? "", /ECONNREFUSED/);
});

test("follows the resource_metadata URL advertised in WWW-Authenticate", async () => {
  const advertised = "https://example.com/oauth/prm";
  const { impl, calls } = mockFetch({
    "https://example.com/mcp": {
      status: 401,
      headers: {
        "www-authenticate": `Bearer resource_metadata="${advertised}", scope="files:read"`,
      },
    },
    [advertised]: { body: '{"resource":"https://example.com/mcp"}' },
  });

  const ctx = await probeEndpoint("https://example.com/mcp", { fetchImpl: impl });

  assert.equal(ctx.authRequired, true);
  assert.equal(ctx.oauthResourceMetadata, true);
  assert.ok(calls.includes(advertised), "the advertised URL should be tried first");
});

test("ignores a cross-origin resource_metadata URL", async () => {
  // A hostile endpoint must not be able to point the checker at a third party.
  const evil = "https://attacker.example/collect";
  const { impl, calls } = mockFetch({
    "https://example.com/mcp": {
      status: 401,
      headers: { "www-authenticate": `Bearer resource_metadata="${evil}"` },
    },
    [evil]: { body: "{}" },
  });

  const ctx = await probeEndpoint("https://example.com/mcp", { fetchImpl: impl });

  assert.equal(ctx.oauthResourceMetadata, false);
  assert.ok(!calls.includes(evil), "must never fetch a cross-origin metadata URL");
});

test("falls back to the RFC 9728 path-suffixed location", async () => {
  const { impl, calls } = mockFetch({
    "https://example.com/mcp": { status: 401 },
    "https://example.com/.well-known/oauth-protected-resource/mcp": { body: "{}" },
  });

  const ctx = await probeEndpoint("https://example.com/mcp", { fetchImpl: impl });

  assert.equal(ctx.oauthResourceMetadata, true);
  assert.ok(
    calls.includes("https://example.com/.well-known/oauth-protected-resource/mcp"),
  );
});

test("falls back to the origin root", async () => {
  const { impl } = mockFetch({
    "https://example.com/mcp": { status: 401 },
    "https://example.com/.well-known/oauth-protected-resource": { body: "{}" },
  });

  const ctx = await probeEndpoint("https://example.com/mcp", { fetchImpl: impl });
  assert.equal(ctx.oauthResourceMetadata, true);
});

test("reports no metadata when nothing is served", async () => {
  const { impl } = mockFetch({
    "https://example.com/mcp": { status: 401 },
  });

  const ctx = await probeEndpoint("https://example.com/mcp", { fetchImpl: impl });
  assert.equal(ctx.oauthResourceMetadata, false);
});

test("stops reading the body at maxBodyBytes", async () => {
  // Valid JSON, but the closing brace sits past the cap. If the cap bites, the
  // truncated text cannot parse and initialize goes unrecognized.
  const padded = `{"jsonrpc":"2.0","id":1,${" ".repeat(5000)}"result":{"capabilities":{}}}`;
  const routes = { "https://example.com/mcp": { body: padded } };

  const capped = await probeEndpoint("https://example.com/mcp", {
    fetchImpl: mockFetch(routes).impl,
    maxBodyBytes: 100,
  });
  assert.equal(capped.respondsToInitialize, false, "cap should have truncated the body");

  const uncapped = await probeEndpoint("https://example.com/mcp", {
    fetchImpl: mockFetch(routes).impl,
    maxBodyBytes: 1_000_000,
  });
  assert.equal(uncapped.respondsToInitialize, true, "same body parses when not capped");
});
