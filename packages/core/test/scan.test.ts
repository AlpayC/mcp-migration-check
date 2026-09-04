import assert from "node:assert/strict";
import { test } from "node:test";

import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  classifyGoSdkVersion,
  classifyPythonSdkSpecifier,
  parseCargoToml,
  parseGoMod,
  parsePythonSdkRequirements,
  scanSource,
} from "../src/scan";

test("classifies only Python SDK constraints that force one major line", () => {
  const cases = [
    [">=1.28,<2", "legacy"],
    ["<2", "legacy"],
    ["==1.29.0", "legacy"],
    ["~=1.28", "legacy"],
    ["^1.28", "legacy"],
    [">=2,<3", "modern"],
    ["==2.1.0", "modern"],
    ["~=2.0", "modern"],
    ["^2.0", "modern"],
    [">=1.28", "unknown"],
    ["*", "unknown"],
    ["", "unknown"],
    ["@ git+https://example.com/mcp.git", "unknown"],
  ] as const;

  for (const [specifier, expected] of cases) {
    assert.equal(classifyPythonSdkSpecifier(specifier), expected, specifier);
  }
});

test("parses standard and Poetry dependencies from pyproject.toml", () => {
  const standard = parsePythonSdkRequirements(
    "pyproject.toml",
    `[project]\nname = "demo"\ndependencies = [\n  "httpx>=0.28",\n  "mcp[cli]>=1.28,<2",\n  "mcp-types>=2",\n]\n`,
  );
  assert.deepEqual(
    standard.map(({ requirement, sdkLine, line }) => ({ requirement, sdkLine, line })),
    [{ requirement: "mcp[cli]>=1.28,<2", sdkLine: "legacy", line: 5 }],
  );

  const poetry = parsePythonSdkRequirements(
    "services/api/pyproject.toml",
    `[tool.poetry.dependencies]\npython = "^3.12"\nmcp = { version = "^2.0", extras = ["cli"] }\n`,
  );
  assert.equal(poetry.length, 1);
  assert.equal(poetry[0].specifier, "^2.0");
  assert.equal(poetry[0].sdkLine, "modern");
});

test("parses requirements, Pipfile, and setup.cfg without matching mcp-types", () => {
  const inputs = [
    ["requirements-prod.txt", "mcp[cli]==1.29.0  # pinned\nmcp-types==2.1.0\n"],
    ["Pipfile", '[packages]\nmcp = ">=2,<3"\n'],
    ["setup.cfg", "[options]\ninstall_requires =\n    mcp~=1.28\n    mcp-agent>=0.1\n"],
  ] as const;

  const found = inputs.flatMap(([file, content]) =>
    parsePythonSdkRequirements(file, content),
  );
  assert.deepEqual(
    found.map(({ requirement, sdkLine }) => ({ requirement, sdkLine })),
    [
      { requirement: "mcp[cli]==1.29.0", sdkLine: "legacy" },
      { requirement: "mcp>=2,<3", sdkLine: "modern" },
      { requirement: "mcp~=1.28", sdkLine: "legacy" },
    ],
  );
});

// ── parseCargoToml ──────────────────────────────────────────────────────

const CARGO_DEPS = `[dependencies]
serde = { version = "1", features = ["derive"] }
rmcp = "3.1.4"
reqwest = "0.12"
`;

const CARGO_TABLE_FORM = `[dependencies]
rmcp = { version = "3", features = ["server", "sse"] }
`;

const CARGO_DEV_DEPS = `[dev-dependencies]
rmcp = "2.0.0"
`;

const CARGO_WORKSPACE_DEPS = `[workspace.dependencies]
rmcp = { version = "3.2.0" }
`;

const CARGO_MULTI_FEATURES = `[dependencies]
tower-mcp = { version = "1.0.0", features = ["protocol-2026-07-28", "transport"] }
`;

const CARGO_EMPTY = `[package]
name = "demo"
version = "0.1.0"
`;

const CARGO_UNSUPPORTED = `[dependencies]
rig-core = "0.1"
mcp-server = "0.5"
`;

const CARGO_MIXED = `[dependencies]
rmcp = "3.1.0"
rust-mcp-sdk = "0.4.0"
serde = "1"
[dev-dependencies]
tower-mcp = { version = "1.0", features = ["sse"] }
`;

test("parseCargoToml handles inline string form", () => {
  const deps = parseCargoToml(CARGO_DEPS);
  assert.equal(deps.length, 1);
  assert.equal(deps[0].name, "rmcp");
  assert.equal(deps[0].constraint, "3.1.4");
  assert.equal(deps[0].ecosystem, "cargo");
  assert.equal(deps[0].manifest, "Cargo.toml");
  assert.equal(deps[0].features, undefined);
});

test("parseCargoToml handles table form with features", () => {
  const deps = parseCargoToml(CARGO_TABLE_FORM);
  assert.equal(deps.length, 1);
  assert.equal(deps[0].name, "rmcp");
  assert.equal(deps[0].constraint, "3");
  assert.deepEqual(deps[0].features, ["server", "sse"]);
});

test("parseCargoToml handles [dev-dependencies] section", () => {
  const deps = parseCargoToml(CARGO_DEV_DEPS);
  assert.equal(deps.length, 1);
  assert.equal(deps[0].name, "rmcp");
  assert.equal(deps[0].constraint, "2.0.0");
});

test("parseCargoToml handles [workspace.dependencies] section", () => {
  const deps = parseCargoToml(CARGO_WORKSPACE_DEPS);
  assert.equal(deps.length, 1);
  assert.equal(deps[0].name, "rmcp");
  assert.equal(deps[0].constraint, "3.2.0");
});

test("parseCargoToml identifies all three supported crates", () => {
  const content = [
    "[dependencies]",
    'rmcp = "3.0.0"',
    'rust-mcp-sdk = "0.5.0"',
    'tower-mcp = "1.0.0"',
  ].join("\n");
  const deps = parseCargoToml(content);
  const names = deps.map((d) => d.name).sort();
  assert.deepEqual(names, ["rmcp", "rust-mcp-sdk", "tower-mcp"]);
});

test("parseCargoToml ignores unsupported crates", () => {
  const deps = parseCargoToml(CARGO_UNSUPPORTED);
  assert.equal(deps.length, 0);
});

test("parseCargoToml handles multiple dependencies in same section", () => {
  const deps = parseCargoToml(CARGO_MIXED);
  assert.equal(deps.length, 3);
  assert.equal(deps[0].name, "rmcp");
  assert.equal(deps[1].name, "rust-mcp-sdk");
  assert.equal(deps[2].name, "tower-mcp");
  assert.deepEqual(deps[2].features, ["sse"]);
});

test("parseCargoToml returns empty array for manifest with no MCP crates", () => {
  assert.deepEqual(parseCargoToml(CARGO_EMPTY), []);
});

test("parseCargoToml skips lines outside dependency sections", () => {
  const content = [
    '[package]',
    'name = "demo"',
    '',
    '[dependencies]',
    'rmcp = "3.0.0"',
    '',
    '[profile.release]',
    'opt-level = 3',
  ].join("\n");
  const deps = parseCargoToml(content);
  assert.equal(deps.length, 1);
  assert.equal(deps[0].name, "rmcp");
});

test("parseCargoToml ignores target-specific dependency sections", () => {
  const content = [
    '[target.x86_64-unknown-linux-gnu.dependencies]',
    'rmcp = "2.0.0"',
    '',
    '[dependencies]',
    'rmcp = "3.0.0"',
  ].join("\n");
  const deps = parseCargoToml(content);
  assert.equal(deps.length, 1);
  assert.equal(deps[0].constraint, "3.0.0");
});

test("parseCargoToml skips table deps without version string", () => {
  const content = [
    '[dependencies]',
    'rmcp = { git = "https://github.com/example/rmcp.git" }',
  ].join("\n");
  assert.deepEqual(parseCargoToml(content), []);
});

test("parseCargoToml handles features with whitespace variations", () => {
  const content = [
    '[dependencies]',
    'tower-mcp = { version = "1.0", features = [ "sse" , "protocol-2026-07-28" ] }',
  ].join("\n");
  const deps = parseCargoToml(content);
  assert.equal(deps.length, 1);
  assert.deepEqual(deps[0].features, ["sse", "protocol-2026-07-28"]);
});

test("parseCargoToml returns empty for empty input", () => {
  assert.deepEqual(parseCargoToml(""), []);
});

test("parseCargoToml handles Windows line endings", () => {
  const content = "[dependencies]\r\nrmcp = \"3.0.0\"\r\n";
  const deps = parseCargoToml(content);
  assert.equal(deps.length, 1);
  assert.equal(deps[0].constraint, "3.0.0");
});

// The three forms that graded A in silence. The sub-table is the common one in
// real manifests, which made it the worst of the three to miss.

test("parseCargoToml handles the [dependencies.rmcp] sub-table", () => {
  const content = [
    "[dependencies.rmcp]",
    'version = "1.2.0"',
    'features = ["server"]',
  ].join("\n");
  const deps = parseCargoToml(content);
  assert.equal(deps.length, 1);
  assert.equal(deps[0].name, "rmcp");
  assert.equal(deps[0].constraint, "1.2.0");
  assert.deepEqual(deps[0].features, ["server"]);
  assert.equal(deps[0].section, "dependencies");
});

test("parseCargoToml reads a sub-table under dev-dependencies", () => {
  const content = ["[dev-dependencies.rmcp]", 'version = "1.0.0"'].join("\n");
  const deps = parseCargoToml(content);
  assert.equal(deps.length, 1);
  assert.equal(deps[0].section, "dev-dependencies");
});

test("parseCargoToml ignores a sub-table for an unsupported crate", () => {
  const content = ["[dependencies.serde]", 'version = "1.0"'].join("\n");
  assert.deepEqual(parseCargoToml(content), []);
});

test("parseCargoToml closes a sub-table at the next section header", () => {
  const content = [
    "[dependencies.rmcp]",
    'version = "1.2.0"',
    "",
    "[package]",
    'version = "9.9.9"',
  ].join("\n");
  const deps = parseCargoToml(content);
  assert.equal(deps.length, 1);
  assert.equal(deps[0].constraint, "1.2.0", "the [package] version must not leak in");
});

test("parseCargoToml handles a multi-line inline table", () => {
  const content = [
    "[dependencies]",
    "rmcp = {",
    '  version = "1.2.0",',
    '  features = ["server"]',
    "}",
  ].join("\n");
  const deps = parseCargoToml(content);
  assert.equal(deps.length, 1);
  assert.equal(deps[0].constraint, "1.2.0");
  assert.deepEqual(deps[0].features, ["server"]);
});

test("parseCargoToml tolerates whitespace inside section brackets", () => {
  const content = ["[ dependencies ]", 'rmcp = "1.2.0"'].join("\n");
  const deps = parseCargoToml(content);
  assert.equal(deps.length, 1);
  assert.equal(deps[0].constraint, "1.2.0");
});

test("parseCargoToml records the section each dependency came from", () => {
  const deps = parseCargoToml(CARGO_MIXED);
  assert.equal(deps[0].section, "dependencies");
  assert.equal(deps[1].section, "dependencies");
  assert.equal(deps[2].section, "dev-dependencies");
});

test("parseCargoToml ignores a target-specific sub-table", () => {
  const content = [
    "[target.'cfg(unix)'.dependencies.rmcp]",
    'version = "1.0.0"',
  ].join("\n");
  assert.deepEqual(parseCargoToml(content), []);
});

test("parseCargoToml does not let an unterminated table swallow later sections", () => {
  const content = [
    "[dependencies]",
    "rmcp = {",
    '  version = "1.2.0"',
    "[package]",
    'name = "demo"',
  ].join("\n");
  const deps = parseCargoToml(content);
  assert.equal(deps.length, 1);
  assert.equal(deps[0].constraint, "1.2.0");
});

// ── classifyGoSdkVersion ────────────────────────────────────────────────
//
// Go crossed the protocol break at a MINOR: go-sdk v1.6.1 speaks 2025-11-25
// and v1.7.0 speaks 2026-07-28, on one module path with no /v2. Every case
// below is chosen so that a major-only comparison — the shape the TypeScript,
// Python and Rust rules use — would get it wrong.

const GO_SDK = "github.com/modelcontextprotocol/go-sdk";
const MCP_GO = "github.com/mark3labs/mcp-go";

test("classifies the official Go SDK on the v1.7.0 minor boundary", () => {
  const cases: [string, string][] = [
    ["v1.0.0", "legacy"],
    ["v1.6.0", "legacy"],
    ["v1.6.1", "legacy"],
    ["v1.6.9", "legacy"],
    // The pre-release of the crossing version already speaks the revision.
    // Strict semver would sort it below v1.7.0 and call it legacy.
    ["v1.7.0-pre.1", "modern"],
    ["v1.7.0", "modern"],
    ["v1.7.1", "modern"],
    ["v1.8.0", "modern"],
    ["v2.0.0", "modern"],
  ];
  for (const [version, expected] of cases) {
    assert.equal(classifyGoSdkVersion(GO_SDK, version), expected, version);
  }
});

test("classifies mark3labs/mcp-go on its own v1.0.0 boundary", () => {
  const cases: [string, string][] = [
    ["v0.16.1", "legacy"],
    ["v0.58.0", "legacy"],
    ["v1.0.0-beta.1", "modern"],
    ["v1.0.0", "modern"],
    ["v1.4.0", "modern"],
  ];
  for (const [version, expected] of cases) {
    assert.equal(classifyGoSdkVersion(MCP_GO, version), expected, version);
  }
});

test("a version that names a commit rather than a release is unknown", () => {
  // A pseudo-version identifies a commit on some branch; nothing in the string
  // says which protocol era that commit implements. Guessing costs a false
  // positive, so these produce no finding at all.
  for (const version of [
    "v0.0.0-20260101120000-abcdef123456",
    "v1.6.2-0.20260801000000-abcdef123456",
    "v1.7.0-pre.1.0.20260801000000-abcdef123456",
    "v2.1.0+incompatible",
    "latest",
    "",
    "1.7.0",
  ]) {
    assert.equal(classifyGoSdkVersion(GO_SDK, version), "unknown", version);
  }
});

test("an unrecognised module is unknown, whatever its version", () => {
  for (const module of [
    "github.com/metoro-io/mcp-golang",
    "github.com/ThinkInAIXYZ/go-mcp",
    "github.com/stretchr/testify",
  ]) {
    assert.equal(classifyGoSdkVersion(module, "v1.0.0"), "unknown", module);
  }
});

// ── parseGoMod ──────────────────────────────────────────────────────────

test("parseGoMod reads a single-line require", () => {
  const deps = parseGoMod(
    ["module example.com/srv", "", "go 1.25.0", "", `require ${GO_SDK} v1.6.1`].join("\n"),
  );
  assert.equal(deps.length, 1);
  assert.equal(deps[0].ecosystem, "go");
  assert.equal(deps[0].name, GO_SDK);
  assert.equal(deps[0].constraint, "v1.6.1");
  assert.equal(deps[0].manifest, "go.mod");
  assert.equal(deps[0].sdkLine, "legacy");
  assert.equal(deps[0].line, 5);
});

test("parseGoMod reads a require block and skips its blanks and comments", () => {
  const deps = parseGoMod(
    [
      "require (",
      "\t// the MCP server SDK",
      "",
      `\t${GO_SDK} v1.7.0`,
      "\tgithub.com/google/go-cmp v0.7.0",
      ")",
    ].join("\n"),
  );
  assert.equal(deps.length, 1);
  assert.equal(deps[0].constraint, "v1.7.0");
  assert.equal(deps[0].sdkLine, "modern");
});

test("parseGoMod records an indirect requirement rather than dropping it", () => {
  const deps = parseGoMod(["require (", `\t${MCP_GO} v0.58.0 // indirect`, ")"].join("\n"));
  assert.equal(deps.length, 1);
  assert.equal(deps[0].indirect, true);
  // Still classified — the rule decides what to do with it, the parser reports.
  assert.equal(deps[0].sdkLine, "legacy");
});

test("parseGoMod does not mistake a direct requirement for an indirect one", () => {
  const deps = parseGoMod([`require ${GO_SDK} v1.6.1 // pinned, see #418`].join("\n"));
  assert.equal(deps[0].indirect, undefined);
});

test("parseGoMod marks a replaced module unknown, in both directive forms", () => {
  // A replace can redirect the build to a fork or a local directory whose
  // protocol support the required version says nothing about. Reporting the
  // required version would be a confident lie.
  const single = parseGoMod(
    [`require ${GO_SDK} v1.6.1`, `replace ${GO_SDK} => ../local-go-sdk`].join("\n"),
  );
  assert.equal(single[0].replaced, true);
  assert.equal(single[0].sdkLine, "unknown");

  const block = parseGoMod(
    [
      `require ${GO_SDK} v1.6.1`,
      "replace (",
      `\t${GO_SDK} v1.6.1 => github.com/acme/go-sdk v1.6.4`,
      ")",
    ].join("\n"),
  );
  assert.equal(block[0].replaced, true);
  assert.equal(block[0].sdkLine, "unknown");
});

test("parseGoMod applies a replace declared after the require", () => {
  const deps = parseGoMod(
    [`require ${GO_SDK} v1.6.1`, "", `replace ${GO_SDK} => ./vendored`].join("\n"),
  );
  assert.equal(deps[0].replaced, true);
});

test("parseGoMod does not read exclude or retract as requirements", () => {
  const deps = parseGoMod(
    [
      `exclude ${GO_SDK} v1.5.0`,
      "retract (",
      "\tv0.1.0",
      ")",
      "exclude (",
      `\t${MCP_GO} v0.57.0`,
      ")",
    ].join("\n"),
  );
  assert.deepEqual(deps, []);
});

test("parseGoMod ignores module, go and toolchain directives", () => {
  const deps = parseGoMod(
    ["module github.com/acme/srv", "go 1.25.0", "toolchain go1.25.5"].join("\n"),
  );
  assert.deepEqual(deps, []);
});

test("parseGoMod ignores modules that are not MCP SDKs", () => {
  const deps = parseGoMod(
    [
      "require (",
      "\tgithub.com/metoro-io/mcp-golang v0.16.1",
      "\tgithub.com/stretchr/testify v1.11.1",
      ")",
    ].join("\n"),
  );
  assert.deepEqual(deps, []);
});

test("parseGoMod handles Windows line endings", () => {
  const deps = parseGoMod(`require (\r\n\t${GO_SDK} v1.6.1\r\n)\r\n`);
  assert.equal(deps.length, 1);
  assert.equal(deps[0].constraint, "v1.6.1");
});

test("parseGoMod returns empty for empty input", () => {
  assert.deepEqual(parseGoMod(""), []);
});

test("parseGoMod reads both recognised modules from one manifest", () => {
  const deps = parseGoMod(
    ["require (", `\t${GO_SDK} v1.6.1`, `\t${MCP_GO} v0.58.0`, ")"].join("\n"),
  );
  assert.deepEqual(
    deps.map((d) => d.name),
    [GO_SDK, MCP_GO],
  );
});

// ── the scan walk: what it must refuse to read ──────────────────────────

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mcpcheck-scan-"));
  try {
    await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("the scan does not follow a symlink out of the tree it was given", async () => {
  // A symlink is neither a directory nor, to `!isDirectory()`, anything worth
  // excluding — so `escape.go -> ../outside.txt` used to be read, and its lines
  // were reported as `escape.go:2`. That attributes content from outside the
  // repository to a path inside it.
  await withTempDir(async (dir) => {
    const repo = path.join(dir, "repo");
    await fs.mkdir(repo);
    await fs.writeFile(path.join(dir, "outside.txt"), "Mcp-Session-Id: leaked\n");
    await fs.symlink(path.join("..", "outside.txt"), path.join(repo, "escape.go"));

    const result = await scanSource(repo);
    assert.equal(result.filesScanned, 0, "the symlinked file must not be read");
    assert.deepEqual(result.matches.sessionId, []);
  });
});

test("the scan is not hung by a fifo with a scannable name", async (t) => {
  // A fifo reports size 0, so the size guard waves it through and the read then
  // blocks until a writer appears. That hung `--source`, and therefore the
  // GitHub Action, with no timeout above it to break the wait. The race below
  // fails the test rather than hanging the suite if the guard regresses.
  await withTempDir(async (dir) => {
    const repo = path.join(dir, "repo");
    await fs.mkdir(repo);
    try {
      execFileSync("mkfifo", [path.join(repo, "pipe.go")]);
    } catch {
      t.skip("mkfifo unavailable on this platform");
      return;
    }
    await fs.writeFile(path.join(repo, "ok.go"), "package main\n");

    const scanned = await Promise.race([
      scanSource(repo).then((r) => r.filesScanned),
      new Promise<number>((_, reject) =>
        setTimeout(() => reject(new Error("scanSource blocked on the fifo")), 5000).unref(),
      ),
    ]);
    assert.equal(scanned, 1, "only the regular file should be read");
  });
});

test("the Go streamable-HTTP signal matches the constructor, not just the option type", async () => {
  // Regression. The signal was first written as `\bStreamableHTTPHandler\b`,
  // which cannot match inside `NewStreamableHTTPHandler` — there is no word
  // boundary after `New`. A server that passes `nil` for its options never
  // names `StreamableHTTPOptions` either, so the one case MCP011's second hit
  // exists to catch was the one case that escaped it entirely.
  await withTempDir(async (dir) => {
    await fs.writeFile(
      path.join(dir, "main.go"),
      [
        "package main",
        "",
        'import "github.com/modelcontextprotocol/go-sdk/mcp"',
        "",
        "func main() {",
        "\th := mcp.NewStreamableHTTPHandler(getServer, nil)",
        "\t_ = h",
        "}",
      ].join("\n"),
    );
    const result = await scanSource(dir);
    assert.equal(result.matches.goStreamableHttp.length, 1);
    assert.equal(result.matches.goStatelessOptIn.length, 0);
  });
});

test("the Go stateless opt-in signal matches both SDKs' spellings", async () => {
  await withTempDir(async (dir) => {
    await fs.writeFile(
      path.join(dir, "main.go"),
      [
        "package main",
        "",
        "func main() {",
        "\topts := &mcp.StreamableHTTPOptions{Stateless: true}",
        "\tsrv := server.NewStreamableHTTPServer(s, server.WithStateLess(true))",
        "\t_, _ = opts, srv",
        "}",
      ].join("\n"),
    );
    const result = await scanSource(dir);
    assert.equal(result.matches.goStatelessOptIn.length, 2);
  });
});

// ── what the Go signals must NOT do to other languages ──────────────────
//
// Every case here was a real regression, found by adversarial review after the
// first implementation shipped bare identifiers into the language-neutral map.

test("Go SDK identifiers do not fire on TypeScript, Python or Rust source", async () => {
  // `SIGNAL_PATTERNS` runs over every language, so an unqualified Go
  // identifier there becomes a false positive in three other ecosystems. A
  // two-line TypeScript file declaring these went from a clean A to a D with a
  // critical.
  for (const ext of ["ts", "py", "rs"]) {
    await withTempDir(async (dir) => {
      await fs.writeFile(
        path.join(dir, `sample.${ext}`),
        "CreateMessageRequest SessionIdManager AddRoots RemoveRoots EnableSampling NewLoggingHandler",
      );
      const r = await scanSource(dir);
      for (const signal of ["sessionId", "sampling", "roots", "logging", "initialize"]) {
        assert.deepEqual(r.matches[signal], [], `${signal} must stay quiet in .${ext}`);
      }
    });
  }
});

test("unqualified lookalikes in Go source stay quiet", async () => {
  // An ordinary Go project: a workspace with roots, OpenTelemetry head
  // sampling, a slog handler constructor. None of it is MCP.
  await withTempDir(async (dir) => {
    await fs.writeFile(
      path.join(dir, "main.go"),
      [
        "package p",
        "func NewLoggingHandler(n slog.Handler) slog.Handler { return n }",
        "func (w *Workspace) AddRoots(rs []string) {}",
        "type CreateMessageRequest struct{}",
        "type SessionIdManager struct{}",
        "var EnableSampling bool",
      ].join("\n"),
    );
    const r = await scanSource(dir);
    for (const signal of ["sessionId", "sampling", "roots", "logging"]) {
      assert.deepEqual(r.matches[signal], [], `${signal} must stay quiet`);
    }
  });
});

test("qualified Go SDK calls still fire", async () => {
  // The other half: tightening must not silence real usage.
  await withTempDir(async (dir) => {
    await fs.writeFile(
      path.join(dir, "main.go"),
      [
        "package p",
        "func run() {",
        "\topts := &mcp.ServerOptions{GetSessionID: gen}",
        "\t_ = req.Session.Log(ctx, &mcp.LoggingMessageParams{})",
        "\t_, _ = ss.ListRoots(ctx, &mcp.ListRootsParams{})",
        "\tc := &mcp.ClientOptions{CreateMessageHandler: h}",
        "\t_ = opts",
        "\t_ = c",
        "}",
      ].join("\n"),
    );
    const r = await scanSource(dir);
    for (const signal of ["sessionId", "logging", "roots", "sampling"]) {
      assert.ok(r.matches[signal].length > 0, `${signal} should fire on qualified use`);
    }
  });
});

test("a quoted 2026-07-28 is not modern-era evidence", async () => {
  // It was, briefly, and a `// TODO: we do not support "2026-07-28" yet` in a
  // genuinely legacy TypeScript server silenced both of its criticals.
  await withTempDir(async (dir) => {
    await fs.writeFile(
      path.join(dir, "index.ts"),
      '// TODO(2027): we do not support "2026-07-28" yet.\n',
    );
    const r = await scanSource(dir);
    assert.deepEqual(r.matches.modernEra, []);
  });
});

test("a Go test file does not decide the production transport configuration", async () => {
  // A compat test that builds a stateful handler must not convict the stdio
  // server beside it, and a `Stateless: true` in a test must not acquit one.
  await withTempDir(async (dir) => {
    await fs.writeFile(
      path.join(dir, "compat_test.go"),
      "package p\nfunc TestX() { h := mcp.NewStreamableHTTPHandler(g, nil); _ = h }\n",
    );
    const r = await scanSource(dir);
    assert.deepEqual(r.matches.goStreamableHttp, []);
    assert.deepEqual(r.matches.goStatelessOptIn, []);
  });
});

test("a commented-out or negated stateless opt-in does not count", async () => {
  await withTempDir(async (dir) => {
    await fs.writeFile(
      path.join(dir, "main.go"),
      [
        "package p",
        "// TODO(2027): set Stateless: true once the session store is gone.",
        "// srv := server.NewStreamableHTTPServer(s, server.WithStateLess(false))",
        "func run() { _ = server.NewStreamableHTTPServer(s, server.WithStateLess(false)) }",
      ].join("\n"),
    );
    const r = await scanSource(dir);
    assert.deepEqual(r.matches.goStatelessOptIn, [], "neither a comment nor false is an opt-in");
  });
});

test("parseGoMod does not treat inherited Object properties as modules", async () => {
  // `"toString" in {}` is true and MCP_GO_MODULES["toString"] is a function,
  // whose [0] is undefined, and every `<` against undefined is false — so this
  // line fabricated a "modern" dependency and bought a grade. go.mod is
  // untrusted input when this runs as a GitHub Action over a pull request.
  for (const junk of ["toString", "constructor", "valueOf", "hasOwnProperty", "__proto__"]) {
    const deps = parseGoMod(`require (\n\t${junk} v1.0.0\n)`);
    assert.deepEqual(deps, [], `${junk} must not be read as a module`);
    assert.equal(classifyGoSdkVersion(junk, "v1.0.0"), "unknown", junk);
  }
});

test("`// indirect` must be the comment's first field, as Go itself requires", () => {
  const direct = parseGoMod(
    `require ${GO_SDK} v1.7.0 // pinned 2026-08; no longer indirect`,
  );
  assert.equal(direct[0].indirect, undefined, "prose mentioning the word is not the marker");

  const indirect = parseGoMod(`require ${GO_SDK} v1.6.1 // indirect`);
  assert.equal(indirect[0].indirect, true);

  const semicolon = parseGoMod(`require ${GO_SDK} v1.6.1 // indirect; see #418`);
  assert.equal(semicolon[0].indirect, true);
});

test("parseGoMod unquotes module and version tokens", () => {
  const deps = parseGoMod(`require "${GO_SDK}" "v1.6.1"`);
  assert.equal(deps.length, 1);
  assert.equal(deps[0].name, GO_SDK);
  assert.equal(deps[0].sdkLine, "legacy");
});

test("a `//` inside a string does not truncate the line", async () => {
  // `indexOf("//")` deleted whatever followed a URL on the same line, which
  // both invented a finding (a stateless server read as stateful) and hid one
  // (a stateful server acquitted by moving a URL onto its transport line).
  await withTempDir(async (dir) => {
    await fs.writeFile(
      path.join(dir, "main.go"),
      'package p\nfunc r() { o := &mcp.StreamableHTTPOptions{Endpoint: "https://x/mcp", Stateless: true} }\n',
    );
    const r = await scanSource(dir);
    assert.equal(r.matches.goStatelessOptIn.length, 1, "the opt-in survives the URL");
    assert.equal(r.matches.goStreamableHttp.length, 1);
  });

  await withTempDir(async (dir) => {
    await fs.writeFile(
      path.join(dir, "main.go"),
      'package p\nfunc r() { _ = "https://x/"; _ = mcp.NewStreamableHTTPHandler(g, &mcp.StreamableHTTPOptions{}) }\n',
    );
    const r = await scanSource(dir);
    assert.equal(r.matches.goStreamableHttp.length, 1, "a URL must not hide the transport");
    assert.equal(r.matches.goStatelessOptIn.length, 0);
  });

  await withTempDir(async (dir) => {
    await fs.writeFile(path.join(dir, "main.go"), "package p\n// Stateless: true\n");
    const r = await scanSource(dir);
    assert.deepEqual(r.matches.goStatelessOptIn, [], "a real comment is still stripped");
  });
});

test("an unqualified type named like the transport is not the transport", async () => {
  await withTempDir(async (dir) => {
    await fs.writeFile(
      path.join(dir, "main.go"),
      "package old\ntype StreamableHTTPServer struct{ addr string }\n",
    );
    const r = await scanSource(dir);
    assert.deepEqual(r.matches.goStreamableHttp, []);
  });
});

test("Go receivers that merely share a method name stay quiet", async () => {
  // A Go LSP: `ws.AddRoots`, `ws.RemoveRoots`, and `server.WithLogging(logger)`
  // where `server` is just what the variable is called. mcp-go's own
  // `WithLogging()` and `WithRoots()` take no arguments, which is the guard.
  await withTempDir(async (dir) => {
    await fs.writeFile(
      path.join(dir, "main.go"),
      [
        "package p",
        "func run(ws *W, server *S, logger any) {",
        '\tws.AddRoots([]string{"/src"})',
        '\tws.RemoveRoots([]string{"/vendor"})',
        "\tserver.WithLogging(logger)",
        "}",
      ].join("\n"),
    );
    const r = await scanSource(dir);
    assert.deepEqual(r.matches.roots, []);
    assert.deepEqual(r.matches.logging, []);
  });
});

test("mcp-go's zero-argument options are still detected", async () => {
  await withTempDir(async (dir) => {
    await fs.writeFile(
      path.join(dir, "main.go"),
      'package p\nfunc r() { _ = server.NewMCPServer("n", "1", server.WithLogging(), server.WithRoots()) }\n',
    );
    const r = await scanSource(dir);
    assert.equal(r.matches.logging.length, 1);
    assert.equal(r.matches.roots.length, 1);
  });
});

test("scanSource reports every go.mod it saw, not only those with an MCP module", async () => {
  // Module ownership needs all of them: a nested module declaring no MCP SDK
  // was invisible, and its files were attributed to the parent.
  await withTempDir(async (dir) => {
    await fs.mkdir(path.join(dir, "sub"), { recursive: true });
    await fs.writeFile(path.join(dir, "go.mod"), `module a\nrequire ${GO_SDK} v1.7.0\n`);
    await fs.writeFile(path.join(dir, "sub", "go.mod"), "module a/sub\ngo 1.25.0\n");
    const r = await scanSource(dir);
    assert.deepEqual([...(r.goManifests ?? [])].sort(), ["go.mod", "sub/go.mod"]);
  });
});
