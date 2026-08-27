#!/usr/bin/env node
/**
 * Turn a `mcpcheck --json` report into the GitHub Action's surface: step
 * outputs, a job summary, and the exit status that decides whether the check
 * is red.
 *
 * This lives in a script rather than inline in `action.yml` because a
 * composite action's `run:` blocks are shell strings — unindentable, untestable
 * from a terminal, and quoted through two layers of YAML. It also means the
 * action needs no `jq`: the runner already has the Node that ran the checker.
 *
 * Usage:
 *   action-report.mjs <report.json> --fail-on <critical|warning|never>
 */
import { appendFileSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
const reportPath = args[0];
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const failOn = flag("fail-on", "critical");

if (!reportPath) {
  console.error("action-report: report path is required");
  process.exit(2);
}
if (!["critical", "warning", "never"].includes(failOn)) {
  console.error(`action-report: fail-on must be critical, warning or never (got "${failOn}")`);
  process.exit(2);
}

const report = JSON.parse(readFileSync(reportPath, "utf8"));
const findings = report.findings ?? [];
const critical = findings.filter((f) => f.severity === "critical").length;
const warnings = findings.filter((f) => f.severity === "warning").length;

// The checker exits 2 when it could not inspect the target at all. That is not
// a passing grade and it is not a failing one either — reporting an
// unreachable endpoint as "A" would be a lie, so the grade outputs stay empty
// and the summary says why.
const grade = report.inconclusive ? "" : report.grade.letter;
const score = report.inconclusive ? "" : String(report.grade.score);

const BADGE_COLOR = { A: "37d399", B: "a3d977", C: "e3b341", D: "f0883e", F: "f85149" };
const badgeUrl = report.inconclusive
  ? "https://img.shields.io/badge/MCP%202026--07--28-inconclusive-8b949e"
  : `https://img.shields.io/badge/MCP%202026--07--28-${grade}%20(${score}%2F100)-${BADGE_COLOR[grade]}`;
const badgeMarkdown = `[![MCP 2026-07-28 readiness](${badgeUrl})](https://github.com/AlpayC/mcp-migration-check)`;

function setOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  // Multi-line values need the heredoc form; the delimiter must not appear in
  // the value, and finding text comes from a repository we do not control.
  const delimiter = `ghadelim_${Math.random().toString(36).slice(2)}`;
  appendFileSync(file, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}

setOutput("grade", grade);
setOutput("score", score);
setOutput("critical", String(critical));
setOutput("warnings", String(warnings));
setOutput("findings", String(findings.length));
setOutput("inconclusive", String(Boolean(report.inconclusive)));
setOutput("report-path", reportPath);
setOutput("badge-url", badgeUrl);
setOutput("badge-markdown", badgeMarkdown);

const md = [];
md.push("## MCP 2026-07-28 migration readiness");
md.push("");
md.push(`\`${report.target}\` · ${report.mode} check`);
md.push("");
if (report.inconclusive) {
  md.push(`**Inconclusive** — ${report.note ?? "no detail"}`);
} else {
  md.push(`**Grade ${grade}** (${score}/100) — ${critical} critical, ${warnings} warning`);
  if (report.note) md.push(`\n${report.note}`);
  if (findings.length === 0) {
    md.push("\nNo breaking-change signals found.");
  } else {
    md.push("");
    md.push("| Rule | Severity | Finding | Where |");
    md.push("| --- | --- | --- | --- |");
    for (const f of findings) {
      // Cell text is scanned source, so it can contain pipes and newlines.
      //
      // Backslashes go first. Escaping `|` as `\|` without escaping the
      // backslash itself leaves `a\|b` as `a\\|b`, which Markdown reads as a
      // literal backslash followed by a live cell separator — the escaping
      // undoes itself on exactly the input it exists for. `\s+` rather than
      // `\s*\n\s*` because `\n` is itself whitespace, so the two `\s*` overlap
      // it and a long run of blanks backtracks quadratically.
      const cell = (s) =>
        String(s ?? "")
          .replace(/\\/g, "\\\\")
          .replace(/\|/g, "\\|")
          .replace(/\s+/g, " ")
          .trim();
      md.push(
        `| [${f.ruleId}](${f.specRef}) | ${f.severity} | ${cell(f.title)} | ${cell(f.location) || "—"} |`,
      );
    }
    md.push("");
    md.push("<details><summary>Fixes</summary>\n");
    for (const f of findings) {
      md.push(`**${f.ruleId} — ${f.title}**`);
      md.push("");
      md.push(`- observed: ${f.detail}`);
      md.push(`- fix: ${f.fix}`);
      md.push("");
    }
    md.push("</details>");
  }
  md.push("");
  md.push(`\`![MCP readiness](${badgeUrl})\``);
}
md.push("");
md.push(
  "These rules are not the whole revision — this is triage, not a conformance " +
    "suite. [What it does and does not cover]" +
    "(https://github.com/AlpayC/mcp-migration-check#honest-limitations)",
);

const summaryText = md.join("\n") + "\n";
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryText);
} else {
  console.log(summaryText);
}

// An unreachable target never fails the build: the endpoint being down is not
// the same claim as the endpoint being unmigrated, and a check that reddens on
// somebody else's outage gets switched off.
if (report.inconclusive) {
  console.log(`::warning::mcpcheck could not inspect ${report.target} — ${report.note ?? "no detail"}`);
  process.exit(0);
}
if (failOn === "never") process.exit(0);
if (failOn === "warning" && findings.length > 0) process.exit(1);
if (failOn === "critical" && critical > 0) process.exit(1);
