# Security policy

This project makes outbound HTTP requests to addresses supplied by whoever is
using it, and the hosted demo does so on a public endpoint. That makes the
guard around those requests the part worth reporting on.

## Reporting

Email **hello@alpaycelik.dev**. Please do not open a public issue for anything
in the in-scope list below.

Expect an acknowledgement within a few days. This is a personal project, not a
staffed product — there is no bounty, and the honest commitment is that a real
report gets fixed and credited rather than fixed within a stated SLA.

## In scope

- **Bypassing the SSRF guard.** Anything that makes
  `https://mcp-migration-check.alpaycelik.workers.dev/api/check` reach a
  loopback address, a private or reserved range, or a cloud metadata endpoint.
  The guard is `packages/core/src/ssrf.ts`; DNS rebinding and redirect chains
  are known gaps, documented in [DEPLOY.md](./DEPLOY.md), and a working
  demonstration is still worth sending.
- **Using the service to reach a third party in a way it does not intend.**
  The OAuth metadata discovery follows a URL the probed server advertises; it is
  restricted to the same origin precisely so a hostile endpoint cannot redirect
  the checker elsewhere. A way around that restriction is a finding.
- **Bypassing the rate limit** in a way that goes beyond its documented
  per-location, eventually-consistent behaviour.
- **Anything in the skill** that causes an agent to run code from a scanned
  repository, or to leak the contents of one.

## Not in scope

- **That the service fetches a public URL you typed.** That is the product. It
  is stated on the page and in the privacy notice.
- **Rate limiting being approximate.** Counting is per Cloudflare location and
  eventually consistent by design; the ceiling is higher than 20/min for a
  distributed caller. Documented in DEPLOY.md.
- **A rule being wrong.** That is a correctness bug and belongs in a public
  issue — see [CONTRIBUTING.md](./CONTRIBUTING.md). Please do report it.
- **Missing headers or a low score on a scanner** without a demonstrated impact.

## What runs where

The demo is a Cloudflare Worker. It stores nothing: no database, no cache, no
logs of its own. The only persistent state anywhere in the deployment is
Cloudflare's own infrastructure logging, which is outside this project's
control. See the [privacy notice](https://mcp-migration-check.alpaycelik.workers.dev/legal).
