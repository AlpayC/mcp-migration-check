## What and why

<!-- What changes, and what problem it solves. The reason matters more than the diff. -->

## Checks

- [ ] `npm test` and `npm run typecheck` pass
- [ ] If `packages/core` changed: ran `npm run build:skill` and committed the
      regenerated `skill/mcp-migration/scripts/mcpcheck.mjs` in this PR

      <sub>This is the one that catches everybody. The bundle is generated but
      committed, so the skill works without an install — a stale copy makes the
      skill and the web demo disagree about the rules while both look fine.</sub>

## For a rule change

- [ ] `specRef` is a URL I opened, and it is a subpage rather than the revision root
- [ ] Tests cover both the firing and the quiet case
- [ ] `references/remediation.md` has a matching section
- [ ] The README rule table is updated

<!-- Not a rule change? Delete this section. -->
