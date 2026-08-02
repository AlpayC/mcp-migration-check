# Contributing

Issues and pull requests are welcome. This is a personal project, so replies
may take a few days.

## Setup

```bash
npm install          # from the repo root, not from a workspace
npm test             # 86 assertions, no network, no disk
npm run typecheck    # engine + tests, then web separately
```

CI runs the same commands plus a Next build, a check that the bundled skill is
in sync, and the two fixtures. A pull request needs all of it green.

## The one thing that catches everyone

`skill/mcp-migration/scripts/mcpcheck.mjs` is **generated** — an esbuild bundle
of `packages/core`, committed so the skill runs without an install. Change the
engine and it goes stale:

```bash
npm run build:skill   # then commit the result in the same change
```

CI fails otherwise. A stale bundle means the skill and the web demo disagree
about the rules while both look healthy on their own.

The remaining invariants live in [AGENTS.md](./AGENTS.md) — how to add a rule,
why every `specRef` must be a URL someone opened, and why the fixtures are test
material rather than code to fix. That file is written for coding agents, but
it is the same list either way.

## What gets accepted

**Rule corrections, gladly.** If a rule is wrong, say what the spec actually
says and link the page. The project has shipped a rule that advised upgrading
to an SDK version that has never existed — see *A rule that was wrong* in the
README — so a correction backed by evidence is the most useful thing you can
send.

**New rules, with a citation.** A rule needs a spec page that states the change,
a test for both the firing and the quiet case, a remediation section keyed by
its id, and a row in the README table. Severity follows the spec: a deprecation
with a twelve-month window is a `warning`, not a `critical`.

**Bug reports for false positives.** Include the endpoint or a minimal file, and
the output of `node skill/mcp-migration/scripts/mcpcheck.mjs … --json`. False
positives are the failure mode that matters most — a checker nobody trusts is
worse than no checker.

## What probably does not fit

- Rules for protocols other than MCP, or for revisions other than 2026-07-28.
  The engine is written to be retargetable, but this repository tracks one break.
- Turning heuristics into certainties. The source scan greps; that limitation is
  documented rather than hidden, and the skill's triage step depends on it being
  stated honestly.
- A letter grade that means more than it can. The score is a headline for
  humans, not a conformance measure, and the README says so.

## Commits

Conventional prefixes (`feat`, `fix`, `docs`, `test`, `ci`, `chore`, `refactor`)
with a scope where one applies. The body should explain *why* rather than
restate the diff — the existing history is the reference.
