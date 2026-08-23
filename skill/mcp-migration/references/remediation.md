# Remediation by rule

Jump to the rules your scan reported. Each section describes what the checker
saw, how to tell a real hazard from noise, and the shape of the fix.

- [MCP001 — Legacy-only: the current revision is not served](#mcp001--legacy-only-the-current-revision-is-not-served)
- [MCP002 — Session state on the modern surface](#mcp002--session-state-on-the-modern-surface)
- [MCP003 — Deprecated logging capability](#mcp003--deprecated-logging-capability)
- [MCP004 — Deprecated sampling capability](#mcp004--deprecated-sampling-capability)
- [MCP005 — Deprecated roots capability](#mcp005--deprecated-roots-capability)
- [MCP006 — Missing OAuth 2.1 resource-server posture](#mcp006--missing-oauth-21-resource-server-posture)
- [MCP007 — TypeScript SDK still on the v1 line](#mcp007--typescript-sdk-still-on-the-v1-line)
- [MCP008 — `server/discover` not implemented](#mcp008--serverdiscover-not-implemented)
- [MCP101 / MCP102 — compatibility observations](#mcp101--mcp102--compatibility-observations)

Verify exact signatures and header names against the
[canonical spec](https://modelcontextprotocol.io/specification/2026-07-28) and
its [changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog).
This file describes the shape of each change; the spec is the authority on its
details.

**These rules are not the whole revision.** `server/discover` is now
mandatory, every result needs a `resultType`, the GET stream and
`resources/subscribe` give way to `subscriptions/listen`, `ping` and
`logging/setLevel` are removed, SSE resumability is gone, and the `Mcp-Method` /
`Mcp-Name` request headers are required. None of that is checked here. Work
through the changelog before you call a migration complete.

---

## MCP001 — Legacy-only: the current revision is not served

**Severity:** critical

**What triggered it.** Live: the endpoint answered a legacy `initialize`
request **and** nothing modern answered — `server/discover` returned no result
and a request carrying per-request `_meta` was not served as one. Source: the
code implements the `initialize` lifecycle and contains no handling of the
modern `_meta` envelope, no `server/discover`, and no dependency on the v2 SDK
packages.

**What does *not* trigger it: still answering `initialize`.** This is the
important half. The revision explicitly allows a server to serve both eras:

> A server that wishes to support both legacy clients (which expect an
> `initialize` handshake) and modern clients (which use per-request metadata)
> **MAY** implement both behaviors.
> — [Versioning: Backward Compatibility](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning)

A dual-era server picks its semantics from how each request opens: modern
`_meta` is served statelessly, an `initialize` request selects legacy
semantics. Keeping the old door open for clients still in the field is a
deliberate, supported choice. It is reported as MCP101 — an observation worth
zero points — not as a defect.

**Telling real from noise.** The source signal is weak on its own — the word
turns up in comments, in unrelated init functions, and in any code that *talks
to* an MCP server rather than implementing one. Look at whether the file
registers a request handler for the `initialize` method. If it does not, this
is noise.

The live signal proves an absence, which is the weaker claim: a modern surface
sitting behind a WAF, a path-based gateway, or a filter that rejects unfamiliar
methods will look missing when it is not. Reproduce by hand before acting:

```bash
curl -sS https://your-server/mcp   -H 'content-type: application/json'   -H 'accept: application/json, text/event-stream'   -H 'MCP-Protocol-Version: 2026-07-28'   -H 'Mcp-Method: server/discover'   -d '{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{"_meta":{
        "io.modelcontextprotocol/protocolVersion":"2026-07-28",
        "io.modelcontextprotocol/clientInfo":{"name":"curl","version":"1"},
        "io.modelcontextprotocol/clientCapabilities":{}}}}'
```

A `DiscoverResult` back means the finding is a false positive.

**The fix — add the modern path, do not remove the legacy one.** Deleting the
handshake buys no compliance and breaks every v1 client still pointed at the
server. What has to exist alongside it:

- Requests carrying `io.modelcontextprotocol/protocolVersion` in `_meta` served
  statelessly, with `MCP-Protocol-Version` / `Mcp-Method` header validation.
- `server/discover`, returning `supportedVersions`, `capabilities` and
  `_meta['io.modelcontextprotocol/serverInfo']`.
- `resultType` on every result.

Anything that used to happen once per session at handshake time now has to
happen, on the modern path, either at process start (if it is genuinely global,
like loading config) or per request (if it depends on who is asking).

The question worth asking for each piece of handshake logic: *does this depend
on the caller?* Global setup moves to module scope. Caller-dependent setup moves
into the request path and must be cheap enough to run every time — if it is not,
that is a caching problem with an explicit key, not a reason to keep a session.

**Retiring the legacy path is a product decision, not a spec deadline.** Decide
it on the clients you actually serve; the revision sets no date.

**Watch for.** Capability negotiation that used to happen during the handshake.
On the modern path the server no longer negotiates — clients declare
capabilities per request in `_meta`, so a branch that switched behaviour on what
the client advertised at handshake time needs to read them from there, or be
made explicit in the tool input.

---

## MCP002 — Session state on the modern surface

**Severity:** critical

**What triggered it.** Live: the server sent an `Mcp-Session-Id` response
header **in reply to a modern, `_meta`-carrying request**. The revision is
explicit that a server serving it must "ignore it, and do not mint or echo
session IDs". A session id issued by the *legacy* handshake is how the legacy
revision works and is reported as MCP102, not here. Source: the code mentions
`Mcp-Session-Id`, `mcpSessionId`, or a bare `sessionId`, and shows no modern
per-request handling beside it.

**Telling real from noise.** A bare `sessionId` match is often an unrelated
web-session variable. What matters is whether **server state is keyed by
something derived from the connection**. Grep more widely than the checker does:
look for module-level `Map`, `Set`, `Record`, or object literals that are
written to inside a request handler. Those are the real hazard, whatever the key
is called.

**The fix.** This is the deepest change, and it is a design question rather than
a mechanical edit. For each piece of retained state, pick one:

- **Delete it.** A surprising amount of session state is a cache that was never
  measured. If recomputing is cheap, recompute.
- **Push it to the client.** If the state is really *the caller's* state, it can
  travel in the tool input. This makes the dependency visible in the schema,
  which is usually an improvement in its own right.
- **Externalise it.** If it must persist server-side, put it in a store both
  instances can reach, keyed by an identifier the caller passes explicitly.

The failure mode to design against: the code works perfectly on one instance and
fails intermittently behind a load balancer, because request two lands somewhere
that never saw request one. That is why "it still works locally" proves nothing
here.

**Watch for.** Progress tokens, in-flight request registries, and anything
tracking cancellation. These are easy to miss because they feel like plumbing
rather than state.

---

## MCP003 — Deprecated logging capability

**Severity:** warning

**What triggered it.** The `logging` capability is advertised or registered.

**The fix.** Remove the capability declaration and its handlers. Diagnostics
still matter — send them somewhere the protocol is not involved in: stderr,
your existing logging pipeline, an OTel exporter.

**Watch for.** A stdio server must not write to stdout, because stdout is the
protocol channel. If log lines move from the MCP logging capability to
`console.log`, the transport breaks in a way that looks like message corruption.
Use `console.error`.

---

## MCP004 — Deprecated sampling capability

**Severity:** warning

**What triggered it.** The code references `sampling` or `createMessage`.

**The fix.** Sampling let the server ask the client to run a model call. That
inversion is gone, so the flow has to be restructured: the server returns what
it knows, and the client decides whether a model call is needed.

Concretely, a tool that used to call back for a summary should instead return
the raw material and describe, in its output or its schema, what the caller
might want to do with it.

**Watch for.** This one is rarely a pure deletion. If a tool's usefulness
depended on the server orchestrating model calls, removing sampling changes what
the tool *is*. Flag that to the human rather than quietly dropping the feature.

---

## MCP005 — Deprecated roots capability

**Severity:** warning

**What triggered it.** The code references `roots`, `ListRootsRequest`, or
`RootsCapability`.

**The fix.** Roots let the server ask the client which directories it may work
in. Replace it by taking the path or scope explicitly as a tool input.

**Watch for.** Roots often doubled as a security boundary. If removing it means
a tool now accepts an arbitrary path, you have widened the blast radius — add
explicit validation against an allowlist rather than relying on the client to
be well-behaved. Do not treat this as a rename.

---

## MCP006 — Missing OAuth 2.1 resource-server posture

**Severity:** critical

**What triggered it.** The endpoint demanded authentication (a `401` or a
`WWW-Authenticate` header) and no metadata document was found. Three locations
are tried, in the order the spec prescribes: the URL the server itself
advertised via `resource_metadata="…"` in its `WWW-Authenticate` challenge; then
the path-suffixed RFC 9728 location (for `https://example.com/mcp` that is
`/.well-known/oauth-protected-resource/mcp`); then the bare origin root. Any one
of them serving a document clears the rule.

Note that the advertised URL is only followed when it is same-origin with the
probed endpoint — otherwise a hostile server could use the checker to fetch a
third party.

**Telling real from noise.** What the probe cannot distinguish is *absent* from
*unreachable*: a fetch that times out or fails at the transport layer is
recorded the same way as a `404`. So on a slow or flaky endpoint this can fire
against a server whose posture is fine. Re-run the check before acting on it,
and if the finding persists, request both paths by hand.

The other blind spot is placement outside RFC 9728 entirely. Metadata behind a
non-standard path — or behind the same auth wall it is meant to describe — is
invisible to an unauthenticated probe. That is a spec-conformance problem in its
own right, but it is a different one from having no posture at all, so read the
server's own docs before rewriting its auth layer.

**The fix.** Serve protected-resource metadata describing the resource
identifier and its authorization server, and validate incoming tokens as an
OAuth 2.1 resource server — signature, issuer, expiry, and audience.

**Watch for.** Audience validation is the one people skip. A token that is valid
but was minted for a different resource must be rejected; accepting it makes the
server a confused deputy. The spec requires servers to validate that a token was
issued specifically for them as the intended audience (RFC 8707).

---

## MCP007 — TypeScript SDK still on the v1 line

**Severity:** warning

**What triggered it.** `package.json` declares a dependency on
`@modelcontextprotocol/sdk`.

**Why the package name is the signal.** `@modelcontextprotocol/sdk` *is* the v1
line. Its last release is `1.30.0` and it speaks the pre-2026-07-28 protocol.
There is no `2.x` of that package and there never will be — v2 shipped under
new names on 2026-07-27.

**There is no single package to move to.** This is the part that trips people
who read "upgrade to v2" and look for one dependency. The v1 package was
monolithic; v2 is split by role, and the new packages were published at `2.0.0`
from their very first prerelease — none of them ever had a 1.x. Pick what the
project actually is:

| Package | Take it when |
|---|---|
| `@modelcontextprotocol/server` | the project implements a server |
| `@modelcontextprotocol/client` | the project consumes servers |
| `@modelcontextprotocol/core` | always — shared schema and protocol types |
| `@modelcontextprotocol/node` | you use the stdio transport |
| `@modelcontextprotocol/express` · `/fastify` · `/hono` | pick the one matching your HTTP layer |
| `@modelcontextprotocol/server-legacy` | you need to keep serving v1-era clients |

A project that is both a server and a client takes both. Do not reach for
`/client` reflexively because the migration guide mentions it — most servers do
not need it, and an unused dependency is a thing somebody has to reason about
later.

**Do not advise `@modelcontextprotocol/sdk@^2`.** It does not resolve. This is a
package *rename*, not a version bump, which is exactly why the finding is worth
reporting explicitly rather than leaving to memory.

**Why do this first.** The v2 API is what you are going to keep. Refactoring the
session and handshake code against v1 and then migrating means doing parts of
the work twice.

**The fix.** Run the official codemod on a clean working tree so you can read
the diff:

```bash
npx @modelcontextprotocol/codemod@latest v1-to-v2 .
```

It rewrites import paths, symbol renames (`McpError` → `ProtocolError`,
`StreamableHTTPError` → `SdkHttpError`), `setRequestHandler(Schema, …)` →
`setRequestHandler('method/string', …)`, `.tool()` → `registerTool`, and
`extra.*` → `ctx.mcpReq.*` / `ctx.http?.*`. Note that v2 requires **Zod 4**
(`zod: ^4.2.0`), so a project on Zod 3 has a second upgrade to do.

**Watch for.** The codemod handles names, not architecture. Expect the type
errors it leaves behind to point straight at the MCP002 work — that is the
signal, not a failure of the tool.

Also watch for transitive pins: if another dependency carries its own copy of
the v1 SDK, both lines end up in the tree and the failure looks like a type
mismatch between things that appear identical. Check the lockfile, not just
`package.json`.

**Non-TypeScript servers.** This rule only reads `package.json`, so it is silent
for other languages — but they moved too, and differently: Python and C# to 2.x
majors, Go to a 1.x minor. Check the actual package rather than assuming the
TypeScript story applies.

---

## MCP008 — `server/discover` not implemented

**Severity:** warning

**What triggered it.** The server served a modern request but answered
`server/discover` with no result. The revision states that servers **MUST**
implement it, and it is the probe clients use to pick a protocol version — and
on stdio, the only way a dual-era client can tell the two eras apart.

**The fix.** Implement the method. It takes no parameters beyond the standard
`_meta` and returns:

```jsonc
{
  "resultType": "complete",
  "supportedVersions": ["2026-07-28"],
  "capabilities": { "tools": {}, "resources": {} },
  "_meta": {
    "io.modelcontextprotocol/serverInfo": { "name": "…", "version": "…" }
  },
  "ttlMs": 3600000,
  "cacheScope": "public"
}
```

List every version you actually serve. A dual-era server names only its modern
versions here — legacy clients never call this method.

---

## MCP101 / MCP102 — compatibility observations

**Severity:** info — worth **zero** points. These are not defects.

**MCP101** fires when a server serves the current revision *and* still answers
the legacy `initialize` handshake. **MCP102** fires when session ids come back
from that handshake but not from a modern request.

Both describe a **dual-era** server, which the revision explicitly permits: it
selects its behaviour from how each request opens, serving `_meta`-carrying
requests statelessly and `initialize` requests under legacy semantics, and
**MAY** serve both eras concurrently on the same endpoint.

**The fix.** None. Keep the legacy path while clients in the wild still send
`initialize`, and retire it on your own schedule — the revision sets no
deadline. Anything that tells you to delete the handshake for compliance is
wrong, and this checker used to be one of those things.

The one thing worth checking: that no modern-path behaviour reads state
established by a legacy session. The two paths must not share mutable
per-session state, or the stateless one inherits the failure mode the revision
removed.
