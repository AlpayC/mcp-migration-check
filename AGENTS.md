# Working in this repository

Read this before changing anything. It is short, and the parts that look
pedantic are the ones that have already gone wrong once.

## Shape

One rule engine, two consumers. `packages/core` is pure and deterministic; it
never reaches the network or the disk from inside a rule. Probing an endpoint
and scanning a repository both produce a normalized `RuleContext`, and rules
only read that.

```
packages/core           the engine — rules · probe · scan · SSRF guard
packages/core/test      node:test suite, no network, no disk
skill/mcp-migration     SKILL.md + a generated copy of the engine
web                     Next.js demo on Cloudflare Workers over the same core
```

## Rules that are not negotiable

**`skill/mcp-migration/scripts/mcpcheck.mjs` is generated. Never edit it by
hand.** It is an esbuild bundle of `packages/core`, produced by
`npm run build:skill` and committed so the skill works without an install. If
you change the engine, rebuild it in the same commit — CI fails otherwise, and
a stale bundle means the skill and the web demo disagree about the rules while
both look healthy in isolation.

**Every `specRef` must be a URL you have opened.** All seven originally pointed
at `…/2026-07-28#lifecycle` and similar anchors that do not exist; the spec is
split across subpages, so each link silently landed on the overview page. A
test now rejects any `specRef` containing `#`.

**Verify claims about the ecosystem against the ecosystem, not against
memory.** MCP007 once advised upgrading `@modelcontextprotocol/sdk` to `^2` and
running a codemod. That package has never published a 2.x — v2 shipped as a
rename to `@modelcontextprotocol/server` and `/client`. Check npm and the spec
before writing a `fix` string. See the README section "A rule that was wrong".

## Before you say it works

```bash
npm run typecheck    # core + tests + (separately) web
npm test             # 119 assertions
npm run build:skill  # then check git status is clean
```

The fixtures under `skill/mcp-migration-workspace/fixtures` are test material,
not examples to fix. `acme-search-mcp` is genuinely broken; `notes-mcp` is
mostly a false-positive trap — its `sessionId` is `express-session` for an
admin UI, and its MCP transport already runs stateless. An agent that
"migrates" `notes-mcp` has failed.

## Adding a rule

Rules are data-first in `packages/core/src/rules.ts`. A new one needs:

1. an entry in the `SPEC` map with a URL that resolves to a real subpage
2. an `evaluate` that reads only from `RuleContext`
3. tests covering both the firing and the quiet case
4. a section in `skill/mcp-migration/references/remediation.md`, keyed by id
5. a row in the README table

Severity drives the score: 30 per critical, 15 per warning, 5 per info. A
deprecation with a twelve-month window is a `warning`, not a `critical`.

## Commits

Conventional prefixes, and the body explains *why* rather than restating the
diff. The existing history is the reference.
