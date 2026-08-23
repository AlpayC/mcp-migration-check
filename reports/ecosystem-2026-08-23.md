# State of MCP migration — 2026-08-23

The MCP revision dated **2026-07-28** removed protocol-level sessions, formalized OAuth 2.1 and deprecated several capabilities. This is a snapshot of how many public servers have followed it.

**60.1% of the 10890 graded endpoints serve the legacy protocol only** — they answer the removed `initialize` handshake and no modern surface responded. A further 5.5% are dual-era: they serve 2026-07-28 *and* keep answering the old handshake, which the revision explicitly permits and this report does not count against them.

**Narrowed to servers that could have migrated** — the 6191 whose repository or registry entry has been touched since 2026-07-28 — 63.8% are still legacy-only. That is the number worth arguing about. The rest of the sample has not been edited since the revision shipped, so it is not evidence of anyone declining to move.

Those two words, "or registry entry", carry a lot. Split by which date the row rests on: of the 4325 dated by a repository push, 74.5% are legacy-only; of the 1866 resting on a registry timestamp, 39.0% are. Some of that gap is composition rather than substance — the registry-dated group has 48.9% whose era could not be determined at all, against 18.6% among the repository-dated — but the stronger signal is also the less flattering one, and it is the half to trust.

## Sample

| | Count |
| --- | --- |
| Registry entries scanned (latest version each) | 24365 |
| …addressable over HTTP (unique endpoints) | 13380 |
| …stdio/local only, not probeable | 10984 |

Of the endpoints probed:

| Outcome | Endpoints | Share |
| --- | --- | --- |
| graded | 10890 | 81.4% |
| answered, but showed no MCP behaviour | 1597 | 11.9% |
| unreachable | 892 | 6.7% |
| blocked by the SSRF guard | 1 | 0.0% |

Only the graded row is scored below. An endpoint that answers but exposes neither MCP protocol behaviour nor an authentication challenge told us nothing, and counting it as clean is how a snapshot like this ends up claiming the opposite of the truth.

## Which protocol era each server serves

This is the split that matters, and the reason an earlier version of this report overstated the problem. Accepting the legacy handshake is a compatibility choice, not a compliance failure: the revision says a server that wants to serve both kinds of client **MAY** implement both behaviours, and plenty of maintained servers do exactly that because v1 clients are still out there. Only the third row has actually been left behind.

| Era | Servers | Share |
| --- | --- | --- |
| serves 2026-07-28, no legacy handshake | 96 | 0.9% |
| dual-era: current **and** backwards compatible | 594 | 5.5% |
| legacy only: no modern surface answered | 6541 | 60.1% |
| answered, but neither era could be confirmed | 3659 | 33.6% |

For reference: 7230 of 10890 graded endpoints (66.4%) carry at least one critical finding, counting the OAuth posture rule alongside the era rules.

## Maintained, or just still listed?

A dead endpoint that returns 200 is indistinguishable from a maintained one that chose not to migrate — unless you can date it. The registry skews heavily toward servers listed once and never touched again, so an aggregate percentage charges the whole ecosystem for what is largely a graveyard. Where a registry entry links a GitHub repository, the table below uses that repository's last push; otherwise it falls back to the date the registry entry itself was last updated. The line is the day the revision shipped, 2026-07-28, rather than a rolling window: a 180-day window was the first attempt and it separated nothing, because 98.6% of the rows carrying a real commit date fell inside it. Both the registry and this revision are too young for that question to mean anything.

| | modern | dual | legacy | unknown | All |
| --- | --- | --- | --- | --- | --- |
| last activity on or after 2026-07-28 | 56 | 467 | 3950 | 1718 | 6191 |
| last activity before 2026-07-28 | 29 | 76 | 2015 | 1489 | 3609 |
| repository archived, disabled or gone | 11 | 51 | 576 | 452 | 1090 |
| no date could be obtained | 0 | 0 | 0 | 0 | 0 |

Dates came from a repository for 5808 of the graded endpoints (53.3%), from the registry entry for 5082, and could not be had at all for 0.

6869 graded endpoints link a repository, so that is the ceiling on the stronger signal. 1061 of them are counted on the registry timestamp anyway, because GitHub had no answer for them: the repository is private, renamed, deleted, or not hosted there.

The two dates are not the same claim. A repository push is evidence about the code; a registry `updatedAt` only says when someone last published an entry, which for a server listed once and forgotten is its original publication date. Rows resting on the weaker signal are counted, but the split above is how you can tell how much of the table they hold up.

## Grades

| Grade | Servers | Share |
| --- | --- | --- |
| A | 3572 | 32.8% |
| B | 88 | 0.8% |
| C | 6692 | 61.5% |
| D | 442 | 4.1% |
| F | 96 | 0.9% |

## What is firing

| Rule | Severity | Signal | Servers | Share |
| --- | --- | --- | --- | --- |
| [MCP001](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning) | critical | Legacy-only: the current revision is not served | 6541 | 60.1% |
| [MCP002](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http) | critical | Session state on the modern surface | 310 | 2.8% |
| [MCP003](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/logging) | warning | Deprecated logging capability | 408 | 3.7% |
| [MCP004](https://modelcontextprotocol.io/specification/2026-07-28/client/sampling) | warning | Deprecated sampling capability | 4 | 0.0% |
| [MCP005](https://modelcontextprotocol.io/specification/2026-07-28/client/roots) | warning | Deprecated roots capability | 2 | 0.0% |
| [MCP006](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) | critical | Missing OAuth 2.1 resource-server posture | 677 | 6.2% |
| [MCP007](https://blog.modelcontextprotocol.io/posts/sdk-betas-2026-07-28/) | warning | TypeScript SDK still on the v1 line | 0 | 0.0% |
| [MCP008](https://modelcontextprotocol.io/specification/2026-07-28/server/discover) | warning | `server/discover` not implemented | 17 | 0.2% |
| [MCP101](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning) | info | Dual-era: still accepts the legacy handshake | 594 | 5.5% |
| [MCP102](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http) | info | Session ids issued to legacy clients only | 74 | 0.7% |

## Method, and what this does not say

Each endpoint got one live probe from [mcp-migration-check](https://github.com/AlpayC/mcp-migration-check). The probe opens as a **modern** client — `server/discover` carrying `io.modelcontextprotocol/protocolVersion` in `_meta` and the required `MCP-Protocol-Version` header — falls back to a modern `tools/list` if that is inconclusive, and only then sends a legacy `initialize` to see whether the old door is still open. Plus a best-effort look for OAuth protected-resource metadata. Nothing destructive, no authentication attempted, 8000 ms timeout, 6 at a time.

- **The registry is not the ecosystem.** It lists servers that registered, and only the ones publishing a remote endpoint appear above at all.
- **Dating uses a labelled fallback.** Where a GitHub repository date is available, the report uses its last push. Otherwise it falls back to the registry entry's `updatedAt`; only a row with neither source is undated. The source split above shows how much of the report rests on each signal.
- **A push is not a release.** A repository touched last week may have had a typo fixed in its README; one untouched for a year may be finished software that works. The date separates *abandoned* from *maintained*, which is a coarser question than *cared for*.
- **A live probe sees every rule but one.** MCP007 reads a `package.json`, which a probe does not have.
- **These rules are not the whole revision.** A server can pass every rule here and still be broken — `resultType`, `subscriptions/listen`, the removal of `ping` and `logging/setLevel`, and the required `Mcp-Method` / `Mcp-Name` headers are not covered.
- **Legacy-only is a claim about what answered, not about what exists.** MCP001 fires when the legacy handshake answers and *no* modern signal did. A server that fails the modern probe for an unrelated reason — a WAF eating an unfamiliar method, a gateway that only routes known paths — lands in that row wrongly. The dual-era row cannot be wrong in the same direction: it needs a positive modern answer.
- **`initialize` support is never counted as drift.** An earlier revision of this report did count it, which inflated the headline: it graded current servers as broken for staying compatible with clients still in the field. MCP101 records that compatibility as an observation worth zero points.
- **Authentication is evidence, not proof of MCP behaviour.** A registered endpoint that returns `401` or `WWW-Authenticate` is graded so its OAuth posture can be inspected, but an unauthenticated probe sees little else. A generic protected endpoint can look the same from the outside.

Rules last verified against the spec: 2026-08-01. Probed 2026-08-23T15:00:15.869Z.
