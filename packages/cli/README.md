# mcp-migration-check

**Will your MCP server survive the 2026-07-28 rewrite?**

```bash
npx mcp-migration-check https://example.com/mcp   # probe a live endpoint
npx mcp-migration-check --source ./my-server      # scan a repository
```

The [Model Context Protocol](https://modelcontextprotocol.io) revision dated
**2026-07-28** makes the transport stateless, formalizes OAuth 2.1 for remote
servers, and deprecates several capabilities. This is a small, **deterministic**
readiness checker for it: point it at a running endpoint or a source tree and it
reports, with a letter grade and per-finding fixes, what breaks. No LLM, no API
key, nothing stored, no dependencies.

```
Target: https://example.com/mcp  (live)
Grade:  C (70/100)

[CRITICAL] Legacy initialize handshake  (MCP001)
  observed: server responded to `initialize`
  fix:      remove the handshake; the stateless model has no lifecycle phase
  spec:     https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http
```

## Usage

```
mcp-migration-check <url>            Probe a live MCP endpoint (http/https)
mcp-migration-check --source <dir>   Statically scan a repository
mcp-migration-check --local <url>    Allow localhost/private targets (SSRF guard off)
mcp-migration-check ... --json       Machine-readable output
```

Exit codes: `0` no critical findings · `1` at least one critical finding ·
`2` inconclusive (unreachable, blocked, or nothing to scan). That makes it
usable as a CI gate directly, or via the
[GitHub Action](https://github.com/AlpayC/mcp-migration-check#github-action).

## What it checks

| Rule   | Severity | Signal                                                     |
| ------ | -------- | ---------------------------------------------------------- |
| MCP001 | critical | legacy `initialize` handshake (stateless model removes it)  |
| MCP002 | critical | `Mcp-Session-Id` / session state — the classic hazard       |
| MCP003 | warning  | deprecated `logging` capability                             |
| MCP004 | warning  | deprecated `sampling` capability                            |
| MCP005 | warning  | deprecated `roots` capability                               |
| MCP006 | critical | auth without RFC 9728 protected-resource metadata           |
| MCP007 | warning  | still on `@modelcontextprotocol/sdk` (the v1 line)          |

**Seven rules are not the whole revision** — a server can pass all seven and
still be broken. The source scan is heuristic and can over-match; the live probe
only sees the outside. This is triage, not a conformance suite. The full list of
limitations is in the
[repository README](https://github.com/AlpayC/mcp-migration-check#honest-limitations).

Fixing what it finds is the part that actually takes a week, and there is an
agent skill for that — see
[the repository](https://github.com/AlpayC/mcp-migration-check#skill).

## Links

- [Live web demo](https://mcp-migration-check.alpaycelik.workers.dev) — paste a URL, nothing to install
- [Source](https://github.com/AlpayC/mcp-migration-check)

MIT
