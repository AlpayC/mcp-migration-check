import type { Metadata } from "next";
import Link from "next/link";

import { BlurFade } from "@/components/ui/blur-fade";
import { count, share, SNAPSHOT } from "@/lib/ecosystem-snapshot";
import { ECOSYSTEM_REPORT_SOURCE_URL, REPO_URL } from "@/lib/site";

const S = SNAPSHOT;

/**
 * The ecosystem snapshot, on the site rather than only in the repository.
 *
 * The checker answers "is my server ready". This page answers the question
 * that makes anyone ask the first one — how many servers are not — and it is
 * the half people link to. As a Markdown file under `reports/` it was reachable
 * only by someone already in the repository, which is the wrong way round.
 *
 * Every figure comes from `@/lib/ecosystem-snapshot`, generated from the report
 * JSON. Nothing here is a number typed in by hand: the last time this site kept
 * its own copy of the totals, they drifted from the report within one
 * regeneration and the landing page spent weeks quoting 13,350 of 13,380.
 */
const TITLE = `State of MCP migration · ${S.day}`;
const DESCRIPTION = `${share(S.eras.legacy, S.graded)} of graded MCP servers still answer only the legacy protocol. ${count(S.probed)} public registry endpoints probed on ${S.day}.`;

// `openGraph.title` and `openGraph.description` do not inherit from `title` and
// `description` — Next only inherits the openGraph object wholesale from the
// layout. Left unset, every share of this page would carry the site's generic
// blurb instead of the finding, which is the whole reason to share it.
export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, type: "article" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

function Section({
  title,
  lede,
  children,
}: {
  title: string;
  lede?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-14">
      <h2 className="font-display text-xl font-semibold text-foreground">
        {title}
      </h2>
      {lede ? (
        <p className="mt-2 text-[14.5px] leading-relaxed text-muted">
          {lede}
        </p>
      ) : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Table({
  head,
  children,
}: {
  head: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10 bg-raised">
      <table className="w-full min-w-[440px] border-collapse text-[14px]">
        <thead>
          <tr className="border-b border-white/10">
            <th className="px-4 py-2.5 text-left font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
              {head}
            </th>
            <th className="py-2.5 pr-4 text-right font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
              Endpoints
            </th>
            <th className="py-2.5 pr-4 text-right font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
              Share
            </th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

const TONE_DOT = {
  ok: "bg-ok",
  warn: "bg-warn",
  bad: "bg-bad",
  none: "bg-white/20",
} as const;

function Row({
  label,
  note,
  n,
  of,
  tone = "none",
}: {
  label: string;
  note?: string;
  n: number;
  /** Omitted for a row that is a total rather than a part of one. */
  of?: number;
  tone?: keyof typeof TONE_DOT;
}) {
  return (
    <tr className="border-b border-white/5 last:border-0">
      <td className="px-4 py-2.5 align-top">
        <span className="flex gap-2.5">
          <span
            aria-hidden
            className={`mt-[7px] size-1.5 shrink-0 rounded-full ${TONE_DOT[tone]}`}
          />
          <span>
            <span className="text-foreground">{label}</span>
            {note ? (
              <span className="block text-[12.5px] text-muted">{note}</span>
            ) : null}
          </span>
        </span>
      </td>
      <td className="py-2.5 pr-4 text-right align-top font-mono text-[13px] text-foreground">
        {count(n)}
      </td>
      <td className="py-2.5 pr-4 text-right align-top font-mono text-[13px] text-muted">
        {of === undefined ? "—" : share(n, of)}
      </td>
    </tr>
  );
}

/**
 * The rules a live probe can reach. MCP007, MCP009, MCP010 and MCP011 read a
 * manifest — package.json, Python project metadata, Cargo.toml, go.mod — so
 * they only ever fire on a source scan and would show a misleading zero in
 * this table.
 */
const RULES = [
  {
    id: "MCP001",
    severity: "critical",
    label: "Legacy-only: answers the removed handshake, serves no modern surface",
  },
  {
    id: "MCP002",
    severity: "critical",
    label: "Session id minted for a modern request",
  },
  {
    id: "MCP006",
    severity: "critical",
    label: "Auth without RFC 9728 protected-resource metadata",
  },
  { id: "MCP003", severity: "warning", label: "Deprecated logging capability" },
  { id: "MCP004", severity: "warning", label: "Deprecated sampling capability" },
  { id: "MCP005", severity: "warning", label: "Deprecated roots capability" },
  {
    id: "MCP008",
    severity: "warning",
    label: "Modern server without server/discover",
  },
  {
    id: "MCP101",
    severity: "info",
    label: "Dual-era: current and still backwards compatible",
  },
  {
    id: "MCP102",
    severity: "info",
    label: "Session ids issued to legacy clients only",
  },
] as const;

const SEVERITY_STYLE = {
  critical: "text-bad",
  warning: "text-warn",
  info: "text-muted",
} as const;

export default function StateOfMcp() {
  const repo = S.touchedBySource.repository;
  const registry = S.touchedBySource.registry;

  return (
    <div className="relative isolate min-h-dvh">
      <main className="mx-auto w-full max-w-3xl px-6 pb-28 pt-16 sm:pt-24">
        <BlurFade delay={0.05}>
          <Link
            href="/"
            className="font-mono text-[12px] uppercase tracking-[0.16em] text-muted transition-colors hover:text-accent"
          >
            ← back to the checker
          </Link>
        </BlurFade>

        <BlurFade delay={0.12}>
          <p className="mt-6 font-mono text-[12px] uppercase tracking-[0.16em] text-accent">
            Snapshot · {S.day}
          </p>
          <h1 className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-5xl">
            State of MCP migration
          </h1>
        </BlurFade>

        {/* The finding before the methodology. Everything below is the case for
            this number; someone who reads one line should read this one. */}
        <BlurFade delay={0.18}>
          <div className="mt-8 rounded-2xl border border-bad/25 bg-bad/[0.06] p-6 sm:p-8">
            <p className="font-display text-5xl font-bold tracking-tight text-bad sm:text-6xl">
              {share(S.eras.legacy, S.graded)}
            </p>
            <p className="mt-3 text-[16px] leading-relaxed text-foreground">
              of graded MCP servers still answer only the legacy protocol — the
              handshake the {S.specReleasedAt} revision removed — with no modern
              surface responding at all.
            </p>
            <p className="mt-3 text-[14.5px] leading-relaxed text-muted">
              Narrowed to the {count(S.touchedSinceSpec)} servers touched since
              the revision shipped, the ones that could have migrated and are
              demonstrably still maintained,{" "}
              <span className="font-semibold text-foreground">
                {share(S.legacyAmongTouched, S.touchedSinceSpec)}
              </span>{" "}
              are legacy-only. That is the number worth arguing about.
            </p>
          </div>
        </BlurFade>

        <BlurFade delay={0.22}>
          <p className="mt-8 text-[15px] leading-relaxed text-muted">
            The Model Context Protocol revision dated{" "}
            <span className="text-foreground">{S.specReleasedAt}</span> removed
            protocol-level sessions, formalized OAuth 2.1 and deprecated several
            capabilities. Every entry in the official registry with an HTTP
            endpoint was probed once and graded by the same rule engine the
            checker on this site runs. No sampling and no estimate — the whole
            registry as it stood on {S.day}.
          </p>
        </BlurFade>

        <Section
          title="Sample"
          lede={`${count(S.registryEntries)} registry entries, latest version of each. Most of the registry is stdio servers that run on the user's own machine and cannot be probed over the network at all.`}
        >
          <Table head="Registry">
            <Row
              label="Entries scanned"
              note="latest version of each"
              n={S.registryEntries}
            />
            <Row
              label="Addressable over HTTP"
              note="unique endpoints — the population below"
              n={S.probed}
              of={S.registryEntries}
            />
            <Row
              label="stdio or local only"
              note="not reachable from anywhere, not probed"
              n={S.localOnly}
              of={S.registryEntries}
            />
          </Table>

          <p className="mt-5 text-[14px] leading-relaxed text-muted">
            Of those {count(S.probed)} endpoints, only the graded row is scored.
            An endpoint that answers but exposes neither MCP protocol behaviour
            nor an authentication challenge told us nothing, and counting it as
            clean is how a snapshot like this ends up claiming the opposite of
            the truth.
          </p>

          <div className="mt-4">
            <Table head="Outcome">
              <Row
                label="Graded"
                n={S.outcomes.graded}
                of={S.probed}
                tone="ok"
              />
              <Row
                label="Answered, but showed no MCP behaviour"
                n={S.outcomes.silent}
                of={S.probed}
              />
              <Row
                label="Unreachable"
                n={S.outcomes.unreachable}
                of={S.probed}
              />
              <Row
                label="Blocked by the SSRF guard"
                n={S.outcomes.blocked}
                of={S.probed}
              />
            </Table>
          </div>
        </Section>

        <Section
          title="Which protocol era each server serves"
          lede="Accepting the legacy handshake is a compatibility choice, not a compliance failure: the revision says a server MAY implement both behaviours, and maintained servers do exactly that because v1 clients are still out there. Only the legacy-only row has actually been left behind."
        >
          <Table head="Era">
            <Row
              label="Serves the current revision, no legacy handshake"
              n={S.eras.modern}
              of={S.graded}
              tone="ok"
            />
            <Row
              label="Dual-era: current and backwards compatible"
              n={S.eras.dual}
              of={S.graded}
              tone="ok"
            />
            <Row
              label="Legacy only: no modern surface answered"
              n={S.eras.legacy}
              of={S.graded}
              tone="bad"
            />
            <Row
              label="Answered, but neither era could be confirmed"
              n={S.eras.unknown}
              of={S.graded}
              tone="warn"
            />
          </Table>

          <p className="mt-5 text-[14px] leading-relaxed text-muted">
            {count(S.withCritical)} of the {count(S.graded)} graded endpoints (
            {share(S.withCritical, S.graded)}) carry at least one critical
            finding, counting the OAuth posture rule alongside the era rules.
          </p>
        </Section>

        <Section
          title="Maintained, or just still listed?"
          lede="A dead endpoint that returns 200 is indistinguishable from a maintained one that chose not to migrate — unless you can date it. The registry skews heavily toward servers listed once and never touched again, so a flat percentage charges the whole ecosystem for what is largely a graveyard. Where an entry links a repository, the split below uses that repository's last push; otherwise it falls back to the date the registry entry itself was updated."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-raised p-5">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
                Dated by a repository push
              </p>
              <p className="mt-2 font-display text-3xl font-bold text-bad">
                {share(repo.legacy, repo.total)}
              </p>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">
                legacy-only, of {count(repo.total)} servers whose linked
                repository has been pushed to since {S.specReleasedAt}. Era
                undetermined for {share(repo.unknownEra, repo.total)}.
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-raised p-5">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
                Dated by a registry timestamp
              </p>
              <p className="mt-2 font-display text-3xl font-bold text-warn">
                {share(registry.legacy, registry.total)}
              </p>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">
                legacy-only, of {count(registry.total)} with no repository date
                to rest on. Era undetermined for{" "}
                {share(registry.unknownEra, registry.total)} — a much weaker
                signal.
              </p>
            </div>
          </div>

          {/* No prose here restates a figure in words. "Roughly three in four"
              was true of 74.5% and would quietly stop being true at the next
              probe, which no generator can catch — the sentence still parses. */}
          <p className="mt-5 text-[14px] leading-relaxed text-muted">
            Some of that gap is composition rather than substance: the
            registry-dated group is far harder to classify at all. But the
            stronger signal is also the less flattering one, and it is the half
            to trust — the left-hand figure rests on servers whose maintainers
            demonstrably committed something after the revision shipped.
          </p>
        </Section>

        <Section
          title="What fired"
          lede={`Findings across the ${count(S.graded)} graded endpoints. A live probe only sees the outside, so the four rules that read a manifest — the TypeScript, Python, Rust and Go SDK versions — cannot appear here at all.`}
        >
          <div className="overflow-x-auto rounded-xl border border-white/10 bg-raised">
            <table className="w-full min-w-[520px] border-collapse text-[14px]">
              <tbody>
                {RULES.map((rule) => (
                  <tr
                    key={rule.id}
                    className="border-b border-white/5 last:border-0"
                  >
                    <td className="px-4 py-2.5 font-mono text-[13px] text-accent">
                      {rule.id}
                    </td>
                    <td
                      className={`py-2.5 pr-4 font-mono text-[11.5px] uppercase tracking-[0.1em] ${SEVERITY_STYLE[rule.severity]}`}
                    >
                      {rule.severity}
                    </td>
                    <td className="py-2.5 pr-4 text-[13.5px] text-muted">
                      {rule.label}
                    </td>
                    <td className="py-2.5 pr-4 text-right font-mono text-[13px] text-foreground">
                      {count(S.ruleCounts[rule.id])}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="What this snapshot is not">
          <ul className="flex flex-col gap-3.5 text-[14.5px] leading-relaxed text-muted">
            <li className="flex gap-3">
              <span aria-hidden className="text-accent">
                ·
              </span>
              <span>
                <span className="text-foreground">
                  Not a conformance suite.
                </span>{" "}
                A fixed set of rules covers the breaking changes visible from
                outside. A server can pass every one of them and still be broken.
              </span>
            </li>
            <li className="flex gap-3">
              <span aria-hidden className="text-accent">
                ·
              </span>
              <span>
                <span className="text-foreground">One probe, one moment.</span>{" "}
                Each endpoint was contacted once on {S.day}. A server behind a
                cold start or a transient outage lands in the unreachable row
                rather than in a category it earned.
              </span>
            </li>
            <li className="flex gap-3">
              <span aria-hidden className="text-accent">
                ·
              </span>
              <span>
                <span className="text-foreground">
                  Not every server could be classified.
                </span>{" "}
                {share(S.eras.unknown, S.graded)} of graded endpoints answered
                without revealing which era they serve, often from behind auth.
                They stay in the denominator and are claimed for neither side.
              </span>
            </li>
            <li className="flex gap-3">
              <span aria-hidden className="text-accent">
                ·
              </span>
              <span>
                <span className="text-foreground">
                  An earlier version of this report was wrong.
                </span>{" "}
                It counted every server that accepted the old handshake as
                unmigrated, which charged dual-era servers for doing exactly what
                the revision permits. The{" "}
                <a
                  href={`${REPO_URL}#mcp001-told-servers-to-break-their-own-users`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent underline-offset-4 hover:underline"
                >
                  postmortem is in the repository
                </a>
                .
              </span>
            </li>
          </ul>
        </Section>

        {/* ---------- the point of the page ---------- */}
        <section className="mt-16 rounded-2xl border border-accent/25 bg-accent/[0.06] p-6 sm:p-8">
          <h2 className="font-display text-xl font-semibold text-foreground">
            And your server?
          </h2>
          <p className="mt-2 text-[14.5px] leading-relaxed text-muted">
            The rule engine behind every number on this page runs against one
            endpoint in about a second, or over a source tree without leaving
            your machine. Nothing is stored either way.
          </p>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href="/"
              className="inline-flex items-center justify-center rounded-lg border border-accent/40 bg-accent/[0.14] px-4 py-2.5 text-[14px] font-medium text-foreground transition-colors hover:border-accent/70"
            >
              Check an endpoint →
            </Link>
            <code className="overflow-x-auto rounded-lg border border-white/10 bg-input px-3.5 py-2.5 font-mono text-[12.5px] text-muted">
              npx mcp-migration-check --source .
            </code>
          </div>
        </section>

        <footer className="mt-16 flex flex-col gap-3 border-t border-white/10 pt-6 text-[13px] text-muted">
          <span>
            Probed {S.startedAt.slice(0, 10)} · rules last verified against the
            spec on <span className="font-mono">{S.rulesVerifiedAt}</span>. A
            citation can stop being true without this page changing, so the date
            is stated rather than implied.
          </span>
          <nav className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <a
              href={ECOSYSTEM_REPORT_SOURCE_URL}
              target="_blank"
              rel="noreferrer"
              className="text-accent underline-offset-4 hover:underline"
            >
              Full report, with method →
            </a>
            <Link href="/" className="hover:text-foreground">
              The checker
            </Link>
            <Link href="/legal" className="hover:text-foreground">
              Legal &amp; privacy
            </Link>
          </nav>
        </footer>
      </main>
    </div>
  );
}
