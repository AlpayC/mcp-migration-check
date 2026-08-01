import assert from "node:assert/strict";
import { test } from "node:test";

import { evaluate, gradeFrom } from "../src/engine";
import type { Finding, Severity } from "../src/types";

function finding(severity: Severity, ruleId = "MCPTEST"): Finding {
  return {
    ruleId,
    title: "test",
    severity,
    detail: "test",
    fix: "test",
    specRef: "https://example.com",
  };
}

/** Penalties are 30 / 15 / 5; letters are A>=90, B>=75, C>=60, D>=40, else F. */
const CASES: Array<{ findings: Severity[]; score: number; letter: string }> = [
  { findings: [], score: 100, letter: "A" },
  { findings: ["info", "info"], score: 90, letter: "A" }, // lower edge of A
  { findings: ["warning"], score: 85, letter: "B" },
  { findings: ["info", "info", "info", "info", "info"], score: 75, letter: "B" }, // lower edge of B
  { findings: ["critical"], score: 70, letter: "C" },
  { findings: ["critical", "info", "info"], score: 60, letter: "C" }, // lower edge of C
  { findings: ["critical", "warning"], score: 55, letter: "D" },
  { findings: ["critical", "critical"], score: 40, letter: "D" }, // lower edge of D
  { findings: ["critical", "critical", "info"], score: 35, letter: "F" },
  { findings: ["critical", "critical", "critical"], score: 10, letter: "F" },
];

for (const { findings, score, letter } of CASES) {
  test(`grades [${findings.join(", ") || "none"}] as ${letter} (${score})`, () => {
    const grade = gradeFrom(findings.map((s) => finding(s)));
    assert.equal(grade.score, score);
    assert.equal(grade.letter, letter);
  });
}

test("score never goes below zero", () => {
  const many = Array.from({ length: 20 }, () => finding("critical"));
  const grade = gradeFrom(many);
  assert.equal(grade.score, 0);
  assert.equal(grade.letter, "F");
});

test("findings come back sorted with criticals first", () => {
  // A context that fires one warning (deprecated logging) and one critical
  // (session id), registered in the rules array in the opposite order.
  const findings = evaluate({
    live: {
      reachable: true,
      sessionIdHeaderPresent: true,
      respondsToInitialize: false,
      advertisedCapabilities: ["logging"],
      authRequired: false,
      oauthResourceMetadata: false,
    },
  });

  assert.ok(findings.length >= 2, "expected both rules to fire");
  const severities = findings.map((f) => f.severity);
  const firstWarning = severities.indexOf("warning");
  const lastCritical = severities.lastIndexOf("critical");
  assert.ok(
    lastCritical < firstWarning,
    `criticals must precede warnings, got ${severities.join(", ")}`,
  );
});
