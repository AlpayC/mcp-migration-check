#!/usr/bin/env node
import pc from "picocolors";
import { checkLive, checkSource } from "./index.js";
import type { CheckResult, Finding } from "./types.js";

const HELP = `mcpcheck — MCP 2026-07-28 migration readiness

Usage:
  mcpcheck <url>              Check a live MCP endpoint (http/https)
  mcpcheck --source <dir>     Statically scan a repository
  mcpcheck <url> --json       Machine-readable output (also works with --source)
  mcpcheck --local <url>      Allow localhost/private targets (disables SSRF guard)

Exit codes:
  0  no critical findings
  1  at least one critical finding
  2  inconclusive (unreachable / blocked / nothing to scan)
`;

function severityColor(f: Finding): string {
  if (f.severity === "critical") return pc.red(f.severity.toUpperCase());
  if (f.severity === "warning") return pc.yellow(f.severity.toUpperCase());
  return pc.blue(f.severity.toUpperCase());
}

function gradeColor(letter: string): string {
  if (letter === "A" || letter === "B") return pc.green(letter);
  if (letter === "C") return pc.yellow(letter);
  return pc.red(letter);
}

function render(result: CheckResult): void {
  console.log("");
  console.log(pc.bold(`  MCP migration check · ${result.mode} · ${result.target}`));
  console.log("");

  if (result.inconclusive) {
    console.log(`  ${pc.dim("Result:")} ${pc.yellow("inconclusive")}`);
    if (result.note) console.log(`  ${pc.dim(result.note)}`);
    console.log("");
    return;
  }

  console.log(
    `  ${pc.dim("Grade:")} ${gradeColor(result.grade.letter)}  ${pc.dim(
      `(${result.grade.score}/100)`,
    )}`,
  );
  if (result.note) console.log(`  ${pc.dim(result.note)}`);
  console.log("");

  if (result.findings.length === 0) {
    console.log(`  ${pc.green("No breaking-change signals found.")}`);
    console.log("");
    return;
  }

  for (const f of result.findings) {
    console.log(`  ${severityColor(f)}  ${pc.bold(f.title)}  ${pc.dim(f.ruleId)}`);
    if (f.location) console.log(`     ${pc.dim(f.location)}`);
    console.log(`     ${f.detail}`);
    console.log(`     ${pc.cyan("Fix:")} ${f.fix}`);
    console.log(`     ${pc.dim(f.specRef)}`);
    console.log("");
  }
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

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    render(result);
  }

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
