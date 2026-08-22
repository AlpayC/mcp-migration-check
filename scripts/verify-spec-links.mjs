#!/usr/bin/env node
/**
 * Verify that every rule's `specRef` still says what the rule claims it says.
 *
 * A status check is not enough, and this project has the receipt: the original
 * refs were `…/2026-07-28#lifecycle` and friends. Those return 200. The server
 * happily serves the overview page and the fragment matches nothing, so a link
 * checker passes all seven while every citation is wrong.
 *
 * So each ref is paired with a marker — a phrase that appears on the page it is
 * supposed to be and nowhere near the overview page. Fetch, look for the marker,
 * fail loudly if it is gone. That catches a moved page, a rewritten section, and
 * a silent redirect, none of which a 200 distinguishes.
 *
 * The marker table is deliberately here rather than in rules.ts: the rules are
 * shipped to users, this is maintenance. The coverage check at the bottom keeps
 * the two from drifting — a new rule with no marker fails the run.
 *
 * Suggested by Mads Hansen in the comments on the write-up.
 */
import { rules } from "../packages/core/src/rules.ts";

/** specRef → a phrase that must appear on that page. */
const MARKERS = {
  "https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http":
    "Removal of protocol-level sessions",
  // The backwards-compatibility carve-out MCP001 and MCP101 turn on. If this
  // sentence ever leaves the page, both rules need re-reading before the next
  // release — it is the whole reason they are scored the way they are.
  "https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning":
    "implement both behaviors",
  "https://modelcontextprotocol.io/specification/2026-07-28/server/discover":
    "DiscoverResult",
  "https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/logging":
    "Logging",
  "https://modelcontextprotocol.io/specification/2026-07-28/client/sampling":
    "Sampling",
  "https://modelcontextprotocol.io/specification/2026-07-28/client/roots":
    "Roots",
  "https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization":
    "OAuth 2.1 resource server",
  "https://blog.modelcontextprotocol.io/posts/sdk-betas-2026-07-28/":
    "2026-07-28",
  "https://py.sdk.modelcontextprotocol.io/migration/":
    "Migration Guide: v1 to v2",
  "https://github.com/modelcontextprotocol/rust-sdk":
    "official Rust Model Context Protocol SDK",
};

const TIMEOUT_MS = 20_000;

async function check(url, marker) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "mcp-migration-check/spec-link-verifier" },
      redirect: "follow",
    });
    if (!res.ok) return { ok: false, why: `HTTP ${res.status}` };

    const body = await res.text();
    if (!body.includes(marker)) {
      return {
        ok: false,
        why: `200 but the page does not contain ${JSON.stringify(marker)} — moved, rewritten, or silently redirected`,
      };
    }
    // The bug that started this: a fragment that matches nothing still returns 200.
    if (url.includes("#")) return { ok: false, why: "ref relies on a fragment" };

    return { ok: true, why: `${res.status}, marker present` };
  } catch (err) {
    return { ok: false, why: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

const refs = [...new Set(rules.map((r) => r.specRef))].sort();
let failed = 0;

// Coverage first: an unmarked ref is a silent gap, not a pass.
for (const ref of refs) {
  if (!(ref in MARKERS)) {
    console.error(`MISSING MARKER  ${ref}\n  add it to MARKERS in this script`);
    failed++;
  }
}
for (const url of Object.keys(MARKERS)) {
  if (!refs.includes(url)) {
    console.error(`STALE MARKER    ${url}\n  no rule cites this any more`);
    failed++;
  }
}

for (const ref of refs) {
  const marker = MARKERS[ref];
  if (!marker) continue;
  const { ok, why } = await check(ref, marker);
  const ids = rules.filter((r) => r.specRef === ref).map((r) => r.id).join(", ");
  console.log(`${ok ? "ok  " : "FAIL"}  ${ids.padEnd(20)} ${ref}\n        ${why}`);
  if (!ok) failed++;
}

console.log(`\n${refs.length} refs checked, ${failed} problem(s).`);
process.exit(failed === 0 ? 0 : 1);
