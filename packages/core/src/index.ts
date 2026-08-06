import { evaluate, gradeFrom } from "./engine";
import { probeEndpoint, type ProbeOptions } from "./probe";
import { scanSource, type ScanOptions } from "./scan";
import { isSafePublicUrl } from "./ssrf";
import type { CheckResult } from "./types";

export * from "./types";
export { evaluate, gradeFrom } from "./engine";
export { rules, rulesVerifiedAt, SPEC_VERIFIED_AT } from "./rules";
export { isSafePublicUrl } from "./ssrf";
export { probeEndpoint } from "./probe";
export { scanSource } from "./scan";

/**
 * Check a live MCP endpoint. Enforces the SSRF guard by default so this is
 * safe to call from a public web handler. Pass `enforceSsrfGuard: false` only
 * when the caller is trusted and reaching localhost is the point — the skill's
 * bundled checker does this behind its `--local` flag.
 */
export async function checkLive(
  url: string,
  opts: ProbeOptions & { enforceSsrfGuard?: boolean } = {},
): Promise<CheckResult> {
  const enforce = opts.enforceSsrfGuard ?? true;
  if (enforce) {
    const guard = isSafePublicUrl(url);
    if (!guard.ok) {
      return {
        target: url,
        mode: "live",
        findings: [],
        grade: gradeFrom([]),
        checkedAt: new Date().toISOString(),
        inconclusive: true,
        note: guard.reason,
      };
    }
  }

  const live = await probeEndpoint(url, opts);
  if (!live.reachable) {
    return {
      target: url,
      mode: "live",
      findings: [],
      grade: gradeFrom([]),
      checkedAt: new Date().toISOString(),
      inconclusive: true,
      note: live.rawError
        ? `Endpoint unreachable: ${live.rawError}`
        : "Endpoint unreachable.",
    };
  }

  const findings = evaluate({ live });
  return {
    target: url,
    mode: "live",
    findings,
    grade: gradeFrom(findings),
    checkedAt: new Date().toISOString(),
  };
}

/** Check a repository on disk via static source scan. */
export async function checkSource(
  dir: string,
  opts: ScanOptions = {},
): Promise<CheckResult> {
  const source = await scanSource(dir, opts);
  const findings = evaluate({ source });
  return {
    target: dir,
    mode: "source",
    findings,
    grade: gradeFrom(findings),
    checkedAt: new Date().toISOString(),
    note:
      source.filesScanned === 0
        ? "No scannable source files found."
        : `Scanned ${source.filesScanned} file(s).`,
  };
}
