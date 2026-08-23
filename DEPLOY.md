# Deploying the demo to Cloudflare Workers

The demo runs on the Cloudflare free plan. Everything below fits inside it.

## Version constraints

`@opennextjs/cloudflare` dropped Next.js 14 support in Q1 2026. This app runs
**Next 16 + React 19.2**, which satisfies the adapter's peer range
(`next >=15.5.18 <16 || >=16.2.6`, `wrangler ^4.86.0`).

### What the 14 → 16 jump actually required

Only one thing, but it was a hard blocker: **Next 16 builds with Turbopack by
default and fails the build outright if it finds a custom `webpack` block.**
This app had one — an `extensionAlias` mapping `.js` specifiers onto `.ts`
sources in `packages/core`.

Rather than opting out with `next build --webpack`, the cause was removed:
`tsconfig.base.json` moved from `NodeNext` to `Bundler` resolution, the relative
imports in `packages/core` lost their `.js` suffixes, and the webpack block went
away. Turbopack now resolves them natively, and the esbuild config that builds
the skill script got simpler too.

Nothing else applied. The app uses none of the request APIs that became async
and are now strictly enforced (`headers`, `cookies`, `params`, `searchParams`),
has no middleware to rename to `proxy`, no `next/image` usage, and the route
handler was already `force-dynamic`.

Node 20.9+ and TypeScript 5.1+ are now the minimums.

## Local development

```bash
npm install               # from the repo root, not from web/
npm run dev -w web        # http://localhost:3000
npm run build -w web      # production build, no Cloudflare involved
```

## Deploy

**Deploys run in CI.** A push to `main` touching `web/`, `packages/core/` or the
lockfile runs `.github/workflows/deploy.yml`: typecheck, tests, upload, then a
smoke test. There is nothing to do by hand.

The smoke test is the part worth keeping. It polls the page until it returns
200, then posts `http://169.254.169.254/` to `/api/check` and fails the run
unless the response is `inconclusive`. A successful upload does not prove the
SSRF guard survived the deploy; this does.

Two repository secrets make it work:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens → *Edit Cloudflare Workers*, scoped to this account only |
| `CLOUDFLARE_ACCOUNT_ID` | the account id from `wrangler whoami` |

Without them the workflow reports a skip rather than a failure, so the repo does
not look broken before the secrets exist.

### Deploying by hand

Still works, and is the fallback when CI is unavailable:

```bash
npm run deploy -w web
```

That runs `opennextjs-cloudflare build` (which invokes `next build`) and then
uploads the Worker. The first run asks you to authenticate with Wrangler.

One Windows trap: `next dev` holds a handle on `web/.open-next`, so a deploy
started while a dev server is running dies with `EBUSY: resource busy or
locked`. Stop the dev server first.

`npm run preview -w web` runs the app locally in workerd instead of Node, which
catches runtime differences `next dev` cannot.

## Releases

Tagging is the whole procedure:

```bash
git tag v0.3.0 && git push --tags
```

`.github/workflows/release.yml` then typechecks, tests, packs the skill,
verifies the archive is a real zip with `SKILL.md` under a single top-level
folder and no backslash entry names, and attaches it to the release. It runs on
Ubuntu so packing takes the `zip` path rather than the bsdtar one.

`workflow_dispatch` rebuilds the artifact for an existing tag, which is how the
workflow itself was tested.

### Publishing to npm

The same tag push also fires `.github/workflows/publish-npm.yml`, which
publishes `packages/cli` as **`mcp-migration-check`**.

**There is no npm token in this repository, and there should not be one.** The
workflow authenticates by
[trusted publishing](https://docs.npmjs.com/trusted-publishers): it exchanges
the run's OIDC identity for a short-lived credential, against a publisher
configured once on the package itself. The alternative aged badly — npm revoked
classic tokens in December 2025, caps granular write tokens at 90 days, and is
removing the publish rights of the 2FA-bypass tokens that CI needs. A secret
that expires quarterly breaks the release on a day nobody is expecting it.

That leaves one chicken-and-egg problem: a trusted publisher is configured in a
package's settings, and until the first publish there is no package. So the
first version goes out by hand, once:

```bash
npm login
npm ci && npm run build:cli
cd packages/cli && npm publish --no-provenance
```

`--no-provenance` because `publishConfig.provenance` is set and npm can only
generate an attestation from a recognised CI runner; without the flag a local
publish aborts on exactly that. Every later release comes from the workflow and
is attested normally.

Then, on npmjs.com → the package → Settings → Trusted Publisher: owner `AlpayC`,
repository `mcp-migration-check`, workflow `publish-npm.yml`. After that the tag
push is the whole procedure again.

Three more things worth knowing:

- **The version comes from the tag**, not from `packages/cli/package.json`. The
  workflow runs `npm version --no-git-tag-version` with the tag minus its `v`,
  so `v0.3.0` publishes `0.3.0`. The committed version is only a placeholder.
- **The workflow upgrades npm before publishing.** Trusted publishing needs npm
  11.5.1 or later and Node 22 still bundles npm 10; the failure without it is
  `ENEEDAUTH`, which reads like a missing token and sends you hunting in the
  wrong place entirely.
- **`packages/cli` is deliberately not a workspace.** It has no dependencies
  and nothing in the repository imports it; making it one would only add a
  `node_modules` symlink and a chance for `npm ci` to trip over a generated
  `bin/` that has not been built yet.

`workflow_dispatch` with `dry-run: true` runs everything up to the publish —
including packing the tarball and executing the packed binary — without
touching the registry. Do that first.

### The Action's `v1` tag

`action.yml` is consumed as `AlpayC/mcp-migration-check@v1`, and that tag is a
moving pointer rather than a release:

```bash
git tag -f v1 v0.3.0 && git push -f origin v1
```

Move it only to a commit whose CI is green — the `action` job exists precisely
because a composite action's shell only ever runs on a runner, so nothing else
catches a typo in it. Consumers pinned to `@v1` get the new commit immediately.

This is why both tag-triggered workflows filter on `v[0-9]+.[0-9]+.[0-9]+`
rather than `v*`. A moving `v1` matches `v*` too, and every move of it would
otherwise cut a GitHub release and try to publish a version called "1" to npm.

## Rate limiting

`/api/check` fetches a URL a stranger supplies, so it needs a brake. There are
two ways to do that on Cloudflare, and only one of them applies here.

**A WAF rate limiting rule does not work for this deployment.** WAF rules are
scoped to a *zone* — a domain in your Cloudflare account. This Worker is served
from `*.workers.dev`, which is not a zone you control, so there is nothing to
attach a rule to. That only becomes an option after putting the Worker on a
custom domain.

**The Workers rate limiting binding does work**, needs no zone, and is available
on the free plan at no extra charge. It is declared in `wrangler.jsonc`:

```jsonc
"ratelimits": [
  { "name": "CHECK_RATE_LIMITER", "namespace_id": "1001",
    "simple": { "limit": 20, "period": 60 } }
]
```

and consumed in `web/app/api/check/route.ts` before the body is even parsed,
keyed by `cf-connecting-ip` — a header Cloudflare's edge sets and a client
cannot forge. Over the limit returns `429` with `retry-after: 60`.

Note what this is not. Counting happens **per Cloudflare location** and is
eventually consistent, so a geographically spread caller gets more than 20/min
in total, and the boundary is approximate — a live test let 21 requests through
before the first `429`. Cloudflare describes the binding as "permissive,
eventually consistent, and intentionally designed to not be used as an accurate
accounting system". It is a brake against casual abuse, not a quota.

Requires Wrangler 4.36.0 or later; `period` accepts only `10` or `60`.

Application code deliberately holds no counter of its own. An in-process counter
is worthless on Workers: every isolate keeps its own copy and cold ones start at
zero, so it looks like protection while providing none.

## Why the compatibility flags matter

`wrangler.jsonc` sets two:

- `nodejs_compat` — Next.js needs the Node APIs. Required by the adapter.
- `global_fetch_strictly_public` — forces outbound `fetch()` onto the public
  internet rather than letting it resolve back into this zone. Since this app's
  entire purpose is fetching a URL a stranger typed in, that flag is a real
  second line of defence behind the SSRF guard in `packages/core/src/ssrf.ts`.

## What is *not* covered

- **DNS rebinding.** The SSRF guard inspects the hostname, so a name that
  resolves to a private address passes it. On Workers this matters far less than
  on a VPS — the runtime has no private network and no metadata endpoint to
  reach — but it is not nothing.
- **Redirects.** `probeEndpoint` follows them, and only the initial URL is
  validated. Same reasoning as above: on Workers the blast radius is other
  people's public servers, not your credentials. Worth tightening if this ever
  runs somewhere with a private network.

## About the `npm audit` output

`npm audit --omit=dev` reports three high-severity advisories. Both come in
transitively through `next`, and neither is reachable in this app. Checked on
Next 16.2.12:

**postcss (`GHSA-qx2v-qp2m-jg93`, `GHSA-6g55-p6wh-862q`, `GHSA-r28c-9q8g-f849`)**
— XSS on stringify, and arbitrary file read / path traversal via
`sourceMappingURL` in CSS comments. All three require attacker-controlled CSS to
pass through postcss. This app has exactly one stylesheet, `web/app/globals.css`,
written by us and compiled at build time. There is no path by which a visitor
supplies CSS. The affected copy is `next/node_modules/postcss`, which Next
bundles for its own pipeline.

**sharp (`GHSA-f88m-g3jw-g9cj`)** — inherited libvips CVEs. sharp is Next's
image optimizer. This app uses `next/image` nowhere and declares no `images`
binding in `wrangler.jsonc`, so the code never runs.

**Do not run `npm audit fix --force`.** Its proposed remedy is `next@14.2.35` —
a downgrade to the version this project deliberately migrated away from, which
also reintroduces the `ERESOLVE` conflict with `@opennextjs/cloudflare`. The
advisory range is `next 9.3.4-canary.0 - 16.3.0-preview.7`, i.e. every Next
release in existence; the fix has to come from upstream bumping its bundled
postcss. Recheck after a Next upgrade rather than trying to patch around it.

## Budget

Free plan gives 100,000 requests/day and 10ms CPU per request. The probe is
I/O-bound, and subrequest wait time does not count against CPU. The one place
that could have burned the budget — reading an unbounded response body — is
capped at 256 KB in `probeEndpoint`.
