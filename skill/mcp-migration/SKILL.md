---
name: mcp-migration
description: Diagnose and carry out the migration of an MCP server to the 2026-07-28 specification — the revision that made the transport stateless, formalized OAuth 2.1, and deprecated the logging, sampling, and roots capabilities. Use this skill whenever someone mentions migrating, upgrading, or checking an MCP server against the 2026-07-28 spec; asks whether their MCP server still works, is "ready", or will break; mentions the stateless transport model, Mcp-Session-Id, or OAuth 2.1 for MCP; or is debugging an MCP server that stopped working after a spec or SDK bump. Also use it when someone asks you to review or audit MCP server code for compatibility, even if they don't name the spec date.
---

# MCP 2026-07-28 migration

The 2026-07-28 revision is a refactor, not a version bump. Four things this
checker looks for break existing servers:

1. **The transport is stateless.** The `initialize`/`notifications/initialized`
   handshake and the `Mcp-Session-Id` header are gone from *this* revision.
   Every request carries its own protocol version and client capabilities in
   `_meta`. **This does not mean deleting the handshake.** A server "wishing to
   support both legacy clients … and modern clients **MAY** implement both
   behaviors" and picks its semantics from how each request opens — so the goal
   is to *add* the modern path, and retire the legacy one on the schedule your
   own clients dictate. Removing it for compliance breaks every v1 client for
   no gain.
2. **OAuth 2.1 is formalized** for remote servers: a protected MCP server acts
   as an OAuth 2.1 resource server and **MUST** implement RFC 9728
   protected-resource metadata.
3. **`logging`, `sampling`, and `roots` are deprecated** — still functional, with
   a twelve-month minimum window, but new implementations should not adopt them.
4. **The TypeScript SDK moved to v2 under new package names.**
   `@modelcontextprotocol/sdk` is the v1 line and stops at 1.30.0. v2 ships as
   `@modelcontextprotocol/server` + `@modelcontextprotocol/client` (plus
   `/core` and an `/express`, `/fastify` or `/hono` adapter).

The revision changed more than the checker covers: `server/discover` is now
mandatory, all results carry a required `resultType`, the GET stream and
`resources/subscribe` are replaced by `subscriptions/listen`, `ping` and
`logging/setLevel` are gone, SSE resumability is removed, and `Mcp-Method` /
`Mcp-Name` headers are required. **A clean checker run is not a migration.**
Read the [changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
before declaring a server done.

**Do not tell anyone to upgrade `@modelcontextprotocol/sdk` to `^2`.** That
package has never published a 2.x — the migration is to the new package names
above. There *is* an official codemod, and it is a separate package:

```bash
npx @modelcontextprotocol/codemod@latest v1-to-v2 .
```

The other Tier 1 SDKs moved differently: Python and C# to 2.x majors, Go to a
1.x minor. Check the actual package before advising a version.

Work in this order: diagnose, triage, remediate, re-verify. The diagnosis step
is scripted so it gives the same answer every time — resist the urge to skip it
and eyeball the code, because the rule ids it emits are what the remediation
guidance keys off.

## Step 1 — Diagnose

Run the bundled checker. It needs nothing but Node — no install step.

```bash
# Scan a repository (the richest signal; this is the one to start with)
node scripts/mcpcheck.mjs --source /path/to/the/server

# Probe a running endpoint
node scripts/mcpcheck.mjs https://example.com/mcp

# Probe a local dev server (disables the SSRF guard)
node scripts/mcpcheck.mjs --local http://localhost:3000/mcp

# Machine-readable, if you want to process the findings
node scripts/mcpcheck.mjs --source . --json
```

Run **both** the source scan and a live probe when a server is actually
running. They see different things and neither is a superset of the other:

| | Source scan | Live probe |
|---|---|---|
| Sees | the code, `package.json`, `file:line` | both protocol eras, headers, advertised capabilities, OAuth posture |
| Finds | MCP001–005, **MCP007** (SDK line) | MCP001–006, **MCP008**, MCP101/102 |
| Needs | a checkout | a reachable endpoint |

Exit codes: `0` no critical findings · `1` at least one critical · `2`
inconclusive (unreachable, blocked, or nothing to scan).

## Step 2 — Triage before you touch anything

The source scan is **regex-based**. It greps for the patterns that correlate
with each hazard, which means it reports signals, not proof. Two consequences
worth internalising before you start editing:

- **False positives are normal.** A file that merely mentions `initialize` in a
  comment, or a variable coincidentally named `sessionId`, will be flagged. The
  checker's own source flags itself for all five code rules, because the rules
  file contains the very strings it searches for.
- **A clean scan is not a guarantee.** Session state can be spelled in ways the
  patterns don't catch — a `Map` keyed by something the code calls `clientKey`,
  for instance.

So read each finding at its `file:line`, decide whether it is real, and say so
explicitly before changing anything. A short triage table is a good artefact to
produce here: rule, location, real or false positive, and why.

Findings are graded: 100 minus 30 per critical and 15 per warning. `info`
findings (`MCP1xx`) cost **nothing** — they record compatibility choices the
spec permits, such as a dual-era server still answering `initialize`, so that a
report can distinguish "still accepts legacy" from "only accepts legacy". Treat
the letter grade as a headline for humans, not as the thing to optimize. Fixing
the criticals matters far more than the score moving from D to B.

## Step 3 — Remediate

Read `references/remediation.md` for the per-rule guidance. It is organised by
rule id, so go straight to the sections your findings named rather than reading
it end to end.

Sequence matters. Do it in this order, because later steps depend on earlier
ones:

1. **MCP007 first** — move to the v2 packages and run the codemod. Doing this
   before the code changes means you refactor against the API you are going to
   keep, instead of refactoring twice. The codemod handles renames, not
   architecture; the type errors it leaves behind point straight at the MCP002
   work.
2. **MCP002 (session state)** — the deepest change, and the one most likely to
   surface hidden design assumptions.
3. **MCP001 (legacy-only)** — add the modern request path and
   `server/discover`; largely mechanical once state is gone. Keep the legacy
   handshake serving alongside it unless you have decided, as a product call,
   to drop v1 clients.
4. **MCP003/004/005 (deprecated capabilities)** — removals, each one localised.
   These are `warning`, not `critical`, and the deprecation window is at least
   twelve months. If the migration is already large, deferring them is a
   defensible call — say so rather than silently skipping them.
4. **MCP006 (OAuth posture)** — deployment-facing; independent of the rest.

After each step, re-run the scan. Watching one rule at a time go quiet is a
much better signal than a single run at the end where you can't tell which
change fixed what.

## Step 4 — Verify

Re-run both the source scan and, if a server is running, the live probe. Then
check the things the scanner structurally cannot see:

- Does the server still behave correctly when two consecutive requests land on
  **different instances**? This is the real test of statelessness, and no static
  scan can answer it. Run two instances behind anything that round-robins, or
  restart the process between requests.
- Do the tests still pass, and do they still cover the paths you changed?
- If you removed `sampling`, has the model-calling responsibility actually moved
  to the client, or has it just been deleted?

## Reporting back

Close with a short summary in this shape — it is what someone reviewing the
migration needs, and nothing more:

```
## Migration summary
- Before: <grade> — <n> findings (<n> critical)
- After:  <grade> — <n> findings (<n> critical)

## Changed
- <rule id>: <what was changed, where>

## Dismissed as false positives
- <rule id> at <file:line>: <why it was not a real hazard>

## Still open
- <anything deliberately not fixed, and why>
```

The "dismissed" section is the one people skip and later regret. If you decided
a finding was noise, the reasoning needs to survive past the end of the session.

## A note on the spec itself

The findings link to the canonical spec at
`https://modelcontextprotocol.io/specification/2026-07-28`. When a fix involves
an exact API signature or a precise header name, check it there rather than
trusting a remembered detail — this skill describes the shape of each change,
not a frozen copy of the specification.
