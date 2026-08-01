# mcp-migration-check

**Will your MCP server survive the 2026-07-28 rewrite?**

The [Model Context Protocol](https://modelcontextprotocol.io) revision dated
**2026-07-28** is the largest breaking change in the protocol's history: it
makes the transport **stateless**, formalizes **OAuth 2.1** for remote servers,
and **deprecates** several capabilities. Migrating is a refactor, not a version
bump — and a large share of the thousands of public servers aren't actively
maintained.

`mcp-migration-check` is a small, **deterministic** readiness checker. It points
at a running MCP endpoint (or scans a repo) and reports, with a letter grade and
per-finding fixes, exactly what breaks. No LLM, no API key, nothing stored.

It ships as two surfaces over one core:

| Surface       | Use it to…                                                    |
| ------------- | ------------------------------------------------------------- |
| **Web demo**  | paste a URL, get a graded report — nothing to install          |
| **Skill**     | hand an agent the diagnosis *and* the migration procedure      |

The split is deliberate. The web demo sees a server from the outside and answers
*"am I broken?"*. The skill sees the code and answers *"fix it"* — which is the
part that actually takes a week.

---

## Quick start

### Web demo

```bash
npm install
npm run dev:web   # http://localhost:3000
```

Paste an endpoint and read the graded report. The handler enforces an **SSRF
guard**: it refuses `localhost`, private ranges, and the cloud metadata address,
because it fetches a user-supplied URL server-side.

### Skill

```bash
npm install
npm run pack:skill   # → dist/mcp-migration.skill
```

Install the `.skill` file in Claude, then ask it to migrate a server. The skill
bundles a dependency-free copy of the rule engine, so the agent's diagnosis step
is deterministic rather than a guess from reading code — and `references/`
carries the per-rule remediation guidance for the part that follows.

Run the bundled checker directly if you want:

```bash
node skill/mcp-migration/scripts/mcpcheck.mjs --source ./my-server
node skill/mcp-migration/scripts/mcpcheck.mjs --local http://localhost:3000/mcp
```

---

## What it checks

| Rule   | Severity | Signal                                                    |
| ------ | -------- | --------------------------------------------------------- |
| MCP001 | critical | legacy `initialize` handshake (stateless model removes it) |
| MCP002 | critical | `Mcp-Session-Id` / session state — the classic hazard      |
| MCP003 | warning  | deprecated `logging` capability                            |
| MCP004 | warning  | deprecated `sampling` capability                           |
| MCP005 | warning  | deprecated `roots` capability                              |
| MCP006 | critical | auth without RFC 9728 protected-resource metadata          |
| MCP007 | warning  | still on `@modelcontextprotocol/sdk` (the v1 line)          |

Live checks observe runtime behavior over HTTP; source scans grep for the same
signals in code. Each finding links the spec page it derives from.

## Honest limitations

- **Seven rules are not the whole revision.** The 2026-07-28 changelog also makes
  `server/discover` mandatory, requires a `resultType` on every result, replaces
  the GET stream and `resources/subscribe` with `subscriptions/listen`, removes
  `ping`, `logging/setLevel` and SSE resumability, and requires `Mcp-Method` /
  `Mcp-Name` headers. A server can pass all seven rules and still be broken. This
  is a triage tool, not a conformance suite.
- **The source scan is heuristic.** It greps for patterns, so it can miss
  dynamically-built capability names and can over-match inside comments.
  Treat source findings as signals to review, not proof. The live probe is
  more authoritative for runtime behavior; the two complement each other.
- **The web demo only sees the outside.** It probes over HTTP, so it reaches at
  most six of the seven rules — MCP007 needs a `package.json`, and MCP002 is far
  easier to spot in code than in a header. Use the skill for real work.
- **MCP001 fires against essentially every server in existence** today, because
  every current server answers `initialize`. That is the point of the rule, but
  it does mean a passing grade is rare and the scale is not well spread.
- **MCP007 is TypeScript-only.** It reads `package.json`, so a Python, Go or C#
  server gets no SDK signal at all — even though those SDKs also moved (Python
  and C# to 2.x, Go to a 1.x minor).

## Architecture

```
packages/core           pure, deterministic engine (rules · probe · scan · SSRF guard)
packages/core/test      node:test suite over the engine — no network, no disk
skill/mcp-migration     SKILL.md + bundled engine + per-rule remediation guide
web                     Next.js demo (App Router) over the same core
scripts/build-skill.mjs bundles the engine into the skill (esbuild, no deps in output)
```

```bash
npm test        # node --test via tsx; 81 assertions, no network
npm run typecheck
```

The suite leans on the seams the engine already had: rules are pure functions
over a `RuleContext`, and `probeEndpoint` takes a `fetchImpl`. The SSRF guard
gets the most coverage — it is a security control on a public handler, so each
blocked range is paired with the adjacent address that must still pass.

One core, two consumers — the rules live in exactly one place, and the skill's
copy of the engine is generated, never hand-edited.

## Tech

TypeScript · Node 22 · npm workspaces · Next.js 16 (App Router, Turbopack) ·
React 19.2 · Tailwind v4 · Magic UI · Cloudflare Workers via OpenNext.
No runtime LLM. MIT licensed.

## License

[MIT](./LICENSE)
