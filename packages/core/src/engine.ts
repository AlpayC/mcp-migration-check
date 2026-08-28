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

/** Run every rule over the context and return findings ordered by severity. */
export function evaluate(ctx: RuleContext): Finding[] {
  const order: Severity[] = ['critical', 'warning', 'info'];
  return rules
    .map((r) => r.evaluate(ctx))
    .filter((f): f is Finding => f !== null)
    .sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
}
