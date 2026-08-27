import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyPythonSdkSpecifier,
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
