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
 *   --no-dates         Skip repository dating (see below)
 *   --top-up           Re-date and re-render a finished report, probing nothing
 *   --from <path>      Which report JSON --top-up reads (default: today's)
 *
 * DATING, AND WHY THE DENOMINATOR NEEDS IT
 *
 * A dead endpoint that still returns 200 is indistinguishable from a
 * maintained one that chose not to migrate — unless you can date it. The
 * registry skews heavily toward servers listed once and never touched again,
 * so a single aggregate percentage silently blames the whole ecosystem for
 * what is largely a graveyard.
 *
 * Two dates are available and they are not equally strong:
 *
 * - `repository.url` → GitHub's `pushed_at`, plus `archived`. This is the real
 *   maintenance signal. It needs the GitHub API, so it needs `GITHUB_TOKEN` to
 *   cover more than 60 repositories per hour; without one the run dates what
 *   it can and reports the coverage honestly rather than quietly guessing.
 * - The registry's own `updatedAt`, which every entry has for free. Weaker: it
 *   says when someone last published a version, not when the code moved. Used
 *   only where no repository date could be had, and labelled as such.
 */
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";

import { extractSummary, renderSurfaces } from "./ecosystem-snapshot.mjs";
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
const SKIP_DATES = has("no-dates");
const TOP_UP = has("top-up");

/**
 * The day the revision shipped. A repository whose last commit predates it
 * cannot have migrated — no judgement implied, it is simply not evidence of a
 * maintainer declining to move.
 */
const SPEC_RELEASED_AT = "2026-07-28";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null;

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
      const official = entry._meta?.["io.modelcontextprotocol.registry/official"] ?? {};
      targets.push({
        name: server.name,
        title: server.title,
        url: remote.url,
        repository: typeof server.repository?.url === "string" ? server.repository.url : null,
        repositorySource: server.repository?.source ?? null,
        // When the registry entry was last published. Every entry has one, and
        // for a server listed once and forgotten it is the original date.
        registryUpdatedAt: official.updatedAt ?? official.publishedAt ?? null,
      });
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

// ---------------------------------------------------------------------------
// Repository dating
// ---------------------------------------------------------------------------

/** `https://github.com/owner/repo(.git)` → `owner/repo`, or null. */
function githubRepoKey(url) {
  if (typeof url !== "string") return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!/(^|\.)github\.com$/i.test(parsed.hostname)) return null;
  const parts = parsed.pathname.replace(/\.git$/i, "").split("/").filter(Boolean);
  if (parts.length < 2) return null;
  return `${parts[0]}/${parts[1]}`.toLowerCase();
}

/**
 * Ask GitHub when each repository was last pushed to.
 *
 * Deduplicated by repository, because one repo commonly publishes several
 * registry entries. Stops the moment the rate limit is exhausted rather than
 * spending an hour on 403s. Everything not reached falls back to the registry
 * timestamp, and the report prints the source split. A dating pass that
 * silently covers a third of the sample and says nothing is worse than no
 * dating at all.
 */
async function collectRepoDates(targets, cache) {
  const keys = new Set();
  for (const t of targets) {
    const key = githubRepoKey(t.repository);
    if (key && !cache.has(key)) keys.add(key);
  }

  const stats = { asked: 0, cached: cache.size, rateLimited: false, failed: 0 };
  if (SKIP_DATES || keys.size === 0) return stats;

  if (!GITHUB_TOKEN) {
    console.error(
      `  no GITHUB_TOKEN — GitHub allows 60 requests/hour unauthenticated, and ` +
        `${keys.size} repositories need dating. Most rows will use the ` +
        `registry timestamp instead.`,
    );
  }

  const pending = [...keys];
  let next = 0;
  const workers = Math.min(GITHUB_TOKEN ? 8 : 2, pending.length);

  async function worker() {
    for (;;) {
      if (stats.rateLimited) return;
      const i = next++;
      if (i >= pending.length) return;
      const key = pending[i];

      try {
        const res = await fetch(`https://api.github.com/repos/${key}`, {
          headers: {
            "user-agent": UA,
            accept: "application/vnd.github+json",
            ...(GITHUB_TOKEN ? { authorization: `Bearer ${GITHUB_TOKEN}` } : {}),
          },
          signal: AbortSignal.timeout(20_000),
        });
        stats.asked++;

        if (res.status === 403 || res.status === 429) {
          if (res.headers.get("x-ratelimit-remaining") === "0") {
            stats.rateLimited = true;
            const reset = Number(res.headers.get("x-ratelimit-reset") ?? 0) * 1000;
            console.error(
              `\n  GitHub rate limit reached after ${stats.asked} repositories` +
                (reset ? `; it resets at ${new Date(reset).toISOString()}` : "") +
              `. The rest fall back to registry timestamps.`,
            );
            return;
          }
        }
        if (res.status === 404 || res.status === 451) {
          // Gone or blocked: that is itself a fact about the server.
          cache.set(key, { pushedAt: null, archived: false, missing: true });
          continue;
        }
        if (!res.ok) {
          stats.failed++;
          continue;
        }

        const repo = await res.json();
        cache.set(key, {
          pushedAt: repo.pushed_at ?? null,
          archived: Boolean(repo.archived || repo.disabled),
          missing: false,
        });
      } catch {
        stats.failed++;
      } finally {
        process.stderr.write(`\r  dating: ${cache.size}/${keys.size + stats.cached}…`);
      }
    }
  }

  await Promise.all(Array.from({ length: workers }, worker));
  process.stderr.write(`\r  dating: ${cache.size} repositories dated\n`);
  return stats;
}

const DAY_MS = 86_400_000;

/** How long a repository date is reused before it is fetched again. */
const DATE_CACHE_TTL_DAYS = 7;

/**
 * Repository dates persist across runs, unlike the probe checkpoint.
 *
 * A push date does not change because the report was re-run, and re-asking
 * GitHub about thirteen thousand repositories to learn the same answer is the
 * kind of thing that gets a token rate-limited for everyone. Entries carry the
 * day they were fetched and are refreshed after a week.
 */
async function loadDateCache(now) {
  await mkdir(OUT_DIR, { recursive: true });
  const path = resolve(OUT_DIR, ".repo-dates.json");
  const cache = new Map();
  if (SKIP_DATES) return { path, cache };

  const stale = new Date(now).getTime() - DATE_CACHE_TTL_DAYS * DAY_MS;
  try {
    const raw = JSON.parse(await readFile(path, "utf8"));
    for (const [key, row] of Object.entries(raw)) {
      if (!row?.fetchedAt || new Date(row.fetchedAt).getTime() < stale) continue;
      cache.set(key, row);
    }
  } catch {
    /* no cache yet */
  }
  return { path, cache };
}

async function saveDateCache(path, cache, now) {
  if (SKIP_DATES || cache.size === 0) return;
  const out = {};
  for (const [key, row] of cache) out[key] = { ...row, fetchedAt: row.fetchedAt ?? now };
  await writeFile(path, JSON.stringify(out, null, 2) + "\n");
}


/**
 * Attach a maintenance verdict to each probed row.
 *
 * The cut is the day the revision shipped, not a rolling window. A 180-day
 * window was the first attempt and it separated nothing: 98.6% of the rows
 * carrying a real commit date landed inside it, because both the registry and
 * this revision are months old. Asking instead whether the code moved *after
 * 2026-07-28* is the question the number is for, and it splits the sample
 * roughly in half.
 *
 * The date is a repository push where one was obtainable and the registry
 * entry's own timestamp otherwise, and the row records which. The two are not
 * the same claim, and a report that blends them without saying so is back to
 * guessing.
 */
function attachActivity(probed, cache, now) {
  for (const row of probed) {
    const key = githubRepoKey(row.repository);
    const repo = key ? cache.get(key) : undefined;

    let at = null;
    let source = "none";
    if (repo?.pushedAt) {
      at = repo.pushedAt;
      source = "repository";
    } else if (row.registryUpdatedAt) {
      at = row.registryUpdatedAt;
      source = "registry";
    }

    row.lastActivityAt = at;
    row.activitySource = source;
    row.archived = Boolean(repo?.archived);
    row.repositoryMissing = Boolean(repo?.missing);
    row.touchedSinceSpec = at ? at.slice(0, 10) >= SPEC_RELEASED_AT : null;

    // Archived beats the date. A repository its owner froze is not a
    // maintainer declining to migrate, however recent its last commit is.
    if (repo?.archived || repo?.missing) row.activity = "archived";
    else if (!at) row.activity = "undated";
    else row.activity = row.touchedSinceSpec ? "touched" : "untouched";
  }
}

/**
 * Classify one probe.
 *
 * `graded` is the only outcome that enters the statistics. The rest are the
 * ways an endpoint can decline to be evidence: refused before we dialled,
 * never answered, or answered with something that shows no sign of being an
 * MCP server — neither protocol era identified, no auth challenge, no session
 * header, no capabilities. The last one is the dangerous case, because it
 * scores a clean A if you let it.
 */
function classify(probe) {
  if (!probe.reachable) {
    return { outcome: "unreachable", note: probe.rawError ?? "no response" };
  }
  const spokeMcp =
    probe.era !== "unknown" ||
    probe.authRequired ||
    probe.sessionIdOnModernRequest ||
    probe.sessionIdOnLegacyHandshake ||
    probe.advertisedCapabilities.length > 0;
  if (!spokeMcp) {
    return { outcome: "silent", note: "answered, but showed no MCP behaviour" };
  }

  const findings = evaluate({ live: probe });
  return { outcome: "graded", era: probe.era, findings, grade: gradeFrom(findings) };
}

/**
 * A probe worst case is three POSTs (modern `server/discover`, a modern
 * `tools/list` fallback, the legacy `initialize`) plus up to three metadata
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
const HARD_DEADLINE_MS = TIMEOUT_MS * 8;

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

/**
 * Deliberately source-neutral wording. A row's date is a repository push where
 * one was obtainable and the registry entry's own timestamp otherwise, so a
 * label that says "pushed" would be false for most of the table. The split by
 * source is printed underneath instead.
 */
const ACTIVITY_LABEL = {
  touched: `last activity on or after ${SPEC_RELEASED_AT}`,
  untouched: `last activity before ${SPEC_RELEASED_AT}`,
  archived: "repository archived, disabled or gone",
  undated: "no date could be obtained",
};

const ERA_LABEL = {
  modern: "serves 2026-07-28, no legacy handshake",
  dual: "dual-era: current **and** backwards compatible",
  legacy: "legacy only: no modern surface answered",
  unknown: "answered, but neither era could be confirmed",
};

function summarize(probed) {
  const graded = probed.filter((p) => p.outcome === "graded");

  const grades = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  for (const p of graded) grades[p.grade.letter]++;

  const eras = Object.fromEntries(Object.keys(ERA_LABEL).map((k) => [k, 0]));
  for (const p of graded) eras[p.era ?? "unknown"]++;

  // Era against maintenance. This is the cross-tab the aggregate percentage
  // was hiding: "abandoned" and "maintained but behind" are different problems
  // and only one of them is anybody's to fix.
  const byActivity = {};
  for (const key of Object.keys(ACTIVITY_LABEL)) {
    byActivity[key] = Object.fromEntries(Object.keys(ERA_LABEL).map((k) => [k, 0]));
    byActivity[key].total = 0;
  }
  for (const p of graded) {
    const bucket = byActivity[p.activity ?? "undated"];
    bucket[p.era ?? "unknown"]++;
    bucket.total++;
  }

  const dateSources = { repository: 0, registry: 0, none: 0 };
  for (const p of graded) dateSources[p.activitySource ?? "none"]++;

  // Rows that *could* have carried a repository date and did not. This is what
  // an exhausted rate limit actually costs: not an undated row, because the
  // registry timestamp always fills in, but a row resting on the weaker of the
  // two signals without that being visible in the table.
  const repoLinked = graded.filter((p) => p.repository).length;
  const weakened = graded.filter(
    (p) => p.repository && p.activitySource !== "repository",
  ).length;

  // Servers whose repository has not been touched since the revision shipped
  // cannot have migrated — counting them as "declined to migrate" is the
  // mistake that inflates a headline. Taken from the bucket rather than the
  // raw flag so the headline and the table below can never disagree: an
  // archived repository has a date but is not a maintainer declining anything.
  const touchedSinceSpec = graded.filter((p) => p.activity === "touched");
  const legacyAmongTouched = touchedSinceSpec.filter((p) => p.era === "legacy").length;

  // The same number split by which date it rests on. The two disagree by a
  // wide margin, and a reader who cannot see that cannot judge the headline.
  const touchedBySource = {};
  for (const src of ["repository", "registry"]) {
    const rows = touchedSinceSpec.filter((p) => p.activitySource === src);
    touchedBySource[src] = {
      total: rows.length,
      legacy: rows.filter((p) => p.era === "legacy").length,
      unknownEra: rows.filter((p) => p.era === "unknown").length,
    };
  }

  const ruleCounts = Object.fromEntries(rules.map((r) => [r.id, 0]));
  for (const p of graded) {
    for (const f of p.findings) ruleCounts[f.ruleId] = (ruleCounts[f.ruleId] ?? 0) + 1;
  }

  const outcomes = Object.fromEntries(Object.keys(OUTCOME_LABEL).map((k) => [k, 0]));
  for (const p of probed) outcomes[p.outcome]++;

  const withCritical = graded.filter((p) =>
    p.findings.some((f) => f.severity === "critical"),
  ).length;

  return {
    graded,
    grades,
    eras,
    byActivity,
    dateSources,
    touchedSinceSpec: touchedSinceSpec.length,
    legacyAmongTouched,
    touchedBySource,
    repoLinked,
    weakened,
    ruleCounts,
    outcomes,
    withCritical,
  };
}

const pct = (n, total) => (total === 0 ? "—" : `${((n / total) * 100).toFixed(1)}%`);

function renderMarkdown({ probed, summary, entries, localOnly, startedAt, dateStats }) {
  const {
    graded,
    grades,
    eras,
    byActivity,
    dateSources,
    touchedSinceSpec,
    legacyAmongTouched,
    touchedBySource,
    repoLinked,
    weakened,
    ruleCounts,
    outcomes,
    withCritical,
  } = summary;
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
      : `**${pct(eras.legacy, graded.length)} of the ${graded.length} graded ` +
          "endpoints serve the legacy protocol only** — they answer the removed " +
          "`initialize` handshake and no modern surface responded. A further " +
          `${pct(eras.dual, graded.length)} are dual-era: they serve 2026-07-28 ` +
          "*and* keep answering the old handshake, which the revision explicitly " +
          "permits and this report does not count against them.",
  );
  out.push("");
  if (graded.length > 0 && touchedSinceSpec > 0) {
    out.push(
      `**Narrowed to servers that could have migrated** — the ${touchedSinceSpec} ` +
        `whose repository or registry entry has been touched since ${SPEC_RELEASED_AT} ` +
        `— ${pct(legacyAmongTouched, touchedSinceSpec)} are still legacy-only. That ` +
        "is the number worth arguing about. The rest of the sample has not been " +
        "edited since the revision shipped, so it is not evidence of anyone " +
        "declining to move.",
    );
    out.push("");

    // That figure rests on two dates of very different strength, and they do
    // not agree. Printing the blend without the split would hide the weaker
    // half inside a confident-looking number.
    const byRepo = touchedBySource.repository;
    const byReg = touchedBySource.registry;
    out.push(
      `Those two words, "or registry entry", carry a lot. Split by which date ` +
        `the row rests on: of the ${byRepo.total} dated by a repository push, ` +
        `${pct(byRepo.legacy, byRepo.total)} are legacy-only; of the ` +
        `${byReg.total} resting on a registry timestamp, ` +
        `${pct(byReg.legacy, byReg.total)} are. Some of that gap is composition ` +
        `rather than substance — the registry-dated group has ` +
        `${pct(byReg.unknownEra, byReg.total)} whose era could not be ` +
        `determined at all, against ${pct(byRepo.unknownEra, byRepo.total)} ` +
        `among the repository-dated — but the stronger signal is also the less ` +
        `flattering one, and it is the half to trust.`,
    );
    out.push("");
  }
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
    "Only the graded row is scored below. An endpoint that answers but exposes " +
      "neither MCP protocol behaviour nor an authentication challenge told us " +
      "nothing, and counting it as clean is how a snapshot like this ends up " +
      "claiming the opposite of the truth.",
  );
  out.push("");
  out.push("## Which protocol era each server serves");
  out.push("");
  out.push(
    "This is the split that matters, and the reason an earlier version of this " +
      "report overstated the problem. Accepting the legacy handshake is a " +
      "compatibility choice, not a compliance failure: the revision says a " +
      "server that wants to serve both kinds of client **MAY** implement both " +
      "behaviours, and plenty of maintained servers do exactly that because v1 " +
      "clients are still out there. Only the third row has actually been left " +
      "behind.",
  );
  out.push("");
  out.push("| Era | Servers | Share |");
  out.push("| --- | --- | --- |");
  for (const [key, label] of Object.entries(ERA_LABEL)) {
    out.push(`| ${label} | ${eras[key]} | ${pct(eras[key], graded.length)} |`);
  }
  out.push("");
  out.push(
    `For reference: ${withCritical} of ${graded.length} graded endpoints ` +
      `(${pct(withCritical, graded.length)}) carry at least one critical finding, ` +
      "counting the OAuth posture rule alongside the era rules.",
  );
  out.push("");
  out.push("## Maintained, or just still listed?");
  out.push("");
  out.push(
    "A dead endpoint that returns 200 is indistinguishable from a maintained " +
      "one that chose not to migrate — unless you can date it. The registry " +
      "skews heavily toward servers listed once and never touched again, so an " +
      "aggregate percentage charges the whole ecosystem for what is largely a " +
      "graveyard. Where a registry entry links a GitHub repository, the table " +
      "below uses that repository's last push; otherwise it falls back to the " +
      "date the registry entry itself was last updated. The line is the day " +
      `the revision shipped, ${SPEC_RELEASED_AT}, rather than a rolling ` +
      "window: a 180-day window was the first attempt and it separated " +
      "nothing, because 98.6% of the rows carrying a real commit date fell " +
      "inside it. Both the registry and this revision are too young for that " +
      "question to mean anything.",
  );
  out.push("");
  out.push(`| | ${Object.keys(ERA_LABEL).join(" | ")} | All |`);
  out.push(`| --- | ${Object.keys(ERA_LABEL).map(() => "---").join(" | ")} | --- |`);
  for (const [key, label] of Object.entries(ACTIVITY_LABEL)) {
    const row = byActivity[key];
    const cells = Object.keys(ERA_LABEL).map((era) => `${row[era]}`);
    out.push(`| ${label} | ${cells.join(" | ")} | ${row.total} |`);
  }
  out.push("");
  out.push(
    `Dates came from a repository for ${dateSources.repository} of the graded ` +
      `endpoints (${pct(dateSources.repository, graded.length)}), from the ` +
      `registry entry for ${dateSources.registry}, and could not be had at all ` +
      `for ${dateSources.none}.`,
  );
  out.push("");
  out.push(
    `${repoLinked} graded endpoints link a repository, so that is the ceiling on ` +
      `the stronger signal. ${weakened} of them are counted on the registry ` +
      `timestamp anyway` +
      (dateStats?.rateLimited
        ? ", because the GitHub rate limit was reached mid-run. Nothing went " +
          "undated — the registry date always fills in — but that many rows rest " +
          "on the weaker of the two signals. Re-running the dating pass after " +
          "the limit resets moves them across."
        : ", because GitHub had no answer for them: the repository is private, " +
          "renamed, deleted, or not hosted there."),
  );
  out.push("");
  out.push(
    "The two dates are not the same claim. A repository push is evidence about " +
      "the code; a registry `updatedAt` only says when someone last published " +
      "an entry, which for a server listed once and forgotten is its original " +
      "publication date. Rows resting on the weaker signal are counted, but the " +
      "split above is how you can tell how much of the table they hold up.",
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
    out.push("| Server | Era | Last activity | Grade | Findings |");
    out.push("| --- | --- | --- | --- | --- |");
    for (const p of probed) {
      const grade = p.outcome === "graded" ? p.grade.letter : `— (${OUTCOME_LABEL[p.outcome]})`;
      const ids = (p.findings ?? []).map((f) => f.ruleId).join(", ") || "—";
      const when = p.lastActivityAt
        ? `${p.lastActivityAt.slice(0, 10)} (${p.activitySource})`
        : "—";
      out.push(`| ${p.name} | ${p.era ?? "—"} | ${when} | ${grade} | ${ids} |`);
    }
    out.push("");
  }

  out.push("## Method, and what this does not say");
  out.push("");
  out.push(
    "Each endpoint got one live probe from " +
      "[mcp-migration-check](https://github.com/AlpayC/mcp-migration-check). The " +
      "probe opens as a **modern** client — `server/discover` carrying " +
      "`io.modelcontextprotocol/protocolVersion` in `_meta` and the required " +
      "`MCP-Protocol-Version` header — falls back to a modern `tools/list` if " +
      "that is inconclusive, and only then sends a legacy `initialize` to see " +
      "whether the old door is still open. Plus a best-effort look for OAuth " +
      `protected-resource metadata. Nothing destructive, no authentication ` +
      `attempted, ${TIMEOUT_MS} ms timeout, ${CONCURRENCY} at a time.`,
  );
  out.push("");
  out.push(
    "- **The registry is not the ecosystem.** It lists servers that registered, " +
      "and only the ones publishing a remote endpoint appear above at all.",
  );
  out.push(
    "- **Dating uses a labelled fallback.** Where a GitHub repository date is " +
      "available, the report uses its last push. Otherwise it falls back to " +
      "the registry entry's `updatedAt`; only a row with neither source is " +
      "undated. The source split above shows how much of the report rests on " +
      "each signal.",
  );
  out.push(
    "- **A push is not a release.** A repository touched last week may have had " +
      "a typo fixed in its README; one untouched for a year may be finished " +
      "software that works. The date separates *abandoned* from *maintained*, " +
      "which is a coarser question than *cared for*.",
  );
  out.push(
    "- **A live probe cannot see SDK dependency rules.** MCP007 reads a " +
      "`package.json`; MCP009 reads Python project metadata or source; " +
      "MCP010 reads a `Cargo.toml`; MCP011 reads a `go.mod`. A probe " +
      "has none of them.",
  );
  out.push(
    "- **These rules are not the whole revision.** A server can pass every rule " +
      "here and still be broken — `resultType`, `subscriptions/listen`, the " +
      "removal of `ping` and `logging/setLevel`, and the required `Mcp-Method` / " +
      "`Mcp-Name` headers are not covered.",
  );
  out.push(
    "- **Legacy-only is a claim about what answered, not about what exists.** " +
      "MCP001 fires when the legacy handshake answers and *no* modern signal " +
      "did. A server that fails the modern probe for an unrelated reason — a " +
      "WAF eating an unfamiliar method, a gateway that only routes known paths " +
      "— lands in that row wrongly. The dual-era row cannot be wrong in the " +
      "same direction: it needs a positive modern answer.",
  );
  out.push(
    "- **`initialize` support is never counted as drift.** An earlier revision " +
      "of this report did count it, which inflated the headline: it graded " +
      "current servers as broken for staying compatible with clients still in " +
      "the field. MCP101 records that compatibility as an observation worth " +
      "zero points.",
  );
  out.push(
    "- **Authentication is evidence, not proof of MCP behaviour.** A registered " +
      "endpoint that returns `401` or `WWW-Authenticate` is graded so its OAuth " +
      "posture can be inspected, but an unauthenticated probe sees little else. " +
      "A generic protected endpoint can look the same from the outside.",
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

const now = new Date().toISOString();

/**
 * Top-up mode: finish the dating of a report that already exists.
 *
 * GitHub's limit is 5,000 requests an hour and the registry has more
 * repositories than that, so a full run can exhaust it partway and leave the
 * rest of the rows resting on the weaker registry timestamp. Re-probing 13,000
 * endpoints to fix that would cost hours and tell us nothing new about the
 * protocol, so this reads the probe results back out of the JSON, asks GitHub
 * only about the repositories still missing from the cache, and re-renders.
 *
 * Run it again after the limit resets. Each pass picks up where the last one
 * stopped, because the date cache persists for a week.
 */
let probed;
let entries;
let localOnly;
let startedAt;
let checkpoint = null;

if (TOP_UP) {
  const fromPath = resolve(process.cwd(), flag("from", "") || resolve(OUT_DIR, `ecosystem-${now.slice(0, 10)}.json`));
  let prior;
  try {
    prior = JSON.parse(await readFile(fromPath, "utf8"));
  } catch (err) {
    console.error(`Cannot read ${fromPath}: ${err.message}`);
    console.error("  --top-up needs the JSON from a completed run; point at it with --from <path>.");
    process.exit(2);
  }
  probed = prior.results ?? [];
  entries = prior.registryEntries;
  localOnly = prior.localOnly;
  // The probe date belongs to the original run. Only the dates are new.
  startedAt = prior.startedAt ?? now;
  console.error(`Top-up: ${probed.length} probed endpoints read from ${fromPath}`);
  console.error(`  (probed ${startedAt}; no endpoint will be contacted again)`);
} else {
  startedAt = now;
  checkpoint = await openCheckpoint(startedAt.slice(0, 10));
  if (checkpoint.done.size > 0) {
    console.error(`Resuming: ${checkpoint.done.size} endpoint(s) already probed today.`);
    console.error(`  (--fresh to start over; the file is ${checkpoint.path})`);
  }

  console.error("Collecting targets from the MCP registry…");
  const collected = await collectTargets();
  if (collected.targets.length === 0) {
    console.error("No remote endpoints found — nothing to probe.");
    process.exit(2);
  }
  entries = collected.entries;
  localOnly = collected.localOnly;

  console.error(`Probing ${collected.targets.length} endpoints…`);
  probed = await probeAll(collected.targets, checkpoint);
}

const day = startedAt.slice(0, 10);

// Dating runs after probing on purpose: the probe is the expensive, resumable
// half, and a GitHub outage must not cost it. The probed rows carry the
// registry's `repository` field, so they are what the dating pass reads —
// which is also what makes a top-up run possible without a registry walk.
const { path: datePath, cache: dateCache } = await loadDateCache(now);
let dateStats = { asked: 0, cached: dateCache.size, rateLimited: false, failed: 0 };
if (!SKIP_DATES) {
  console.error("Dating repositories…");
  dateStats = await collectRepoDates(probed, dateCache);
  await saveDateCache(datePath, dateCache, now);
}
attachActivity(probed, dateCache, now);

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
      eras: summary.eras,
      byActivity: summary.byActivity,
      dateSources: summary.dateSources,
      touchedSinceSpec: summary.touchedSinceSpec,
      legacyAmongTouched: summary.legacyAmongTouched,
      touchedBySource: summary.touchedBySource,
      specReleasedAt: SPEC_RELEASED_AT,
      dateStats,
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
await writeFile(
  mdPath,
  renderMarkdown({ probed, summary, entries, localOnly, startedAt, dateStats }),
);

// Nothing downstream keeps its own copy of these figures. The JSON above is
// 16 MB and gitignored, so the aggregates are extracted to a committed summary
// and every surface that quotes a number — the site, both READMEs — is
// re-rendered from it here. Regenerating a report and publishing a stale
// percentage is not a mistake anyone should have to remember not to make.
const { outfile: summaryPath } = await extractSummary();
const { written: surfaces } = await renderSurfaces();

console.error("");
for (const [key, label] of Object.entries(OUTCOME_LABEL)) {
  console.error(`  ${String(summary.outcomes[key]).padStart(5)}  ${label}`);
}
console.error("");
for (const [key, label] of Object.entries(ERA_LABEL)) {
  console.error(`  ${String(summary.eras[key]).padStart(5)}  ${label.replace(/\*\*/g, "")}`);
}
console.error(
  `\n  ${summary.eras.legacy} of ${summary.graded.length} graded ` +
    `(${pct(summary.eras.legacy, summary.graded.length)}) serve the legacy protocol only`,
);
if (summary.touchedSinceSpec > 0) {
  console.error(
    `  ${summary.legacyAmongTouched} of ${summary.touchedSinceSpec} touched since ` +
      `${SPEC_RELEASED_AT} (${pct(summary.legacyAmongTouched, summary.touchedSinceSpec)}) ` +
      "are still legacy-only",
  );
}
console.error(
  `  ${summary.withCritical} of ${summary.graded.length} graded ` +
    `(${pct(summary.withCritical, summary.graded.length)}) have a critical finding`,
);
console.error("");
console.error(`Wrote ${jsonPath}`);
console.error(`Wrote ${mdPath}`);
console.error(`Wrote ${summaryPath}`);
for (const path of surfaces) console.error(`Wrote ${path}`);

// The report is written, so the checkpoint has done its job. A top-up run
// never opened one — it had no endpoints to probe.
await checkpoint?.discard();

// A probe that blew its deadline is still out there holding a socket, and an
// open socket keeps the event loop alive — the process would sit here having
// already written everything it was asked to write.
process.exit(0);
