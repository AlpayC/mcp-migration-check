#!/usr/bin/env node
/**
 * Measure how much of the public MCP ecosystem survived the 2026-07-28 break.
 *
 * Pulls the remote endpoints out of the official registry, probes each one with
 * the same engine the web demo runs, and writes an aggregate report: grade
 * distribution, how often each rule fires, and how much of the registry could
 * not be reached at all.
 *
 * Two deliberate limits, because this produces a number that people will quote:
 *
 * - The Markdown report is **aggregate only**. It counts servers, it does not
 *   name them. A public league table of broken servers is a different project
 *   with a different ethics, and it would poison the well with exactly the
 *   maintainers this tool is meant to help. `--name-servers` opts in for a
 *   private list; the JSON always carries per-target detail because it is a
 *   local file, not a publication.
 * - The registry is not the ecosystem. It lists servers that chose to register,
 *   and only those with a `remotes` entry are addressable over HTTP at all —
 *   everything stdio-only is invisible here. The report states both counts
 *   rather than implying the sample is the population.
 *
 * The denominator is the part that is easy to get wrong. `probeEndpoint` sets
 * `reachable` on *any* HTTP response, which is the right call for a checker
 * aimed at one endpoint you own — but across a few thousand strangers, a 403
 * from a WAF, a 404 from a moved path and a proxy interception all answer with
 * something that is not MCP at all. Scored naively they come back clean, and a
 * headline built on them would read "most of the ecosystem has migrated" when
 * the truth is "most of it never answered". Those land in their own bucket
 * below and stay out of the grade distribution.
 *
 * Usage:
 *   node --import tsx scripts/ecosystem-report.mjs [options]
 *
 *   --limit <n>        Stop after n remote endpoints (default: all)
 *   --concurrency <n>  Simultaneous probes (default 6)
 *   --timeout <ms>     Per-probe timeout (default 8000)
 *   --out <dir>        Output directory (default reports/)
 *   --name-servers     Include a per-server table in the Markdown
 *   --fresh            Ignore today's checkpoint and probe everything again
 */
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  evaluate,
  gradeFrom,
  isSafePublicUrl,
  probeEndpoint,
  rules,
  rulesVerifiedAt,
} from "../packages/core/src/index.ts";

const REGISTRY = "https://registry.modelcontextprotocol.io/v0/servers";
const UA = "mcp-migration-check/ecosystem-report (+https://github.com/AlpayC/mcp-migration-check)";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const has = (name) => argv.includes(`--${name}`);

const LIMIT = Number(flag("limit", "0")) || Infinity;
const CONCURRENCY = Number(flag("concurrency", "6"));
const TIMEOUT_MS = Number(flag("timeout", "8000"));
const OUT_DIR = resolve(process.cwd(), flag("out", "reports"));
const NAME_SERVERS = has("name-servers");
const FRESH = has("fresh");

/**
 * Page through the registry and keep the servers that expose an HTTP endpoint.
 *
 * `version=latest` collapses the entries to one row per server; without it the
 * same server appears once per published version and the denominator is
 * whatever release cadence its author happens to keep.
 */
async function collectTargets() {
  const targets = [];
  let cursor = null;
  let entries = 0;
  let localOnly = 0;

  while (targets.length < LIMIT) {
    const url = new URL(REGISTRY);
    url.searchParams.set("version", "latest");
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);

    const page = await fetchJson(url);
    for (const entry of page.servers ?? []) {
      // Stop counting the moment we stop collecting, so `entries` always means
      // "entries this run actually looked at". Under --limit the two diverge
      // otherwise, and the sample table stops adding up.
      if (targets.length >= LIMIT) break;

      entries++;
      const server = entry.server ?? {};
      const remote = (server.remotes ?? []).find((r) =>
        /^https?:\/\//i.test(r?.url ?? ""),
      );
      if (!remote) {
        localOnly++;
        continue;
      }
      targets.push({ name: server.name, title: server.title, url: remote.url });
    }

    const nextCursor = page.metadata?.nextCursor ?? null;
    // A cursor that does not advance would walk this loop forever, hammering
    // somebody else's registry. Trust the pagination to end, verify that it does.
    if (!nextCursor || nextCursor === cursor) break;
    cursor = nextCursor;
    process.stderr.write(`\r  registry: ${entries} entries, ${targets.length} remote…`);
  }
  process.stderr.write(`\r  registry: ${entries} entries, ${targets.length} remote\n`);

  // Two registry entries can point at one endpoint. Probing it twice would
  // count one server's grade twice in the distribution.
  const seen = new Set();
  const deduped = targets.filter((t) => !seen.has(t.url) && seen.add(t.url));
  deduped.sort((a, b) => a.name.localeCompare(b.name));
  return { targets: deduped, entries, localOnly };
}

async function fetchJson(url, attempt = 1) {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    // The registry is somebody else's service and this walks all of it. A
    // transient 5xx partway through should not throw away the pages already
    // fetched, but a persistent one must not be silently treated as "the end".
    if (attempt >= 4) throw new Error(`registry unreachable after ${attempt} tries: ${err.message}`);
    await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
    return fetchJson(url, attempt + 1);
  }
}

/**
 * Classify one probe.
 *
 * `graded` is the only outcome that enters the statistics. The rest are the
 * ways an endpoint can decline to be evidence: refused before we dialled,
 * never answered, or answered with something that shows no sign of being an
 * MCP server — no initialize result, no auth challenge, no session header, no
 * capabilities. The last one is the dangerous case, because it scores a clean
 * A if you let it.
 */
function classify(probe) {
  if (!probe.reachable) {
    return { outcome: "unreachable", note: probe.rawError ?? "no response" };
  }
  const spokeMcp =
    probe.respondsToInitialize ||
    probe.authRequired ||
    probe.sessionIdHeaderPresent ||
    probe.advertisedCapabilities.length > 0;
  if (!spokeMcp) {
    return { outcome: "silent", note: "answered, but showed no MCP behaviour" };
  }

  const findings = evaluate({ live: probe });
  return { outcome: "graded", findings, grade: gradeFrom(findings) };
}

/**
 * A probe worst case is one initialize request plus up to three metadata
 * candidates, each with its own timeout — so anything past that many is not
 * slow, it is stuck.
 *
 * This exists because a run of 13,346 endpoints once reached 13,345 and stopped
 * there: one probe never settled, `Promise.all` waited for it forever, and
 * seventy minutes of results died in memory. Whatever the cause of the day, a
 * report that walks the whole public registry cannot make every result depend
 * on every endpoint behaving. The abandoned request keeps running — there is no
 * way to reach in and cancel it — but it no longer holds the run hostage.
 */
const HARD_DEADLINE_MS = TIMEOUT_MS * 6;

function withDeadline(promise, ms, onTimeout) {
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve(onTimeout()), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/** Probe every target, at most CONCURRENCY at a time. */
async function probeAll(targets, checkpoint) {
  const results = new Array(targets.length);
  let next = 0;
  let done = 0;

  async function one(target) {
    // The registry is third-party input, so the guard applies here exactly as
    // it does on the public web handler. A registered server pointing at
    // 169.254.169.254 is not a hypothetical.
    const guard = isSafePublicUrl(target.url);
    if (!guard.ok) return { outcome: "blocked", note: guard.reason };

    try {
      return await withDeadline(
        probeEndpoint(target.url, { timeoutMs: TIMEOUT_MS }).then(classify),
        HARD_DEADLINE_MS,
        () => ({
          outcome: "unreachable",
          note: `probe did not settle within ${HARD_DEADLINE_MS} ms`,
        }),
      );
    } catch (err) {
      // probeEndpoint swallows network failures into `reachable: false`;
      // anything thrown past it is a bug or a runtime limit, and losing the
      // whole run to one bad target would be the wrong trade.
      return {
        outcome: "unreachable",
        note: `probe threw: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= targets.length) return;
      const target = targets[i];

      const seen = checkpoint.done.get(target.url);
      results[i] = seen ?? { ...target, ...(await one(target)) };
      if (!seen) await checkpoint.record(results[i]);

      done++;
      process.stderr.write(`\r  probing: ${done}/${targets.length}…`);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));
  process.stderr.write(`\r  probing: ${done}/${targets.length}\n`);
  return results;
}

const OUTCOME_LABEL = {
  graded: "graded",
  silent: "answered, but showed no MCP behaviour",
  unreachable: "unreachable",
  blocked: "blocked by the SSRF guard",
};

function summarize(probed) {
  const graded = probed.filter((p) => p.outcome === "graded");

  const grades = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  for (const p of graded) grades[p.grade.letter]++;

  const ruleCounts = Object.fromEntries(rules.map((r) => [r.id, 0]));
  for (const p of graded) {
    for (const f of p.findings) ruleCounts[f.ruleId] = (ruleCounts[f.ruleId] ?? 0) + 1;
  }

  const outcomes = Object.fromEntries(Object.keys(OUTCOME_LABEL).map((k) => [k, 0]));
  for (const p of probed) outcomes[p.outcome]++;

  const withCritical = graded.filter((p) =>
    p.findings.some((f) => f.severity === "critical"),
  ).length;

  return { graded, grades, ruleCounts, outcomes, withCritical };
}

const pct = (n, total) => (total === 0 ? "—" : `${((n / total) * 100).toFixed(1)}%`);

function renderMarkdown({ probed, summary, entries, localOnly, startedAt }) {
  const { graded, grades, ruleCounts, outcomes, withCritical } = summary;
  const day = startedAt.slice(0, 10);
  const out = [];

  out.push(`# State of MCP migration — ${day}`);
  out.push("");
  out.push(
    "The MCP revision dated **2026-07-28** removed protocol-level sessions, " +
      "formalized OAuth 2.1 and deprecated several capabilities. This is a " +
      "snapshot of how many public servers have followed it.",
  );
  out.push("");
  out.push(
    graded.length === 0
      ? "**No endpoint in this sample answered as an MCP server**, so there is " +
          "nothing to grade. That is a fact about the run, not about the " +
          "ecosystem — check the outcome table below before reading anything " +
          "into it."
      : `**${pct(withCritical, graded.length)} of the ${graded.length} MCP endpoints ` +
          "that answered still show at least one critical breaking-change signal.**",
  );
  out.push("");
  out.push("## Sample");
  out.push("");
  out.push("| | Count |");
  out.push("| --- | --- |");
  out.push(`| Registry entries scanned (latest version each) | ${entries} |`);
  out.push(`| …addressable over HTTP (unique endpoints) | ${probed.length} |`);
  out.push(`| …stdio/local only, not probeable | ${localOnly} |`);
  out.push("");
  out.push("Of the endpoints probed:");
  out.push("");
  out.push("| Outcome | Endpoints | Share |");
  out.push("| --- | --- | --- |");
  for (const [key, label] of Object.entries(OUTCOME_LABEL)) {
    out.push(`| ${label} | ${outcomes[key]} | ${pct(outcomes[key], probed.length)} |`);
  }
  out.push("");
  out.push(
    "Only the graded row is scored below. An endpoint that answers a probe " +
      "with a 403, a 404 or a login page is not a migrated server — it is an " +
      "endpoint that told us nothing, and counting it as clean is how a " +
      "snapshot like this ends up claiming the opposite of the truth.",
  );
  out.push("");
  out.push("## Grades");
  out.push("");
  out.push("| Grade | Servers | Share |");
  out.push("| --- | --- | --- |");
  for (const letter of ["A", "B", "C", "D", "F"]) {
    out.push(`| ${letter} | ${grades[letter]} | ${pct(grades[letter], graded.length)} |`);
  }
  out.push("");
  out.push("## What is firing");
  out.push("");
  out.push("| Rule | Severity | Signal | Servers | Share |");
  out.push("| --- | --- | --- | --- | --- |");
  for (const rule of rules) {
    const n = ruleCounts[rule.id] ?? 0;
    out.push(
      `| [${rule.id}](${rule.specRef}) | ${rule.severity} | ${rule.title} | ${n} | ${pct(n, graded.length)} |`,
    );
  }
  out.push("");

  if (NAME_SERVERS) {
    out.push("## Per server");
    out.push("");
    out.push("| Server | Grade | Findings |");
    out.push("| --- | --- | --- |");
    for (const p of probed) {
      const grade = p.outcome === "graded" ? p.grade.letter : `— (${OUTCOME_LABEL[p.outcome]})`;
      const ids = (p.findings ?? []).map((f) => f.ruleId).join(", ") || "—";
      out.push(`| ${p.name} | ${grade} | ${ids} |`);
    }
    out.push("");
  }

  out.push("## Method, and what this does not say");
  out.push("");
  out.push(
    "Each endpoint got one live probe from " +
      "[mcp-migration-check](https://github.com/AlpayC/mcp-migration-check): a " +
      "single legacy `initialize` request plus a best-effort look for OAuth " +
      `protected-resource metadata. Nothing destructive, no authentication ` +
      `attempted, ${TIMEOUT_MS} ms timeout, ${CONCURRENCY} at a time.`,
  );
  out.push("");
  out.push(
    "- **The registry is not the ecosystem.** It lists servers that registered, " +
      "and only the ones publishing a remote endpoint appear above at all.",
  );
  out.push(
    "- **A live probe sees six of the seven rules.** MCP007 reads a " +
      "`package.json`, which a probe does not have.",
  );
  out.push(
    "- **Seven rules are not the whole revision.** A server can pass every rule " +
      "here and still be broken — `server/discover`, `resultType`, " +
      "`subscriptions/listen` and the new required headers are not covered.",
  );
  out.push(
    "- **MCP001 fires against essentially every server that answers at all**, " +
      "because answering `initialize` is what it detects. Read the grade " +
      "distribution with that in mind: it is the reason F is crowded.",
  );
  out.push(
    "- **A server behind auth reports less.** An endpoint that 401s on an " +
      "unauthenticated probe exposes no capabilities to inspect, so it is " +
      "graded on very little.",
  );
  out.push("");
  out.push(`Rules last verified against the spec: ${rulesVerifiedAt}. Probed ${startedAt}.`);
  out.push("");
  return out.join("\n");
}

/**
 * Append every settled probe to a JSONL file and read it back on the next run.
 *
 * Probing the whole registry takes over an hour. Anything that ends the process
 * before the last endpoint — a hang, a Ctrl-C, a laptop lid — used to throw away
 * every result, because they only existed in an array. One line per endpoint,
 * written as it settles, turns a lost run into a resumed one.
 */
async function openCheckpoint(day) {
  await mkdir(OUT_DIR, { recursive: true });
  const path = resolve(OUT_DIR, `.ecosystem-${day}.progress.jsonl`);
  const done = new Map();

  if (!FRESH) {
    try {
      for (const line of (await readFile(path, "utf8")).split("\n")) {
        if (!line.trim()) continue;
        try {
          const row = JSON.parse(line);
          if (row?.url) done.set(row.url, row);
        } catch {
          // A half-written last line is what an interrupted run leaves behind.
          // Skipping it costs one endpoint; refusing to start costs the rest.
        }
      }
    } catch {
      /* no checkpoint yet */
    }
  }

  const handle = await open(path, FRESH ? "w" : "a");
  return {
    path,
    done,
    record: (row) => handle.write(JSON.stringify(row) + "\n"),
    close: () => handle.close(),
    discard: async () => {
      await handle.close();
      await rm(path, { force: true });
    },
  };
}

const startedAt = new Date().toISOString();
const day = startedAt.slice(0, 10);
const checkpoint = await openCheckpoint(day);
if (checkpoint.done.size > 0) {
  console.error(`Resuming: ${checkpoint.done.size} endpoint(s) already probed today.`);
  console.error(`  (--fresh to start over; the file is ${checkpoint.path})`);
}

console.error("Collecting targets from the MCP registry…");
const { targets, entries, localOnly } = await collectTargets();
if (targets.length === 0) {
  console.error("No remote endpoints found — nothing to probe.");
  process.exit(2);
}

console.error(`Probing ${targets.length} endpoints…`);
const probed = await probeAll(targets, checkpoint);
const summary = summarize(probed);

await mkdir(OUT_DIR, { recursive: true });
const jsonPath = resolve(OUT_DIR, `ecosystem-${day}.json`);
const mdPath = resolve(OUT_DIR, `ecosystem-${day}.md`);

await writeFile(
  jsonPath,
  JSON.stringify(
    {
      startedAt,
      registryEntries: entries,
      localOnly,
      probed: probed.length,
      outcomes: summary.outcomes,
      graded: summary.graded.length,
      withCritical: summary.withCritical,
      grades: summary.grades,
      ruleCounts: summary.ruleCounts,
      rulesVerifiedAt,
      results: probed,
    },
    null,
    2,
  ) + "\n",
);
await writeFile(mdPath, renderMarkdown({ probed, summary, entries, localOnly, startedAt }));

console.error("");
for (const [key, label] of Object.entries(OUTCOME_LABEL)) {
  console.error(`  ${String(summary.outcomes[key]).padStart(5)}  ${label}`);
}
console.error(
  `\n  ${summary.withCritical} of ${summary.graded.length} graded ` +
    `(${pct(summary.withCritical, summary.graded.length)}) have a critical finding`,
);
console.error("");
console.error(`Wrote ${jsonPath}`);
console.error(`Wrote ${mdPath}`);

// The report is written, so the checkpoint has done its job.
await checkpoint.discard();

// A probe that blew its deadline is still out there holding a socket, and an
// open socket keeps the event loop alive — the process would sit here having
// already written everything it was asked to write.
process.exit(0);
