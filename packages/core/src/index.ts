import { evaluate, gradeFrom } from "./engine";
import { probeEndpoint, type ProbeOptions } from "./probe";
import { scanSource, type ScanOptions } from "./scan";
import { isSafePublicUrl } from "./ssrf";
import type { CheckResult } from "./types";

export * from "./types";
export { evaluate, gradeFrom } from "./engine";
export { rules, rulesVerifiedAt, SPEC_VERIFIED_AT } from "./rules";
export { isSafePublicUrl } from "./ssrf";
export {
  probeEndpoint,
  CURRENT_PROTOCOL_VERSION,
  LEGACY_PROTOCOL_VERSION,
} from "./probe";
export { scanSource } from "./scan";

/** One line describing which protocol era answered, for the report header. */
export function describeEra(live: import("./types").ProbeContext): string {
  switch (live.era) {
    case "dual":
      return "Serves the current revision and still answers the legacy `initialize` handshake (dual-era).";
    case "modern":
      return "Serves the current revision. The legacy `initialize` handshake was not answered.";
    case "legacy":
      return "Answers the legacy `initialize` handshake only — no modern surface responded.";
    default:
      return live.authRequired
        ? "Authentication required, so neither protocol era could be probed."
        : "Nothing answered in a way that identified a protocol era.";
  }
}

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
    note: describeEra(live),
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
