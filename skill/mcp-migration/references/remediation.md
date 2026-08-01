# Remediation by rule

Jump to the rules your scan reported. Each section describes what the checker
saw, how to tell a real hazard from noise, and the shape of the fix.

- [MCP001 — Legacy initialize handshake](#mcp001--legacy-initialize-handshake)
- [MCP002 — Session-id dependence](#mcp002--session-id-dependence)
- [MCP003 — Deprecated logging capability](#mcp003--deprecated-logging-capability)
- [MCP004 — Deprecated sampling capability](#mcp004--deprecated-sampling-capability)
- [MCP005 — Deprecated roots capability](#mcp005--deprecated-roots-capability)
- [MCP006 — Missing OAuth 2.1 resource-server posture](#mcp006--missing-oauth-21-resource-server-posture)
- [MCP007 — TypeScript SDK still on the v1 line](#mcp007--typescript-sdk-still-on-the-v1-line)

Verify exact signatures and header names against the
[canonical spec](https://modelcontextprotocol.io/specification/2026-07-28) and
its [changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog).
This file describes the shape of each change; the spec is the authority on its
details.

**These seven rules are not the whole revision.** `server/discover` is now
mandatory, every result needs a `resultType`, the GET stream and
`resources/subscribe` give way to `subscriptions/listen`, `ping` and
`logging/setLevel` are removed, SSE resumability is gone, and the `Mcp-Method` /
`Mcp-Name` request headers are required. None of that is checked here. Work
through the changelog before you call a migration complete.

---

## MCP001 — Legacy initialize handshake

**Severity:** critical

**What triggered it.** Live: the endpoint answered a legacy `initialize`
request. Source: the text `initialize` appears somewhere in the code.

**Telling real from noise.** The source signal is weak on its own — the word
turns up in comments, in unrelated init functions, and in any code that *talks
to* an MCP server rather than implementing one. Look at whether the file
registers a request handler for the `initialize` method. If it does not, this is
noise.

The live signal is strong: if the server answered the handshake, it implements
it.

**The fix.** Remove the initialize/initialized lifecycle. Anything that used to
happen once per session at handshake time now has to happen either at process
start (if it is genuinely global, like loading config) or per request (if it
depends on who is asking).

The question worth asking for each piece of handshake logic: *does this depend
on the caller?* Global setup moves to module scope. Caller-dependent setup moves
into the request path and must be cheap enough to run every time — if it is not,
that is a caching problem with an explicit key, not a reason to keep a session.

**Watch for.** Capability negotiation that used to happen during the handshake.
If the server changed its behaviour based on what the client advertised, that
branch has nowhere left to live and the behaviour needs to be decided some other
way — usually by making it explicit in the tool input.

---

## MCP002 — Session-id dependence

**Severity:** critical

**What triggered it.** Live: the server sent an `Mcp-Session-Id` response
header. Source: the code mentions `Mcp-Session-Id`, `mcpSessionId`, or a bare
`sessionId`.

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
new names on 2026-07-27:

| Package | Role |
|---|---|
| `@modelcontextprotocol/server` | server implementation |
| `@modelcontextprotocol/client` | client implementation |
| `@modelcontextprotocol/core` | shared schema and protocol types |
| `@modelcontextprotocol/node` | stdio / Node transports |
| `@modelcontextprotocol/express` · `/fastify` · `/hono` | HTTP adapters |
| `@modelcontextprotocol/server-legacy` | compatibility shim for v1-era servers |

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
