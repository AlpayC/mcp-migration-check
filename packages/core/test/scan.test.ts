import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyPythonSdkSpecifier,
  parseCargoToml,
  parsePythonSdkRequirements,
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
