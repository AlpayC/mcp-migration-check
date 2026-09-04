import assert from "node:assert/strict";
import { test } from "node:test";

import { evaluate, gradeFrom } from "../src/engine";
import { rules, rulesVerifiedAt, SPEC_VERIFIED_AT } from "../src/rules";
import { classifyGoSdkVersion } from "../src/scan";
import type {
  ProbeContext,
  PythonSdkRequirement,
  RuleContext,
  SdkDependency,
  SourceContext,
  SourceMatch,
} from "../src/types";

/**
 * Rules are pure functions over a normalized context — no network, no disk.
 * That is the whole point of the `RuleContext` indirection, so testing them
 * needs nothing but object literals.
 */

function live(overrides: Partial<ProbeContext> = {}): ProbeContext {
  return {
    reachable: true,
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
    ...overrides,
  };
}

/** A v1 server: answers the handshake, nothing modern responded. */
function legacyOnly(overrides: Partial<ProbeContext> = {}): ProbeContext {
  return live({
    era: "legacy",
    respondsToLegacyInitialize: true,
    legacyProtocolVersion: "2025-11-25",
    discoverImplemented: false,
    ...overrides,
  });
}

/** A current server that also keeps the old door open. Not a defect. */
function dualEra(overrides: Partial<ProbeContext> = {}): ProbeContext {
  return live({
    era: "dual",
    supportedVersions: ["2026-07-28"],
    discoverImplemented: true,
    modernRequestsServed: true,
    respondsToLegacyInitialize: true,
    legacyProtocolVersion: "2025-11-25",
    ...overrides,
  });
}

function source(signal: string, match: Partial<SourceMatch> = {}): SourceContext {
  const empty: Record<string, SourceMatch[]> = {
    initialize: [],
    sessionId: [],
    logging: [],
    sampling: [],
    roots: [],
    pythonV1Sdk: [],
    pythonServerSdk: [],
    goStreamableHttp: [],
    goStatelessOptIn: [],
    modernEra: [],
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

test("MCP001 fires when only the legacy handshake answers", () => {
  const findings = evaluate({ live: legacyOnly() });
  const f = findings.find((x) => x.ruleId === "MCP001");
  assert.ok(f, "MCP001 should fire");
  assert.equal(f.severity, "critical");
  assert.equal(f.location, "live endpoint");
});

/**
 * The bug this whole file was rewritten for. A dual-era server is explicitly
 * allowed — "A server that wishes to support both legacy clients … and modern
 * clients MAY implement both behaviors" — and the old rule called it critical
 * and told the maintainer to delete the handshake, which would have broken
 * every v1 client pointed at it.
 */
test("MCP001 stays quiet on a dual-era server, which grades a clean A", () => {
  const found = ids({ live: dualEra() });
  assert.ok(!found.includes("MCP001"), `MCP001 must not fire, got ${found.join(", ")}`);
  assert.ok(found.includes("MCP101"), "the compatibility observation should be recorded");
  assert.equal(gradeFrom(evaluate({ live: dualEra() })).letter, "A");
});

test("MCP101 never fires for a server that has no modern surface", () => {
  assert.ok(!ids({ live: legacyOnly() }).includes("MCP101"));
});

test("MCP101 reads as one sentence with and without a version list", () => {
  // Caught against a live dual-era server: the versions clause ended in a full
  // stop while being spliced mid-sentence, giving "…the current revision It
  // names 2026-07-28 as supported. and also answers…".
  for (const versions of [["2026-07-28"], []]) {
    const f = evaluate({ live: dualEra({ supportedVersions: versions }) }).find(
      (x) => x.ruleId === "MCP101",
    );
    assert.ok(f);
    assert.ok(
      !/\.\s+(and|which|that)\b/.test(f.detail),
      `MCP101 detail has a stray full stop: ${f.detail}`,
    );
    assert.ok(!/\s{2,}/.test(f.detail), `MCP101 detail has a double space: ${f.detail}`);
  }
});

test("MCP001 fires on a source match and reports file:line", () => {
  const findings = evaluate({ source: source("initialize", { line: 7 }) });
  const f = findings.find((x) => x.ruleId === "MCP001");
  assert.ok(f);
  assert.equal(f.location, "src/index.ts:7");
});

test("MCP001 stays quiet when source handles per-request _meta too", () => {
  const ctx = source("initialize");
  ctx.matches.modernEra = [
    { file: "src/server.ts", line: 3, text: "io.modelcontextprotocol/protocolVersion" },
  ];
  assert.ok(!ids({ source: ctx }).includes("MCP001"));
});

test("MCP001 never advises removing the handshake", () => {
  // The original fix text did exactly that. It is the reason this rule was
  // called harmful, so it is pinned.
  const f = evaluate({ live: legacyOnly() }).find((x) => x.ruleId === "MCP001");
  assert.ok(f);
  assert.ok(f.fix.includes("do not remove the legacy one"));
  assert.ok(
    !/remove the initialize/i.test(f.fix),
    `MCP001 must not tell a server to drop backwards compatibility: ${f.fix}`,
  );
});

test("MCP002 fires when a session id comes back from a modern request", () => {
  const findings = evaluate({ live: dualEra({ sessionIdOnModernRequest: true }) });
  const f = findings.find((x) => x.ruleId === "MCP002");
  assert.ok(f);
  assert.equal(f.severity, "critical");
});

test("MCP002 stays quiet when only the legacy handshake mints a session", () => {
  const found = ids({ live: dualEra({ sessionIdOnLegacyHandshake: true }) });
  assert.ok(!found.includes("MCP002"), "that is how the legacy revision works");
  assert.ok(found.includes("MCP102"), "but it is worth recording");
});

test("MCP002 fires on a source sessionId match", () => {
  assert.ok(ids({ source: source("sessionId") }).includes("MCP002"));
});

test("MCP002 stays quiet on a source sessionId match beside modern handling", () => {
  const ctx = source("sessionId");
  ctx.matches.modernEra = [{ file: "src/server.ts", line: 3, text: "server/discover" }];
  assert.ok(!ids({ source: ctx }).includes("MCP002"));
});

test("MCP008 fires when a modern server does not implement server/discover", () => {
  const findings = evaluate({
    live: dualEra({ discoverImplemented: false, modernRequestsServed: true }),
  });
  const f = findings.find((x) => x.ruleId === "MCP008");
  assert.ok(f, "servers MUST implement server/discover");
  assert.equal(f.severity, "warning");
});

test("MCP008 stays quiet for a legacy-only server — that is MCP001's finding", () => {
  assert.ok(!ids({ live: legacyOnly() }).includes("MCP008"));
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

  test(`${ruleId} drops to an observation when '${capability}' is legacy-only`, () => {
    // Advertised in the legacy handshake of a dual-era server: the client
    // being served there expects it, and deprecated features stay functional
    // through the deprecation window.
    const findings = evaluate({
      live: dualEra({ advertisedCapabilities: [capability], capabilitiesEra: "legacy" }),
    });
    const f = findings.find((x) => x.ruleId === ruleId);
    assert.ok(f);
    assert.equal(f.severity, "info");
    assert.equal(gradeFrom(findings).letter, "A", "an observation costs no points");
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

function rustSdkDep(
  name: string,
  constraint: string,
  features?: string[],
): SdkDependency {
  return {
    ecosystem: "cargo",
    name,
    constraint,
    manifest: "Cargo.toml",
    ...(features ? { features } : {}),
  };
}

function withRustDeps(...deps: SdkDependency[]): SourceContext {
  return { matches: {}, sdkVersion: null, filesScanned: 1, sdkDependencies: deps };
}

const GO_SDK = "github.com/modelcontextprotocol/go-sdk";
const MCP_GO = "github.com/mark3labs/mcp-go";

function goSdkDep(
  name: string,
  constraint: string,
  extra: Partial<SdkDependency> = {},
): SdkDependency {
  return {
    ecosystem: "go",
    name,
    constraint,
    manifest: "go.mod",
    line: 5,
    sdkLine: classifyGoSdkVersion(name, constraint),
    ...extra,
  };
}

/**
 * A Go source context: module requirements plus whichever Go signals matched.
 *
 * The signals matter as much as the manifest here — MCP011's second hit is an
 * argument from the absence of one of them, so a test that omits them is not
 * testing the rule that ships.
 */
function withGoDeps(
  deps: SdkDependency[],
  signals: { streamableHttp?: boolean; statelessOptIn?: boolean } = {},
): SourceContext {
  const matches: Record<string, SourceMatch[]> = {};
  if (signals.streamableHttp) {
    matches.goStreamableHttp = [
      { file: "main.go", line: 31, text: "handler := mcp.NewStreamableHTTPHandler(get, nil)" },
    ];
  }
  if (signals.statelessOptIn) {
    matches.goStatelessOptIn = [
      { file: "main.go", line: 30, text: "opts := &mcp.StreamableHTTPOptions{Stateless: true}" },
    ];
  }
  return { matches, sdkVersion: null, filesScanned: 1, sdkDependencies: deps };
}

function pythonRequirement(
  sdkLine: PythonSdkRequirement["sdkLine"],
  specifier: string,
): PythonSdkRequirement {
  return {
    file: "pyproject.toml",
    line: 8,
    requirement: `mcp${specifier}`,
    specifier,
    sdkLine,
  };
}

// ── MCP011 (Go) ─────────────────────────────────────────────────────────
//
// The threshold is the point of these. Go crossed the protocol break inside
// its v1 line, so a major-version test — the shape MCP007/MCP009/MCP010 use —
// would never fire. v1.6.1 must fire and v1.7.0 must not, and no assertion
// here may be satisfiable by a major-only comparison.

test("MCP011 fires on the official Go SDK below v1.7.0", () => {
  for (const version of ["v1.0.0", "v1.4.1", "v1.6.0-pre.1", "v1.6.1"]) {
    const ctx = withGoDeps([goSdkDep(GO_SDK, version)]);
    const f = evaluate({ source: ctx }).find((x) => x.ruleId === "MCP011");
    assert.ok(f, `MCP011 should fire for go-sdk ${version}`);
    assert.ok(f.fix.includes("v1.7.0"), `fix should name v1.7.0 for ${version}`);
  }
});

test("MCP011 stays quiet for the official Go SDK at v1.7.0 and later", () => {
  // v1.7.0-pre.1 is the trap: strict semver sorts it below v1.7.0, but it is
  // the release that shipped 2026-07-28 support and must not be flagged.
  for (const version of ["v1.7.0-pre.1", "v1.7.0", "v1.8.0", "v2.0.0"]) {
    const ctx = withGoDeps([goSdkDep(GO_SDK, version)]);
    assert.ok(
      !ids({ source: ctx }).includes("MCP011"),
      `MCP011 should not fire for go-sdk ${version}`,
    );
  }
});

test("MCP011 fires on mark3labs/mcp-go below v1.0.0", () => {
  for (const version of ["v0.32.0", "v0.58.0"]) {
    const ctx = withGoDeps([goSdkDep(MCP_GO, version)]);
    const f = evaluate({ source: ctx }).find((x) => x.ruleId === "MCP011");
    assert.ok(f, `MCP011 should fire for mcp-go ${version}`);
    assert.ok(f.fix.includes("v1.0.0"), `fix should name v1.0.0 for ${version}`);
  }
});

test("MCP011 stays quiet for mark3labs/mcp-go at v1.0.0 and later", () => {
  for (const version of ["v1.0.0-beta.1", "v1.0.0", "v1.2.0"]) {
    const ctx = withGoDeps([goSdkDep(MCP_GO, version)]);
    assert.ok(
      !ids({ source: ctx }).includes("MCP011"),
      `MCP011 should not fire for mcp-go ${version}`,
    );
  }
});

test("MCP011 never advises a v2 module path — Go has none", () => {
  const ctx = withGoDeps([goSdkDep(GO_SDK, "v1.6.1")]);
  const f = evaluate({ source: ctx }).find((x) => x.ruleId === "MCP011");
  assert.ok(f);
  assert.ok(!f.fix.includes("go-sdk/v2"), "there is no /v2 module path to migrate to");
  assert.ok(f.fix.includes("module path does not change"));
});

test("MCP011 reports every affected module, not just the first", () => {
  const ctx = withGoDeps([goSdkDep(GO_SDK, "v1.6.1"), goSdkDep(MCP_GO, "v0.58.0")]);
  const f = evaluate({ source: ctx }).find((x) => x.ruleId === "MCP011");
  assert.ok(f);
  assert.ok(f.detail.includes(GO_SDK));
  assert.ok(f.detail.includes(MCP_GO));
});

test("MCP011 ignores indirect and replaced requirements", () => {
  // `// indirect` is not this project's SDK choice, and a `replace` means the
  // required version is not what builds. Both must be silent in both
  // directions: no finding, and no claim of modernity either.
  for (const extra of [{ indirect: true }, { replaced: true, sdkLine: "unknown" as const }]) {
    const ctx = withGoDeps([goSdkDep(GO_SDK, "v1.6.1", extra)]);
    assert.ok(
      !ids({ source: ctx }).includes("MCP011"),
      `MCP011 should stay quiet for ${JSON.stringify(extra)}`,
    );
  }
});

test("MCP011 stays quiet on a version it cannot classify", () => {
  for (const version of ["v0.0.0-20260801000000-abcdef123456", "v2.1.0+incompatible", "latest"]) {
    const ctx = withGoDeps([goSdkDep(GO_SDK, version)]);
    assert.ok(
      !ids({ source: ctx }).includes("MCP011"),
      `MCP011 should stay quiet for ${version}`,
    );
  }
});

test("MCP011 fires when a modern go-sdk serves HTTP without the stateless opt-in", () => {
  const ctx = withGoDeps([goSdkDep(GO_SDK, "v1.7.0")], { streamableHttp: true });
  const f = evaluate({ source: ctx }).find((x) => x.ruleId === "MCP011");
  assert.ok(f, "an upgraded but stateful HTTP server still cannot serve the revision");
  assert.ok(f.fix.includes("Stateless: true"));
  assert.ok(f.detail.includes("main.go:31"), "should point at the transport it read");
});

test("MCP011 stays quiet when the stateless opt-in is present", () => {
  const ctx = withGoDeps([goSdkDep(GO_SDK, "v1.7.0")], {
    streamableHttp: true,
    statelessOptIn: true,
  });
  assert.ok(!ids({ source: ctx }).includes("MCP011"));
});

test("MCP011 does not ask a stdio server for a flag it does not need", () => {
  // stdio does not implement the version-restricting transport interface, so
  // it serves the revision on the module version alone. The SDK's own headline
  // example is a stdio server; flagging it would be a false positive on the
  // most common shape there is.
  const ctx = withGoDeps([goSdkDep(GO_SDK, "v1.7.0")]);
  assert.ok(!ids({ source: ctx }).includes("MCP011"));
});

test("MCP011 does not apply the stateless requirement to mark3labs", () => {
  // mcp-go advertises every version it implements by default, so a stateful
  // HTTP server on v1.0.0 is not a defect. Only the official SDK gates.
  const ctx = withGoDeps([goSdkDep(MCP_GO, "v1.0.0")], { streamableHttp: true });
  assert.ok(!ids({ source: ctx }).includes("MCP011"));
});

test("MCP011 blames the module that declares the requirement, not a sibling", () => {
  // A repository-wide absence check produced the sentence "services/notes/go.mod
  // requires v1.7.0 … but the transport at legacy/demo/main.go is configured
  // without Stateless" — a specific, checkable claim about a file belonging to
  // a different module. Ownership is the nearest enclosing go.mod.
  const modern = goSdkDep(GO_SDK, "v1.7.0", { manifest: "services/notes/go.mod" });
  const legacy = goSdkDep(GO_SDK, "v1.6.1", { manifest: "legacy/demo/go.mod" });
  const ctx: SourceContext = {
    matches: {
      goStreamableHttp: [
        { file: "legacy/demo/main.go", line: 9, text: "mcp.NewStreamableHTTPHandler(g, nil)" },
      ],
    },
    sdkVersion: null,
    filesScanned: 2,
    sdkDependencies: [modern, legacy],
  };
  const f = evaluate({ source: ctx }).find((x) => x.ruleId === "MCP011");
  assert.ok(f);
  assert.ok(f.location?.startsWith("legacy/demo/go.mod"), "the finding belongs to the legacy module");
  assert.ok(
    !f.detail.includes("services/notes/go.mod"),
    "the modern module must not be blamed for a sibling's transport",
  );
});

test("MCP011 clamps an overlong version token before quoting it", () => {
  const ctx = withGoDeps([goSdkDep(GO_SDK, `v1.6.1-${"a".repeat(400)}`)]);
  const f = evaluate({ source: ctx }).find((x) => x.ruleId === "MCP011");
  assert.ok(f);
  assert.ok(f.detail.length < 300, `detail should be clamped, got ${f.detail.length}`);
});

test("a migrated module does not acquit an un-migrated one beside it", () => {
  // Modern evidence read from a go.mod speaks for that module and no other.
  // Repository-wide, a single migrated sibling silenced both criticals on this
  // repo's own go-notes-mcp fixture — 60 points — and nothing pinned it.
  const ctx: SourceContext = {
    matches: {
      initialize: [{ file: "legacy/main.go", line: 12, text: "InitializedHandler:" }],
      sessionId: [{ file: "legacy/main.go", line: 9, text: "GetSessionID:" }],
      modernEra: [
        { file: "tools/go.mod", line: 3, text: `${GO_SDK} v1.7.0` },
      ],
    },
    sdkVersion: null,
    filesScanned: 2,
    goManifests: ["legacy/go.mod", "tools/go.mod"],
    sdkDependencies: [
      goSdkDep(GO_SDK, "v1.6.1", { manifest: "legacy/go.mod" }),
      goSdkDep(GO_SDK, "v1.7.0", { manifest: "tools/go.mod" }),
    ],
  };
  const fired = ids({ source: ctx });
  assert.ok(fired.includes("MCP001"), "the legacy module is still legacy-only");
  assert.ok(fired.includes("MCP002"), "and its session handling is still unguarded");
});

test("modern evidence still covers the module it belongs to", () => {
  const ctx: SourceContext = {
    matches: {
      sessionId: [{ file: "svc/main.go", line: 9, text: "GetSessionID:" }],
      modernEra: [{ file: "svc/go.mod", line: 3, text: `${GO_SDK} v1.7.0` }],
    },
    sdkVersion: null,
    filesScanned: 1,
    goManifests: ["svc/go.mod"],
    sdkDependencies: [goSdkDep(GO_SDK, "v1.7.0", { manifest: "svc/go.mod" })],
  };
  assert.ok(!ids({ source: ctx }).includes("MCP002"));
});

test("an unclassifiable Go requirement is not spent as a critical", () => {
  // A `replace` to a fork and a `go get …@main` pseudo-version are routine, and
  // both leave the requirement unreadable. MCP011 already stays quiet; MCP002's
  // source arm was firing on the absence instead — on a `sessionId` tool
  // argument, which is what MCP002's own fix recommends.
  for (const version of ["v1.7.1-0.20260901120000-abcdef123456", "v1.7.0"]) {
    const replaced = version === "v1.7.0";
    const ctx: SourceContext = {
      matches: { sessionId: [{ file: "main.go", line: 4, text: 'SessionID string `json:"sessionId"`' }] },
      sdkVersion: null,
      filesScanned: 1,
      goManifests: ["go.mod"],
      sdkDependencies: [
        goSdkDep(GO_SDK, version, {
          manifest: "go.mod",
          ...(replaced ? { replaced: true, sdkLine: "unknown" as const } : {}),
        }),
      ],
    };
    assert.ok(
      !ids({ source: ctx }).includes("MCP002"),
      `MCP002 should stay quiet for ${replaced ? "a replaced module" : version}`,
    );
  }
});

test("Go evidence says nothing about a Python or TypeScript server", () => {
  // `dirOf("go.mod")` is "" and every path starts with "", so a Go module at
  // the repository root "owned" server.py and index.ts — and a polyglot repo
  // with a Go tooling module acquitted its Python MCP server.
  const ctx: SourceContext = {
    matches: {
      initialize: [{ file: "src/index.ts", line: 3, text: "server.oninitialized = …" }],
      modernEra: [{ file: "go.mod", line: 3, text: `${GO_SDK} v1.7.0` }],
    },
    sdkVersion: null,
    filesScanned: 2,
    goManifests: ["go.mod"],
    sdkDependencies: [goSdkDep(GO_SDK, "v1.7.0", { manifest: "go.mod" })],
  };
  assert.ok(ids({ source: ctx }).includes("MCP001"), "a Go version cannot acquit a TS server");
});

test("the verdict does not depend on which match sorts first", () => {
  // Scoping to whichever match sorted first made two byte-identical trees
  // disagree purely on directory names: the modern module's own dual-era
  // token was selected, found acquitted, and the whole repository read clean.
  const build = (modern: string, legacy: string): SourceContext => ({
    matches: {
      initialize: [
        { file: `${modern}/main.go`, line: 9, text: "InitializedHandler:" },
        { file: `${legacy}/main.go`, line: 9, text: "InitializedHandler:" },
      ].sort((a, b) => a.file.localeCompare(b.file)),
      modernEra: [{ file: `${modern}/go.mod`, line: 3, text: `${GO_SDK} v1.7.0` }],
    },
    sdkVersion: null,
    filesScanned: 2,
    goManifests: [`${modern}/go.mod`, `${legacy}/go.mod`],
    sdkDependencies: [
      goSdkDep(GO_SDK, "v1.7.0", { manifest: `${modern}/go.mod` }),
      goSdkDep(GO_SDK, "v1.6.1", { manifest: `${legacy}/go.mod` }),
    ],
  });
  for (const [modern, legacy] of [["a-modern", "z-legacy"], ["z-modern", "a-legacy"]]) {
    assert.ok(
      ids({ source: build(modern, legacy) }).includes("MCP001"),
      `${modern} + ${legacy}: the legacy module is still legacy-only`,
    );
  }
});

test("MCP011 needs a checkout — a live probe cannot see go.mod", () => {
  assert.ok(!ids({ live: legacyOnly() }).includes("MCP011"));
});

test("an info finding costs no points, so compatibility cannot lower a grade", () => {
  const clean = gradeFrom(evaluate({ live: dualEra() }));
  assert.equal(clean.score, 100);
  assert.equal(clean.letter, "A");
});

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
  assert.ok(!ids({ live: legacyOnly() }).includes("MCP007"));
});

test("MCP009 fires when Python project metadata only permits SDK v1", () => {
  const ctx = withSdk(null);
  ctx.pythonSdkRequirements = [pythonRequirement("legacy", ">=1.28,<2")];
  const f = evaluate({ source: ctx }).find((finding) => finding.ruleId === "MCP009");
  assert.ok(f);
  assert.equal(f.location, "pyproject.toml:8");
  assert.ok(f.detail.includes("mcp>=1.28,<2"));
});

test("MCP009 fires on the official Python SDK's v1 FastMCP import", () => {
  const ctx = source("pythonV1Sdk", {
    file: "server.py",
    line: 2,
    text: "from mcp.server.fastmcp import FastMCP",
  });
  const found = ids({ source: ctx });
  assert.ok(found.includes("MCP009"));
  assert.ok(found.includes("MCP001"), "the v1 server import is legacy-server evidence");
});

test("a low-level Python server constrained to SDK v1 fires MCP001", () => {
  const ctx = source("pythonServerSdk", {
    file: "server.py",
    line: 1,
    text: "from mcp.server.lowlevel import Server",
  });
  ctx.pythonSdkRequirements = [pythonRequirement("legacy", "<2")];
  const found = ids({ source: ctx });
  assert.ok(found.includes("MCP001"));
  assert.ok(found.includes("MCP009"));
});

test("MCP009 stays quiet for Python SDK v2 and ambiguous constraints", () => {
  for (const requirement of [
    pythonRequirement("modern", ">=2,<3"),
    pythonRequirement("unknown", ">=1.28"),
    pythonRequirement("unknown", ""),
  ]) {
    const ctx = withSdk(null);
    ctx.pythonSdkRequirements = [requirement];
    assert.ok(!ids({ source: ctx }).includes("MCP009"), requirement.requirement);
  }
});

test("MCP009 points to the official Python migration and class rename", () => {
  const ctx = withSdk(null);
  ctx.pythonSdkRequirements = [pythonRequirement("legacy", "<2")];
  const f = evaluate({ source: ctx }).find((finding) => finding.ruleId === "MCP009");
  assert.ok(f);
  assert.ok(f.fix.includes("from mcp.server import MCPServer"));
  assert.equal(f.specRef, "https://py.sdk.modelcontextprotocol.io/migration/");
});

test("MCP009 needs a checkout — a live probe cannot see Python metadata", () => {
  assert.ok(!ids({ live: legacyOnly() }).includes("MCP009"));
});

test("MCP010 fires on rmcp with major < 3", () => {
  for (const version of ["1.0.0", "2.3.1", "^2"]) {
    const ctx = withRustDeps(rustSdkDep("rmcp", version));
    const f = evaluate({ source: ctx }).find((x) => x.ruleId === "MCP010");
    assert.ok(f, `MCP010 should fire for rmcp ${version}`);
    assert.ok(f.fix.includes("3.x"), `fix should mention 3.x for ${version}`);
  }
});

test("MCP010 stays quiet for rmcp >= 3", () => {
  for (const version of ["3.0.0", "3.1.4", "^3"]) {
    const ctx = withRustDeps(rustSdkDep("rmcp", version));
    assert.ok(
      !ids({ source: ctx }).includes("MCP010"),
      `MCP010 should not fire for rmcp ${version}`,
    );
  }
});

test("MCP010 fires on rust-mcp-sdk v1.x", () => {
  for (const version of ["0.5.0", "1.0.0", "1.5.2"]) {
    const ctx = withRustDeps(rustSdkDep("rust-mcp-sdk", version));
    const f = evaluate({ source: ctx }).find((x) => x.ruleId === "MCP010");
    assert.ok(f, `MCP010 should fire for rust-mcp-sdk ${version}`);
    assert.ok(f.fix.includes("rmcp 3.x"), `fix should mention rmcp 3.x for ${version}`);
  }
});

test("MCP010 stays quiet for rust-mcp-sdk >= 2", () => {
  for (const version of ["2.0.0", "^2"]) {
    const ctx = withRustDeps(rustSdkDep("rust-mcp-sdk", version));
    assert.ok(
      !ids({ source: ctx }).includes("MCP010"),
      `MCP010 should not fire for rust-mcp-sdk ${version}`,
    );
  }
});

test("MCP010 fires on tower-mcp without the protocol-2026-07-28 feature", () => {
  const ctx = withRustDeps(rustSdkDep("tower-mcp", "1.0.0", ["sse"]));
  const f = evaluate({ source: ctx }).find((x) => x.ruleId === "MCP010");
  assert.ok(f);
  assert.ok(f.fix.includes("protocol-2026-07-28"));
  // tower-mcp finding should cite its own repo, not the umbrella rmcp URL
  assert.equal(f.specRef, "https://github.com/joshrotenberg/tower-mcp");
});

test("MCP010 stays quiet for tower-mcp with the protocol-2026-07-28 feature", () => {
  const ctx = withRustDeps(rustSdkDep("tower-mcp", "1.0.0", ["protocol-2026-07-28"]));
  assert.ok(!ids({ source: ctx }).includes("MCP010"));
});

test("MCP010 stays quiet when no cargo dependencies are present", () => {
  assert.ok(!ids({ source: withSdk("^1.17.0") }).includes("MCP010"));
});

test("MCP010 stays quiet when tower-mcp features are not parsed", () => {
  // The rule can only report a missing protocol-2026-07-28 feature when it
  // has actually parsed a feature list that omits it.  An unparsed dependency
  // (no explicit features array in the same manifest) is silently skipped.
  const ctx = withRustDeps(rustSdkDep("tower-mcp", "1.0.0"));
  assert.ok(!ids({ source: ctx }).includes("MCP010"));
});

test("MCP010 needs a checkout — a live probe cannot see Cargo.toml", () => {
  assert.ok(!ids({ live: legacyOnly() }).includes("MCP010"));
});

test("MCP010 stays quiet on version ranges it cannot read unambiguously", () => {
  // ">=1, <4" permits 3.x, which is clean. Guessing from the first digit run
  // anywhere in the string graded those as stale.
  for (const constraint of [">=1, <4", ">= 1.0", "*"]) {
    const ctx = withRustDeps(rustSdkDep("rmcp", constraint));
    assert.ok(
      !ids({ source: ctx }).includes("MCP010"),
      `MCP010 should not fire for rmcp "${constraint}"`,
    );
  }
});

test("MCP010 names the section when a crate is not a production dependency", () => {
  const dev = { ...rustSdkDep("rmcp", "1.0.0"), section: "dev-dependencies" as const };
  const f = evaluate({ source: withRustDeps(dev) }).find((x) => x.ruleId === "MCP010");
  assert.ok(f);
  assert.ok(
    f.detail.includes("[dev-dependencies]"),
    "the reader cannot judge the finding without the section",
  );
});

test("MCP010 leaves the detail unqualified for a plain [dependencies] crate", () => {
  const prod = { ...rustSdkDep("rmcp", "1.0.0"), section: "dependencies" as const };
  const f = evaluate({ source: withRustDeps(prod) }).find((x) => x.ruleId === "MCP010");
  assert.ok(f);
  assert.ok(!f.detail.includes("under ["));
});

test("MCP010 reports every affected crate, not just the first", () => {
  const ctx = withRustDeps(
    rustSdkDep("rmcp", "1.0.0"),
    rustSdkDep("tower-mcp", "1.0.0", ["sse"]),
  );
  const f = evaluate({ source: ctx }).find((x) => x.ruleId === "MCP010");
  assert.ok(f);
  assert.ok(f.detail.includes("rmcp"), "rmcp should be named");
  assert.ok(f.detail.includes("tower-mcp"), "tower-mcp must not be hidden behind rmcp");
  assert.ok(f.fix.includes("protocol-2026-07-28"), "both fixes should be offered");
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
    if (rule.references) {
      for (const ref of rule.references) {
        assert.ok(
          ref.startsWith("https://"),
          `${rule.id} reference must be absolute https, got ${ref}`,
        );
        assert.ok(
          !ref.includes("#"),
          `${rule.id} reference relies on an anchor: ${ref}`,
        );
      }
    }
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
    if (!rule.specRef.startsWith(root)) continue; // SDK rules cite their release/migration docs
    assert.ok(
      rule.specRef.startsWith(`${root}/`) && rule.specRef.length > root.length + 1,
      `${rule.id} must cite a subpage under ${root}/, got ${rule.specRef}`,
    );
  }
});

test("a fired finding always carries a fix and a spec reference", () => {
  const sourceContext = withSdk("^1.17.0");
  sourceContext.pythonSdkRequirements = [pythonRequirement("legacy", "<2")];
  sourceContext.sdkDependencies = [rustSdkDep("rmcp", "2.0.0"), goSdkDep(GO_SDK, "v1.6.1")];
  const everything = evaluate({
    live: legacyOnly({
      sessionIdOnModernRequest: true,
      advertisedCapabilities: ["logging", "sampling", "roots"],
      authRequired: true,
    }),
    source: sourceContext,
  });

  assert.deepEqual(
    everything.map((f) => f.ruleId).sort(),
    [
      "MCP001",
      "MCP002",
      "MCP003",
      "MCP004",
      "MCP005",
      "MCP006",
      "MCP007",
      "MCP009",
      "MCP010",
      "MCP011",
    ],
    "every defect rule should fire on this context",
  );
  for (const f of everything) {
    assert.ok(f.fix.length > 0, `${f.ruleId} has no fix text`);
    assert.ok(f.specRef.length > 0, `${f.ruleId} has no specRef`);
    assert.ok(f.detail.length > 0, `${f.ruleId} has no detail`);
  }
});

test("the Go ownership index is rebuilt when its source context changes", () => {
  // The cache is keyed on the source object, which is mutable — this suite
  // builds one and then assigns to it. A scope served from before a mutation
  // would answer about dependencies that were not there yet.
  const ctx: SourceContext = {
    matches: { sessionId: [{ file: "svc/main.go", line: 9, text: "GetSessionID:" }] },
    sdkVersion: null,
    filesScanned: 1,
  };
  assert.ok(ids({ source: ctx }).includes("MCP002"), "no evidence yet");

  ctx.goManifests = ["svc/go.mod"];
  ctx.sdkDependencies = [goSdkDep(GO_SDK, "v1.7.0", { manifest: "svc/go.mod" })];
  ctx.matches.modernEra = [{ file: "svc/go.mod", line: 3, text: `${GO_SDK} v1.7.0` }];
  assert.ok(
    !ids({ source: ctx }).includes("MCP002"),
    "the same object, now carrying evidence, must be re-read",
  );
});
