import { rules } from './rules';
import type { Finding, Grade, RuleContext, Severity } from './types';

/**
 * `info` costs nothing on purpose.
 *
 * Info findings are observations — "this dual-era server still answers the old
 * handshake" — and the whole point of splitting them out from the criticals is
 * that they are not defects. Charging them five points would put a compliant,
 * maintained server at 95 and let a grade drift downward for doing the right
 * thing, which is the reading this checker was rightly criticised for.
 */
const PENALTY: Record<Severity, number> = {
  critical: 30,
  warning: 15,
  info: 0,
};

export function gradeFrom(findings: Finding[]): Grade {
  const deduction = findings.reduce((sum, f) => sum + PENALTY[f.severity], 0);
  const score = Math.max(0, 100 - deduction);
  const letter: Grade['letter'] =
    score >= 90 ? 'A'
    : score >= 75 ? 'B'
    : score >= 60 ? 'C'
    : score >= 40 ? 'D'
    : 'F';
  return { score, letter };
}

/**
 * Down-rank findings whose `location` falls inside a `#[cfg(test)]` module.
 *
 * The source scan greps, so it can flag test code — e.g. a test that sends a
 * legacy `initialize` request. Such findings are false positives for a
 * migration audit, so they drop one severity level (critical→warning,
 * warning→info, info→info) and get a `note` explaining why. Findings without a
 * `file:line` location (live probes, `package.json`, `Cargo.toml`) are skipped.
 */
export function applyTestModuleDownrank(
  findings: Finding[],
  ctx: RuleContext,
): Finding[] {
  const ranges = ctx.source?.testModuleRanges;
  if (!ranges || ranges.length === 0) return findings;
  for (const f of findings) {
    const m = /^(.+):(\d+)$/.exec(f.location ?? '');
    if (!m) continue; // no line: MCP007 "package.json", MCP008 "Cargo.toml", live "live endpoint" — skip
    const file = m[1];
    const line = Number(m[2]);
    const hit = ranges.find(
      (r) => r.file === file && line >= r.start && line <= r.end,
    );
    if (!hit) continue;
    if (f.severity === 'critical') f.severity = 'warning';
    else if (f.severity === 'warning') f.severity = 'info';
    f.note = 'Down-ranked: located in a #[cfg(test)] module';
  }
  return findings;
}

/** Run every rule over the context and return findings ordered by severity. */
export function evaluate(ctx: RuleContext): Finding[] {
  const order: Severity[] = ['critical', 'warning', 'info'];
  const findings = rules
    .map((r) => r.evaluate(ctx))
    .filter((f): f is Finding => f !== null)
    .sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
  return applyTestModuleDownrank(findings, ctx);
}
