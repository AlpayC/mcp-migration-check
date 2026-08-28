/**
 * Entry point bundled into the skill as `scripts/mcpcheck.mjs`.
 *
 * No shebang here — the bundler adds one via `banner`, and having both would
 * put a `#!` on line 2 of the output, which Node rejects.
 *
 * This exists so the skill's diagnosis step is deterministic. An agent reading
 * source code can guess at migration hazards; running the same rule engine the
 * web demo uses gives the same answer every time, with rule ids the skill's
 * remediation sections key off. Output is plain text by default and JSON with
 * `--json`, because agents parse JSON more reliably than coloured columns.
 */
import { checkLive, checkSource, rulesVerifiedAt } from "./index";
import type { CheckResult } from "./types";

const HELP = `mcpcheck — MCP 2026-07-28 migration readiness

Usage:
  mcpcheck <url>              Probe a live MCP endpoint (http/https)
  mcpcheck --source <dir>     Statically scan a repository
  mcpcheck --local <url>      Allow localhost/private targets (SSRF guard off)
  mcpcheck ... --json         Machine-readable output

Exit codes:
  0  no critical findings
  1  at least one critical finding
  2  inconclusive (unreachable / blocked / nothing to scan)
`;

function render(result: CheckResult): string {
  const out: string[] = [];
  out.push(`Target: ${result.target}  (${result.mode})`);

  if (result.inconclusive) {
    out.push(`Result: inconclusive — ${result.note ?? "no detail"}`);
    return out.join("\n");
  }

  out.push(`Grade:  ${result.grade.letter} (${result.grade.score}/100)`);
  if (result.note) out.push(result.note);

  if (result.findings.length === 0) {
    out.push("");
    out.push("No breaking-change signals found.");
    return out.join("\n");
  }

  out.push("");
  for (const f of result.findings) {
    out.push(`[${f.severity.toUpperCase()}] ${f.title}  (${f.ruleId})`);
    if (f.location) out.push(`  at:       ${f.location}`);
    out.push(`  observed: ${f.detail}`);
    out.push(`  fix:      ${f.fix}`);
    out.push(`  spec:     ${f.specRef}`);
    if (f.references && f.references.length > 0) {
      for (const ref of f.references) {
        out.push(`  see also: ${ref}`);
      }
    }
    if (f.note) out.push(`  note:     ${f.note}`);
    out.push("");
  }
  // Provenance, not decoration: these citations were read on a date, and a rule
  // that quietly ages into wrong is the failure this project already had once.
  out.push(`Rules last verified against the spec: ${rulesVerifiedAt}`);
  return out.join("\n").trimEnd();
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    return args.length === 0 ? 2 : 0;
  }

  const json = args.includes("--json");
  const sourceIdx = args.indexOf("--source");
  const localIdx = args.indexOf("--local");

  let result: CheckResult;
  if (sourceIdx !== -1) {
    const dir = args[sourceIdx + 1];
    if (!dir) {
      console.error("--source requires a directory path");
      return 2;
    }
    result = await checkSource(dir);
  } else {
    const url =
      localIdx !== -1 ? args[localIdx + 1] : args.find((a) => !a.startsWith("--"));
    if (!url) {
      console.error("Provide a URL, or use --source <dir>");
      return 2;
    }
    result = await checkLive(url, { enforceSsrfGuard: localIdx === -1 });
  }

  console.log(json ? JSON.stringify(result, null, 2) : render(result));

  if (result.inconclusive) return 2;
  return result.findings.some((f) => f.severity === "critical") ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(2);
  },
);
