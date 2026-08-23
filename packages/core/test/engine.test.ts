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

/**
 * Penalties are 30 / 15 / 0; letters are A>=90, B>=75, C>=60, D>=40, else F.
 *
 * `info` is deliberately free. Info findings are observations — a dual-era
 * server still answering the legacy handshake is the motivating case — and a
 * grade that slips because a server kept faith with old clients is the exact
 * misreading this checker had to correct.
 */
const CASES: Array<{ findings: Severity[]; score: number; letter: string }> = [
  { findings: [], score: 100, letter: "A" },
  { findings: ["info", "info", "info"], score: 100, letter: "A" },
  { findings: ["warning"], score: 85, letter: "B" },
  { findings: ["warning", "warning"], score: 70, letter: "C" },
  { findings: ["critical"], score: 70, letter: "C" },
  { findings: ["critical", "info", "info"], score: 70, letter: "C" },
  { findings: ["critical", "warning"], score: 55, letter: "D" },
  { findings: ["critical", "critical"], score: 40, letter: "D" }, // lower edge of D
  { findings: ["critical", "critical", "warning"], score: 25, letter: "F" },
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
      era: "dual",
      supportedVersions: ["2026-07-28"],
      discoverImplemented: true,
      modernRequestsServed: true,
      respondsToLegacyInitialize: true,
      legacyProtocolVersion: "2025-11-25",
      sessionIdOnModernRequest: true,
      sessionIdOnLegacyHandshake: false,
      advertisedCapabilities: ["logging"],
      capabilitiesEra: "modern",
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
