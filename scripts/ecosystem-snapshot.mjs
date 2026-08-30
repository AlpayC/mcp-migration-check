/**
 * Keep every surface that quotes the ecosystem numbers in step with the report.
 *
 * There are four of them — the web app, the repository README, the npm
 * package README, and the report's own Markdown — and they had already drifted
 * apart once: the landing page claimed 13,350 endpoints against the report's
 * 13,380, because the report was regenerated and the JSX was not. A figure that
 * is wrong in one place and right in three is worse than one that is wrong
 * everywhere, because nobody can tell which to believe.
 *
 * So nothing downstream keeps its own copy. The pipeline is:
 *
 *   reports/ecosystem-<day>.json    the full run — ~16 MB, names every server
 *     ↓  extractSummary()               probed, and gitignored for that reason
 *   reports/summary.json            ~1 KB of aggregates, committed
 *     ↓  renderSurfaces()
 *   web/lib/ecosystem-snapshot.ts   what the site reads
 *   README.md                       between the ecosystem-snapshot markers
 *   packages/cli/README.md          likewise
 *
 * The split at `summary.json` is what lets CI check the second half. It cannot
 * run the first — the 16 MB input is not in the repository — but it can
 * re-render every surface from the committed summary and fail if one moved.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { repoRoot } from "./bundle-engine.mjs";

const reportsDir = resolve(repoRoot, "reports");
const summaryPath = resolve(reportsDir, "summary.json");

const SITE_URL = "https://mcp-migration-check.alpaycelik.workers.dev";
const REPO_URL = "https://github.com/AlpayC/mcp-migration-check";

/** The newest `ecosystem-YYYY-MM-DD.json`. The names sort chronologically. */
async function latestReport() {
  const files = (await readdir(reportsDir))
    .filter((f) => /^ecosystem-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  const newest = files.at(-1);
  if (!newest) {
    throw new Error(
      `No ecosystem-*.json in ${reportsDir}. The full reports are gitignored, ` +
        `so run 'npm run report:ecosystem' first — a fresh clone has only ` +
        `summary.json and the rendered Markdown.`,
    );
  }
  return newest;
}

/**
 * Reduce the newest full report to the committed aggregates.
 *
 * Every field is named explicitly rather than taken as a rest element: a field
 * added to the report later should have to be listed here before it reaches
 * anything downstream, not arrive unnoticed. `results` is what makes the input
 * 16 MB and is deliberately absent.
 */
export async function extractSummary() {
  const filename = await latestReport();
  const day = filename.slice("ecosystem-".length, -".json".length);
  const r = JSON.parse(await readFile(resolve(reportsDir, filename), "utf8"));

  const summary = {
    day,
    startedAt: r.startedAt,
    specReleasedAt: r.specReleasedAt,
    rulesVerifiedAt: r.rulesVerifiedAt,
    registryEntries: r.registryEntries,
    localOnly: r.localOnly,
    probed: r.probed,
    outcomes: r.outcomes,
    graded: r.graded,
    eras: r.eras,
    touchedSinceSpec: r.touchedSinceSpec,
    legacyAmongTouched: r.legacyAmongTouched,
    touchedBySource: r.touchedBySource,
    withCritical: r.withCritical,
    grades: r.grades,
    ruleCounts: r.ruleCounts,
  };

  await writeFile(summaryPath, JSON.stringify(summary, null, 2) + "\n");
  return { summary, source: filename, outfile: summaryPath };
}

/** `n` as a share of `of`, to one decimal. The site's `share()` matches this. */
function pct(n, of) {
  return `${((n / of) * 100).toFixed(1)}%`;
}

function count(n) {
  return n.toLocaleString("en-US");
}

/**
 * Wrap to the width the rest of the Markdown in this repository is wrapped to.
 *
 * The figures change length between runs — `9.9%` one month, `10.0%` the next —
 * so a template with newlines baked in produces a differently ragged paragraph
 * every time. Wrapping after substitution keeps the diff to the words that
 * actually moved. Long tokens (a link, a bolded clause) are never broken.
 */
function wrap(text, width = 78) {
  // A link is one token, bold markers and trailing punctuation included. Split
  // on plain whitespace and `[State of MCP migration — 2026-08-23](…)` lands
  // half on each line: legal CommonMark, but it reads as a broken sentence and
  // makes the next run's diff look like the prose changed when only a figure
  // did. A link longer than `width` overflows its line rather than splitting.
  const link = /\*{0,2}\[[^\]]*\]\([^)]*\)\*{0,2}[.,;:—]?/g;
  const words = [];
  let cut = 0;
  for (const match of text.matchAll(link)) {
    words.push(...text.slice(cut, match.index).split(/\s+/).filter(Boolean));
    words.push(match[0]);
    cut = match.index + match[0].length;
  }
  words.push(...text.slice(cut).split(/\s+/).filter(Boolean));

  const lines = [];
  let line = "";
  for (const word of words) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

/**
 * Replace the text between the `ecosystem-snapshot` markers.
 *
 * The body sits tight against both markers — no blank lines of its own. One of
 * the two blocks is a bullet inside a list, and a blank line there ends the
 * list and re-spaces every item around it.
 *
 * Throws rather than appending when the markers are missing: a generator that
 * silently writes nothing is how a surface goes stale without anyone noticing,
 * which is the exact failure this file exists to prevent.
 */
function replaceBlock(contents, body, file) {
  const start =
    "<!-- ecosystem-snapshot:start — generated by scripts/ecosystem-snapshot.mjs, edit that not this -->";
  const end = "<!-- ecosystem-snapshot:end -->";
  const pattern =
    /<!-- ecosystem-snapshot:start[\s\S]*?<!-- ecosystem-snapshot:end -->/;
  if (!pattern.test(contents)) {
    throw new Error(
      `${file} has no ecosystem-snapshot markers. Add:\n${start}\n${end}`,
    );
  }
  return contents.replace(pattern, `${start}\n${body}\n${end}`);
}

/** The repository README's headline paragraph. */
function repoHeadline(s) {
  return wrap(
    `**[State of MCP migration — ${s.day}](${SITE_URL}/state-of-mcp)** — ` +
      `${count(s.probed)} unique remote endpoints from the official registry ` +
      `probed; ${count(s.graded)} returned enough protocol or authentication ` +
      `signal to grade. **${pct(s.eras.legacy, s.graded)} serve the legacy ` +
      `protocol only.** A further ${pct(s.eras.dual, s.graded)} are dual-era — ` +
      `current *and* still answering the old handshake, which the revision ` +
      `permits and this report does not count against them. Narrowed to the ` +
      `${count(s.touchedSinceSpec)} servers touched since the revision ` +
      `shipped, ${pct(s.legacyAmongTouched, s.touchedSinceSpec)} are ` +
      `legacy-only. An earlier version of this snapshot could not tell ` +
      `dual-era and legacy-only apart; see ` +
      `[the postmortem](#mcp001-told-servers-to-break-their-own-users).`,
  );
}

/** The npm README's entry under Links. */
function cliLink(s) {
  return `- [State of MCP migration](${SITE_URL}/state-of-mcp) — **${pct(
    s.eras.legacy,
    s.graded,
  )} of graded MCP servers still answer only the legacy protocol.** ${count(
    s.graded,
  )} registry endpoints graded, ${s.day}`;
}

/** What the web app imports. */
function snapshotModule(s) {
  return `// GENERATED FILE — do not edit.
// Written by scripts/ecosystem-snapshot.mjs from reports/summary.json.
// Regenerate with \`npm run report:ecosystem\`, or re-render every surface from
// the committed summary with \`npm run build:ecosystem-snapshot\`.

/** Aggregate totals from the most recent ecosystem probe. */
export const SNAPSHOT = ${JSON.stringify(s, null, 2)} as const;

/** \`n\` as a share of \`of\`, to one decimal. One rounding rule, in one place. */
export function share(n: number, of: number): string {
  return \`\${((n / of) * 100).toFixed(1)}%\`;
}

/** Thousands separators, so no two figures on the page disagree about them. */
export function count(n: number): string {
  return n.toLocaleString("en-US");
}
`;
}

/**
 * Re-render every surface from `reports/summary.json`.
 *
 * Reads only committed files, so CI can run this and diff the result.
 */
export async function renderSurfaces() {
  let raw;
  try {
    raw = await readFile(summaryPath, "utf8");
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    // The likely reader of this is a CI log on a pull request that regenerated
    // a report and left the summary behind. A bare ENOENT sends them looking
    // for a bug in the script instead of at their own commit.
    throw new Error(
      `reports/summary.json is missing. It is committed — every surface that ` +
        `quotes an ecosystem figure is generated from it. If you just ran ` +
        `'npm run report:ecosystem', commit the summary it wrote; otherwise ` +
        `restore it from main.`,
    );
  }
  const summary = JSON.parse(raw);

  const written = [];

  const modulePath = resolve(repoRoot, "web/lib/ecosystem-snapshot.ts");
  await writeFile(modulePath, snapshotModule(summary));
  written.push(modulePath);

  for (const [relative, render] of [
    ["README.md", repoHeadline],
    ["packages/cli/README.md", cliLink],
  ]) {
    const path = resolve(repoRoot, relative);
    const before = await readFile(path, "utf8");
    await writeFile(path, replaceBlock(before, render(summary), relative));
    written.push(path);
  }

  return { summary, written };
}
