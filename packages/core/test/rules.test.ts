import assert from "node:assert/strict";
import { test } from "node:test";

import { evaluate } from "../src/engine";
import { rules, rulesVerifiedAt, SPEC_VERIFIED_AT } from "../src/rules";
import type { ProbeContext, RuleContext, SourceContext, SourceMatch } from "../src/types";

/**
 * Rules are pure functions over a normalized context — no network, no disk.
 * That is the whole point of the `RuleContext` indirection, so testing them
 * needs nothing but object literals.
 */

function live(overrides: Partial<ProbeContext> = {}): ProbeContext {
  return {
    reachable: true,
    sessionIdHeaderPresent: false,
    respondsToInitialize: false,
    advertisedCapabilities: [],
    authRequired: false,
    oauthResourceMetadata: false,
    ...overrides,
  };
}

function source(signal: string, match: Partial<SourceMatch> = {}): SourceContext {
  const empty: Record<string, SourceMatch[]> = {
    initialize: [],
    sessionId: [],
    logging: [],
    sampling: [],
    roots: [],
  };
  return {
    matches: {
      ...empty,
      [signal]: [{ file: "src/index.ts", line: 42, text: "…", ...match }],
    },
    sdkVersion: null,
    filesScanned: 1,
  };
}

function ids(ctx: RuleContext): string[] {
  return evaluate(ctx).map((f) => f.ruleId);
}

test("an empty context produces no findings", () => {
  assert.deepEqual(ids({}), []);
  assert.deepEqual(ids({ live: live() }), []);
  assert.deepEqual(ids({ source: { matches: {}, sdkVersion: null, filesScanned: 0 } }), []);
});

test("MCP001 fires on a live initialize response", () => {
  const findings = evaluate({ live: live({ respondsToInitialize: true }) });
  const f = findings.find((x) => x.ruleId === "MCP001");
  assert.ok(f, "MCP001 should fire");
  assert.equal(f.severity, "critical");
  assert.equal(f.location, "live endpoint");
});

test("MCP001 fires on a source match and reports file:line", () => {
  const findings = evaluate({ source: source("initialize", { line: 7 }) });
  const f = findings.find((x) => x.ruleId === "MCP001");
  assert.ok(f);
  assert.equal(f.location, "src/index.ts:7");
});

test("MCP002 fires on the Mcp-Session-Id response header", () => {
  const findings = evaluate({ live: live({ sessionIdHeaderPresent: true }) });
  const f = findings.find((x) => x.ruleId === "MCP002");
  assert.ok(f);
  assert.equal(f.severity, "critical");
});

test("MCP002 fires on a source sessionId match", () => {
  assert.ok(ids({ source: source("sessionId") }).includes("MCP002"));
});

const CAPABILITY_RULES: Array<[string, string]> = [
  ["logging", "MCP003"],
  ["sampling", "MCP004"],
  ["roots", "MCP005"],
];

for (const [capability, ruleId] of CAPABILITY_RULES) {
  test(`${ruleId} fires on an advertised '${capability}' capability`, () => {
    const findings = evaluate({ live: live({ advertisedCapabilities: [capability] }) });
    const f = findings.find((x) => x.ruleId === ruleId);
    assert.ok(f, `${ruleId} should fire for ${capability}`);
    assert.equal(f.severity, "warning", "deprecations have a 12-month window");
  });

  test(`${ruleId} fires on a source '${capability}' match`, () => {
    assert.ok(ids({ source: source(capability) }).includes(ruleId));
  });

  test(`${ruleId} stays quiet when '${capability}' is absent`, () => {
    const other = capability === "logging" ? "tools" : "logging";
    assert.ok(!ids({ live: live({ advertisedCapabilities: [other] }) }).includes(ruleId));
  });
}

test("MCP006 fires when auth is demanded but no metadata is served", () => {
  const findings = evaluate({
    live: live({ authRequired: true, oauthResourceMetadata: false }),
  });
  const f = findings.find((x) => x.ruleId === "MCP006");
  assert.ok(f);
  assert.equal(f.severity, "critical");
});

test("MCP006 stays quiet when metadata is served", () => {
  const found = ids({ live: live({ authRequired: true, oauthResourceMetadata: true }) });
  assert.ok(!found.includes("MCP006"));
});

test("MCP006 stays quiet on an open endpoint", () => {
  assert.ok(!ids({ live: live({ authRequired: false }) }).includes("MCP006"));
});

test("MCP006 stays quiet when the endpoint was never reached", () => {
  const found = ids({ live: live({ reachable: false, authRequired: true }) });
  assert.ok(!found.includes("MCP006"));
});

test("MCP006 stays quiet on a source-only scan", () => {
  // The rule needs runtime observation; a repo checkout cannot answer it.
  assert.ok(!ids({ source: source("sessionId") }).includes("MCP006"));
});

function withSdk(version: string | null): SourceContext {
  return { matches: {}, sdkVersion: version, filesScanned: 1 };
}

test("MCP007 fires on any @modelcontextprotocol/sdk dependency", () => {
  // That package name IS the v1 line: it stops at 1.30.0 and speaks the
  // pre-2026-07-28 protocol. v2 shipped as @modelcontextprotocol/server and
  // @modelcontextprotocol/client instead, so the package name is the signal.
  for (const version of ["^1.17.0", "1.30.0", "~1.0.0", "^1"]) {
    const findings = evaluate({ source: withSdk(version) });
    const f = findings.find((x) => x.ruleId === "MCP007");
    assert.ok(f, `MCP007 should fire for ${version}`);
    assert.equal(f.location, "package.json");
    assert.ok(f.detail.includes(version), "the observed version belongs in the detail");
  }
});

test("MCP007 names the real replacement packages and the real codemod", () => {
  // Regression guard for the original rule, which advised `@modelcontextprotocol/sdk@^2`
  // (a version that has never existed) and an unnamed "official v1→v2 codemod".
  const f = evaluate({ source: withSdk("^1.17.0") }).find((x) => x.ruleId === "MCP007");
  assert.ok(f);
  assert.ok(f.fix.includes("@modelcontextprotocol/server"));
  assert.ok(f.fix.includes("@modelcontextprotocol/client"));
  assert.ok(f.fix.includes("@modelcontextprotocol/codemod@latest v1-to-v2"));
  assert.ok(
    !/@modelcontextprotocol\/sdk[@^ ]*\^?2/.test(f.fix),
    "must not advise upgrading @modelcontextprotocol/sdk to 2.x — no such release",
  );
});

test("MCP007 stays quiet with no SDK dependency", () => {
  assert.ok(!ids({ source: withSdk(null) }).includes("MCP007"));
});

test("MCP007 stays quiet if the sdk package ever publishes a 2.x", () => {
  assert.ok(!ids({ source: withSdk("^2.0.0") }).includes("MCP007"));
});

test("MCP007 needs a checkout — a live probe cannot see package.json", () => {
  assert.ok(!ids({ live: live({ respondsToInitialize: true }) }).includes("MCP007"));
});

test("no specRef relies on a page anchor", () => {
  // Regression guard: these used to be `…/2026-07-28#lifecycle` and friends,
  // which silently resolved to the overview page with a fragment that does not
  // exist. The spec is split across subpages, not anchored on one document.
  for (const rule of rules) {
    assert.ok(
      rule.specRef.startsWith("https://"),
      `${rule.id} specRef must be absolute https, got ${rule.specRef}`,
    );
    assert.ok(
      !rule.specRef.includes("#"),
      `${rule.id} specRef relies on an anchor: ${rule.specRef}`,
    );
  }
});

test("every specRef carries a verification date, and none is in the future", () => {
  const today = new Date().toISOString().slice(0, 10);
  for (const rule of rules) {
    const at = SPEC_VERIFIED_AT[rule.specRef];
    assert.ok(at, `${rule.id} cites ${rule.specRef} with no entry in SPEC_VERIFIED_AT`);
    assert.match(at, /^\d{4}-\d{2}-\d{2}$/, `${rule.id}: ${at} is not an ISO date`);
    assert.ok(at <= today, `${rule.id} claims it was verified on ${at}, which is in the future`);
  }
});

test("rulesVerifiedAt reports the oldest citation, not the newest", () => {
  const oldest = Object.values(SPEC_VERIFIED_AT).sort()[0];
  assert.equal(rulesVerifiedAt, oldest);
});

test("protocol rules cite a spec subpage, never the bare revision root", () => {
  const root = "https://modelcontextprotocol.io/specification/2026-07-28";
  for (const rule of rules) {
    if (!rule.specRef.startsWith(root)) continue; // MCP007 cites the SDK blog
    assert.ok(
      rule.specRef.startsWith(`${root}/`) && rule.specRef.length > root.length + 1,
      `${rule.id} must cite a subpage under ${root}/, got ${rule.specRef}`,
    );
  }
});

test("a fired finding always carries a fix and a spec reference", () => {
  const everything = evaluate({
    live: live({
      respondsToInitialize: true,
      sessionIdHeaderPresent: true,
      advertisedCapabilities: ["logging", "sampling", "roots"],
      authRequired: true,
    }),
    source: withSdk("^1.17.0"),
  });

  assert.equal(everything.length, 7, "all seven rules should fire on this context");
  for (const f of everything) {
    assert.ok(f.fix.length > 0, `${f.ruleId} has no fix text`);
    assert.ok(f.specRef.length > 0, `${f.ruleId} has no specRef`);
    assert.ok(f.detail.length > 0, `${f.ruleId} has no detail`);
  }
});
