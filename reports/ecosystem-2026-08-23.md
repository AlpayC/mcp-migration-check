# State of MCP migration — 2026-08-23

The MCP revision dated **2026-07-28** removed protocol-level sessions, formalized OAuth 2.1 and deprecated several capabilities. This is a snapshot of how many public servers have followed it.

**75.8% of the 10812 registered endpoints with enough protocol or authentication signal to grade still show at least one critical breaking-change signal.**

## Sample

| | Count |
| --- | --- |
| Registry entries scanned (latest version each) | 24320 |
| …addressable over HTTP (unique endpoints) | 13350 |
| …stdio/local only, not probeable | 10969 |

Of the endpoints probed:

| Outcome | Endpoints | Share |
| --- | --- | --- |
| graded | 10812 | 81.0% |
| answered, but showed no MCP behaviour | 1599 | 12.0% |
| unreachable | 938 | 7.0% |
| blocked by the SSRF guard | 1 | 0.0% |

Only the graded row is scored below. An endpoint that answers but exposes neither MCP protocol behaviour nor an authentication challenge told us nothing, and counting it as clean is how a snapshot like this ends up claiming the opposite of the truth.

## Grades

| Grade | Servers | Share |
| --- | --- | --- |
| A | 2620 | 24.2% |
| B | 0 | 0.0% |
| C | 5907 | 54.6% |
| D | 2114 | 19.6% |
| F | 171 | 1.6% |

## What is firing

| Rule | Severity | Signal | Servers | Share |
| --- | --- | --- | --- | --- |
| [MCP001](https://modelcontextprotocol.io/specification/2026-07-28/changelog) | critical | Legacy initialize handshake | 7583 | 70.1% |
| [MCP002](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http) | critical | Session-id dependence | 2076 | 19.2% |
| [MCP003](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/logging) | warning | Deprecated logging capability | 424 | 3.9% |
| [MCP004](https://modelcontextprotocol.io/specification/2026-07-28/client/sampling) | warning | Deprecated sampling capability | 2 | 0.0% |
| [MCP005](https://modelcontextprotocol.io/specification/2026-07-28/client/roots) | warning | Deprecated roots capability | 0 | 0.0% |
| [MCP006](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) | critical | Missing OAuth 2.1 resource-server posture | 564 | 5.2% |
| [MCP007](https://blog.modelcontextprotocol.io/posts/sdk-betas-2026-07-28/) | warning | TypeScript SDK still on the v1 line | 0 | 0.0% |

## Method, and what this does not say

Each endpoint got one live probe from [mcp-migration-check](https://github.com/AlpayC/mcp-migration-check): a single legacy `initialize` request plus a best-effort look for OAuth protected-resource metadata. Nothing destructive, no authentication attempted, 8000 ms timeout, 6 at a time.

- **The registry is not the ecosystem.** It lists servers that registered, and only the ones publishing a remote endpoint appear above at all.
- **A live probe sees six of the seven rules.** MCP007 reads a `package.json`, which a probe does not have.
- **Seven rules are not the whole revision.** A server can pass every rule here and still be broken — `server/discover`, `resultType`, `subscriptions/listen` and the new required headers are not covered.
- **MCP001 is a direct legacy-handshake count.** It fires whenever an endpoint returns an `initialize` result, because that is the signal it detects. Its share measures legacy-handshake compatibility within the graded sample; it is not an independent conformance test.
- **Authentication is evidence, not proof of MCP behaviour.** A registered endpoint that returns `401` or `WWW-Authenticate` is graded so its OAuth posture can be inspected, but an unauthenticated probe sees little else. A generic protected endpoint can look the same from the outside.

Rules last verified against the spec: 2026-08-01. Probed 2026-08-23T06:49:38.474Z.
