# mcp-migration-check

**Will your MCP server survive the 2026-07-28 rewrite?**

```bash
npx mcp-migration-check https://example.com/mcp   # probe a live endpoint
npx mcp-migration-check --source ./my-server      # scan a repository
```

Or `pnpm dlx`, `yarn dlx`, `bunx` — no dependencies, nothing to install either
way.

The [Model Context Protocol](https://modelcontextprotocol.io) revision dated
**2026-07-28** makes the transport stateless, formalizes OAuth 2.1 for remote
servers, and deprecates several capabilities. This is a small, **deterministic**
readiness checker for it: point it at a running endpoint or a source tree and it
reports, with a letter grade and per-finding fixes, what breaks. No LLM, no API
key, nothing stored, no dependencies.

```
Target: ./my-server  (source)
Grade:  F (0/100)
Scanned 2 file(s).

[CRITICAL] Legacy-only: the current revision is not served  (MCP001)
  at:       src/index.ts:62
  observed: Source implements the `initialize` lifecycle and nothing that
            handles the modern per-request `_meta` envelope or `server/discover`.
            As written, this server serves legacy clients only.
  fix:      Add the modern path — do not remove the legacy one. Serve requests
            carrying `io.modelcontextprotocol/protocolVersion` in `_meta`
            statelessly, and implement `server/discover`. […]
  spec:     https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning

  […] 4 more findings
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

| Rule   | Severity | Signal                                                              |
| ------ | -------- | ------------------------------------------------------------------- |
| MCP001 | critical | legacy-only: answers `initialize`, serves no modern surface         |
| MCP002 | critical | `Mcp-Session-Id` minted for a _modern_ request — the classic hazard |
| MCP003 | warning  | deprecated `logging` capability                                     |
| MCP004 | warning  | deprecated `sampling` capability                                    |
| MCP005 | warning  | deprecated `roots` capability                                       |
| MCP006 | critical | auth without RFC 9728 protected-resource metadata                   |
| MCP007 | warning  | still on `@modelcontextprotocol/sdk` (the v1 line)                  |
| MCP008 | warning  | modern server that does not implement `server/discover`             |
| MCP009 | warning  | Python `mcp` constrained to 1.x or importing the v1 `FastMCP` API   |
| MCP101 | info     | dual-era: current **and** still accepts the legacy handshake        |
| MCP102 | info     | session ids issued to legacy clients only                           |

**Backwards compatibility is not a finding.** The revision permits a server to
keep answering the old handshake alongside the new surface, so the `MCP1xx`
rules are reported for information and cost zero points. Only serving the
legacy protocol _alone_ is graded — that is MCP001.

**Eleven rules are not the whole revision** — a server can pass all eleven and still
be broken. The source scan is heuristic and can over-match; the live probe only
sees the outside. This is triage, not a conformance suite. The full list of
limitations is in the
[repository README](https://github.com/AlpayC/mcp-migration-check#honest-limitations).

Fixing what it finds is the part that actually takes a week, and there is an
agent skill for that — see
[the repository](https://github.com/AlpayC/mcp-migration-check#skill).

## Links

- [Live web demo](https://mcp-migration-check.alpaycelik.workers.dev) — paste a URL, nothing to install
- [State of MCP migration — 2026-08-23](https://github.com/AlpayC/mcp-migration-check/blob/main/reports/ecosystem-2026-08-23.md) — 13,380 registry endpoints probed
- [Source](https://github.com/AlpayC/mcp-migration-check)

MIT
