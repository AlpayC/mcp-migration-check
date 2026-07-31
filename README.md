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

It ships as three thin surfaces over one core:

| Surface        | Use it to…                                              |
| -------------- | ------------------------------------------------------- |
| **CLI**        | check an endpoint or scan a repo locally; wire into CI  |
| **MCP server** | let a coding agent check readiness inside its own loop  |
| **Web demo**   | paste a URL, get a graded report — nothing to install   |

---

## Quick start

### CLI

```bash
# Check a live endpoint
npx mcpcheck https://example.com/mcp

# Scan a repository statically
npx mcpcheck --source ./my-server

# Machine-readable output (CI)
npx mcpcheck https://example.com/mcp --json
```

Exit codes: `0` clean · `1` at least one critical finding · `2` inconclusive
(unreachable / blocked / nothing to scan). That makes it a drop-in CI gate.

### MCP server

Run it over stdio and add it to an MCP client (Claude Desktop, Claude Code,
Cursor). It exposes two tools — `check_migration_readiness` (live) and
`scan_source_migration` (repo) — so an agent can check a server and act on the
findings itself.

```jsonc
// e.g. Claude Desktop config
{
  "mcpServers": {
    "migration-check": {
      "command": "npx",
      "args": ["-y", "mcpcheck-server"]
    }
  }
}
```

### Web demo

```bash
npm install
npm run dev:web   # http://localhost:3000
```

Paste an endpoint and read the graded report. The handler enforces an **SSRF
guard**: it refuses `localhost`, private ranges, and the cloud metadata address,
because it fetches a user-supplied URL server-side.

---

## What it checks

| Rule   | Severity | Signal                                                    |
| ------ | -------- | --------------------------------------------------------- |
| MCP001 | critical | legacy `initialize` handshake (stateless model removes it) |
| MCP002 | critical | `Mcp-Session-Id` / session state — the classic hazard      |
| MCP003 | warning  | deprecated `logging` capability                            |
| MCP004 | warning  | deprecated `sampling` capability                           |
| MCP005 | warning  | deprecated `roots` capability                              |
| MCP006 | critical | auth without OAuth 2.1 protected-resource metadata         |
| MCP007 | warning  | pre-2.0 `@modelcontextprotocol/sdk` pin                    |

Live checks observe runtime behavior over HTTP; source scans grep for the same
signals in code. Each finding links the spec section it derives from.

## Honest limitations

- **The source scan is heuristic.** It greps for patterns, so it can miss
  dynamically-built capability names and can over-match inside comments.
  Treat source findings as signals to review, not proof. The live probe is
  more authoritative for runtime behavior; the two complement each other.
- **Rules track a recent spec.** Verify the cited sections against the
  canonical spec before relying on a grade. Rules are data-first
  (`packages/core/src/rules.ts`) so correcting or adding one is a small edit.
- **Detection, not migration.** The official SDK ships a v1→v2 codemod for the
  mechanical renames; this tool tells you *what* to change and *why*, and pairs
  well with the agent-in-the-loop path via the MCP server.

## Architecture

```
packages/core   pure, deterministic engine (rules · probe · scan · SSRF guard) + CLI
packages/mcp    MCP server exposing the checker as tools
web             Next.js demo (App Router) over the same core
```

One core, three consumers — the rules live in exactly one place.

## Tech

TypeScript · Node 22 · npm workspaces · `@modelcontextprotocol/sdk` · Next.js
(App Router). No runtime LLM. MIT licensed.

## License

[MIT](./LICENSE)
