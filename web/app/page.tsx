"use client";

import type { CheckResult, Finding, Severity } from "@mcpcheck/core";
// From the rules subpath, not the package root. The root re-exports scanSource,
// which imports node:fs — harmless for a type-only import because those are
// erased, fatal for a value import in a client component.
import { rulesVerifiedAt } from "@mcpcheck/core/rules";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { AnimatedShinyText } from "@/components/ui/animated-shiny-text";
import { AuroraText } from "@/components/ui/aurora-text";
import { BlurFade } from "@/components/ui/blur-fade";
import { BorderBeam } from "@/components/ui/border-beam";
import { Confetti, type ConfettiRef } from "@/components/ui/confetti";
import { FlickeringGrid } from "@/components/ui/flickering-grid";
import { GlareHover } from "@/components/ui/glare-hover";
import { Marquee } from "@/components/ui/marquee";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Ripple } from "@/components/ui/ripple";
import { RippleButton } from "@/components/ui/ripple-button";
import {
  AUTHOR_URL,
  ECOSYSTEM_REPORT_URL,
  RELEASES_URL,
  REPO_URL,
} from "@/lib/site";
import { cn } from "@/lib/utils";

type Band = "ok" | "warn" | "bad";

function band(letter: string): Band {
  if (letter === "A" || letter === "B") return "ok";
  if (letter === "C") return "warn";
  return "bad";
}

const BAND_STYLES: Record<
  Band,
  { text: string; glow: string; from: string; to: string }
> = {
  ok: {
    text: "text-ok",
    glow: "shadow-[0_0_80px_-20px_var(--color-ok)]",
    from: "#37d399",
    to: "#6d8bff",
  },
  warn: {
    text: "text-warn",
    glow: "shadow-[0_0_80px_-20px_var(--color-warn)]",
    from: "#f5b944",
    to: "#ff8a3d",
  },
  bad: {
    text: "text-bad",
    glow: "shadow-[0_0_80px_-20px_var(--color-bad)]",
    from: "#ff5d5d",
    to: "#b043ff",
  },
};

const SEV_STYLES: Record<Severity, { chip: string; edge: string }> = {
  critical: {
    chip: "bg-bad/15 text-bad ring-1 ring-bad/30",
    edge: "before:bg-bad",
  },
  warning: {
    chip: "bg-warn/15 text-warn ring-1 ring-warn/30",
    edge: "before:bg-warn",
  },
  info: {
    chip: "bg-accent/15 text-accent ring-1 ring-accent/30",
    edge: "before:bg-accent",
  },
};

/**
 * Public endpoints to try with one click.
 *
 * `auth` describes the endpoint's posture, not the expected grade — the grade
 * is whatever the checker actually observes. Keeping the label factual avoids
 * baking a prediction into the UI that a rule change could falsify.
 */
const EXAMPLES: Array<{ label: string; url: string; auth: "open" | "oauth" }> = [
  { label: "DeepWiki", url: "https://mcp.deepwiki.com/mcp", auth: "open" },
  {
    label: "Cloudflare Docs",
    url: "https://docs.mcp.cloudflare.com/mcp",
    auth: "open",
  },
  {
    label: "Microsoft Learn",
    url: "https://learn.microsoft.com/api/mcp",
    auth: "open",
  },
  { label: "Notion", url: "https://mcp.notion.com/mcp", auth: "oauth" },
  { label: "Linear", url: "https://mcp.linear.app/mcp", auth: "oauth" },
  { label: "Sentry", url: "https://mcp.sentry.dev/mcp", auth: "oauth" },
];

/**
 * Languages a source scan reads, each with the rule that checks its SDK
 * manifest. Go source is scanned for the language-neutral signals too, but its
 * SDK moved to a 1.x minor rather than a new major, so no rule covers it yet.
 */
const SOURCE_LANGUAGES = [
  { name: "TypeScript", rule: "MCP007" },
  { name: "Python", rule: "MCP009" },
  { name: "Rust", rule: "MCP010" },
];

/** What the checker looks for — shown as a ticker under the hero. */
const RULES = [
  { id: "MCP001", label: "Legacy-only: no modern surface" },
  { id: "MCP002", label: "Session id on a modern request" },
  { id: "MCP003", label: "Deprecated logging capability" },
  { id: "MCP004", label: "Deprecated sampling capability" },
  { id: "MCP005", label: "Deprecated roots capability" },
  { id: "MCP006", label: "Missing OAuth 2.1 posture" },
  { id: "MCP007", label: "TypeScript SDK on the v1 line" },
  { id: "MCP008", label: "No server/discover" },
  { id: "MCP009", label: "Python SDK on the v1 line" },
  { id: "MCP010", label: "Rust crate on a pre-2026-07-28 line" },
  { id: "MCP101", label: "Dual-era (not a defect)" },
  { id: "MCP102", label: "Legacy-only session ids (not a defect)" },
];

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const confettiRef = useRef<ConfettiRef>(null);

  /** `target` lets the example chips run an endpoint without waiting on state. */
  async function run(target?: string) {
    const value = (target ?? url).trim();
    if (!value || loading) return;
    if (target) setUrl(target);
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: value }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
      } else {
        setResult(data as CheckResult);
      }
    } catch {
      setError("Could not reach the checker.");
    } finally {
      setLoading(false);
    }
  }

  // Celebrate a clean bill of health.
  const isClean = Boolean(
    result && !result.inconclusive && result.findings.length === 0,
  );

  useEffect(() => {
    if (!isClean) return;
    const t = setTimeout(() => {
      confettiRef.current?.fire({
        particleCount: 120,
        spread: 90,
        startVelocity: 40,
        origin: { x: 0.5, y: 0.35 },
        colors: ["#37d399", "#6d8bff", "#ffffff"],
      });
    }, 250);
    return () => clearTimeout(t);
  }, [isClean]);

  return (
    <div className="relative isolate min-h-dvh overflow-hidden">
      {/* ---------- ambient background ---------- */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        {/* Fixed so the grid stays put while the page scrolls — the canvas
            only paints while intersecting, so a scrolling copy would idle. */}
        <div className="fixed inset-0">
          <FlickeringGrid
            squareSize={3}
            gridGap={7}
            flickerChance={0.25}
            maxOpacity={0.22}
            color="rgb(150, 175, 255)"
          />
          {/* Vignette: keeps the centre readable, fades the grid at the edges. */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,var(--color-background)_78%)]" />
        </div>
        <div className="absolute left-1/2 top-[-220px] h-[560px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(109,139,255,0.16),transparent)]" />
        <div className="absolute bottom-[-280px] left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(160,80,255,0.10),transparent)]" />
      </div>

      <Confetti
        ref={confettiRef}
        manualstart
        className="pointer-events-none fixed inset-0 z-50 size-full"
      />

      <main className="mx-auto w-full max-w-3xl px-6 pb-28 pt-20 sm:pt-28">
        {/* ---------- hero ---------- */}
        <BlurFade delay={0.05} className="flex justify-center">
          <div className="relative inline-flex items-center rounded-full border border-white/10 bg-panel px-4 py-1.5">
            <span className="mr-2 flex size-1.5 rounded-full bg-accent shadow-[0_0_10px_var(--color-accent)]" />
            <AnimatedShinyText className="max-w-none font-mono text-xs uppercase tracking-[0.16em]">
              Spec 2026-07-28 · readiness
            </AnimatedShinyText>
          </div>
        </BlurFade>

        <BlurFade delay={0.14}>
          <h1 className="mt-7 text-balance text-center font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
            Will your MCP server{" "}
            <AuroraText
              colors={["#6d8bff", "#b043ff", "#37d399", "#6d8bff"]}
              speed={1.1}
            >
              survive
            </AuroraText>{" "}
            the rewrite?
          </h1>
        </BlurFade>

        <BlurFade delay={0.22}>
          <p className="mx-auto mt-5 max-w-[58ch] text-balance text-center text-[17px] leading-relaxed text-muted">
            The 2026-07-28 revision made MCP stateless, formalized OAuth 2.1, and
            dropped several capabilities — a refactor, not a version bump. Point
            the browser checker at a running endpoint, or use the CLI and GitHub
            Action to scan TypeScript, Python and Rust servers.
          </p>
        </BlurFade>

        <BlurFade delay={0.24} className="flex justify-center">
          <ul className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {SOURCE_LANGUAGES.map((lang) => (
              <li
                key={lang.name}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-raised px-3 py-1 text-[12.5px] text-muted"
              >
                <span className="font-semibold text-foreground">{lang.name}</span>
                <span aria-hidden className="text-white/25">
                  ·
                </span>
                <span className="font-mono text-[11.5px] text-accent">
                  {lang.rule}
                </span>
              </li>
            ))}
          </ul>
        </BlurFade>

        <BlurFade delay={0.26} className="flex justify-center">
          <a
            href={ECOSYSTEM_REPORT_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-5 inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-accent/25 bg-accent/[0.08] px-3.5 py-1.5 text-[12.5px] text-muted transition-colors hover:border-accent/50 hover:text-foreground"
          >
            <span className="font-mono text-accent">2026-08-23 snapshot</span>
            <span aria-hidden>·</span>
            <span className="hidden sm:inline">13,350 endpoints probed</span>
            <span className="sm:hidden">13,350 probed</span>
            <span aria-hidden>→</span>
          </a>
        </BlurFade>

        {/* ---------- console ---------- */}
        <BlurFade delay={0.3}>
          <section className="relative mt-12 overflow-hidden rounded-2xl border border-white/10 bg-panel p-5 sm:p-6">
            <BorderBeam
              size={140}
              duration={7}
              colorFrom="#6d8bff"
              colorTo="#b043ff"
              borderWidth={1.5}
            />
            <BorderBeam
              size={140}
              duration={7}
              delay={3.5}
              colorFrom="#37d399"
              colorTo="#6d8bff"
              borderWidth={1.5}
            />

            <label
              htmlFor="url"
              className="block font-mono text-[11px] uppercase tracking-[0.16em] text-muted"
            >
              MCP endpoint
            </label>

            <div className="mt-3 flex flex-col gap-3 sm:flex-row">
              <input
                id="url"
                type="text"
                inputMode="url"
                placeholder="https://example.com/mcp"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && run()}
                spellCheck={false}
                autoComplete="off"
                className="w-full flex-1 rounded-xl border border-white/10 bg-input px-4 py-3 font-mono text-[15px] text-foreground outline-none transition placeholder:text-muted/50 focus:border-accent/60 focus:ring-4 focus:ring-accent/15"
              />
              <RippleButton
                onClick={() => run()}
                disabled={loading}
                rippleColor="#a8bcff"
                duration="650ms"
                className="h-[50px] shrink-0 rounded-xl border-accent/40 bg-accent/[0.14] px-7 font-display text-[15px] font-semibold text-foreground transition-colors hover:border-accent/70 hover:bg-accent/20 disabled:cursor-progress disabled:opacity-70"
              >
                {loading ? "Checking…" : "Run check"}
              </RippleButton>
            </div>

            {/* one-click public endpoints */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="mr-1 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
                Try
              </span>
              {EXAMPLES.map((ex) => (
                <GlareHover
                  key={ex.url}
                  background="transparent"
                  color="#a8bcff"
                  opacity={0.35}
                  size={200}
                  duration={550}
                  className="rounded-full"
                >
                  <button
                    type="button"
                    onClick={() => run(ex.url)}
                    disabled={loading}
                    title={ex.url}
                    className="flex items-center gap-2 rounded-full border border-white/10 bg-raised px-3 py-1.5 text-[12.5px] text-muted transition-colors hover:border-accent/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "size-1.5 rounded-full",
                        ex.auth === "open" ? "bg-ok/70" : "bg-accent/70",
                      )}
                    />
                    {ex.label}
                  </button>
                </GlareHover>
              ))}
            </div>

            <p className="mt-3 text-[13px] leading-relaxed text-muted">
              Runs server-side against the live endpoint. Internal targets like{" "}
              <code className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[12px]">
                localhost
              </code>{" "}
              and private IPs are refused. Nothing is stored.
            </p>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted/80">
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="size-1.5 rounded-full bg-ok/70" />
                no auth — completes the handshake
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="size-1.5 rounded-full bg-accent/70"
                />
                OAuth-guarded — probed unauthenticated
              </span>
            </p>
          </section>
        </BlurFade>

        {/* ---------- rule ticker ---------- */}
        <BlurFade delay={0.38}>
          <div className="relative mt-8">
            <Marquee
              pauseOnHover
              className="py-0 [--duration:32s] [--gap:0.75rem]"
            >
              {RULES.map((r) => (
                <span
                  key={r.id}
                  className="flex shrink-0 items-center gap-2 rounded-full border border-white/10 bg-raised px-3.5 py-1.5 text-[12px] text-muted transition-colors hover:border-accent/30 hover:text-foreground"
                >
                  <span className="font-mono text-[11px] text-accent">
                    {r.id}
                  </span>
                  {r.label}
                </span>
              ))}
            </Marquee>
            <div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-background to-transparent" />
            <div className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-background to-transparent" />
          </div>
        </BlurFade>

        {/* ---------- loading ---------- */}
        {loading && (
          <div className="relative mt-10 flex h-56 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-panel">
            <Ripple mainCircleSize={120} numCircles={6} />
            <div className="relative z-10 text-center">
              <div className="font-display text-lg font-semibold">
                Probing endpoint
              </div>
              <div className="mt-1 font-mono text-xs text-muted">
                handshake · capabilities · oauth metadata
              </div>
            </div>
          </div>
        )}

        {/* ---------- error ---------- */}
        {error && !loading && (
          <BlurFade key={error}>
            <div className="mt-10 rounded-2xl border border-white/10 border-l-2 border-l-warn bg-panel p-5">
              <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
                Could not check
              </div>
              <p className="mt-1.5 text-[15px]">{error}</p>
            </div>
          </BlurFade>
        )}

        {/* ---------- result ---------- */}
        {result && !loading && (
          <section className="mt-10">
            {result.inconclusive ? (
              <BlurFade>
                <div className="rounded-2xl border border-white/10 border-l-2 border-l-warn bg-panel p-5">
                  <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
                    Inconclusive
                  </div>
                  <p className="mt-1.5 text-[15px]">{result.note}</p>
                </div>
              </BlurFade>
            ) : (
              <>
                <ReportHead result={result} />

                {result.findings.length === 0 ? (
                  <BlurFade delay={0.12}>
                    <div className="mt-4 rounded-2xl border border-ok/25 bg-[color-mix(in_srgb,var(--color-ok)_7%,var(--color-panel))] p-6 text-[15px]">
                      <b className="font-display text-ok">Nothing fired.</b>{" "}
                      None of the live-probe signals were observed. That is not
                      a clean bill of health for the whole revision: MCP007
                      needs a <code>package.json</code>, MCP009 needs Python
                      project metadata or source, MCP010 needs a{" "}
                      <code>Cargo.toml</code>, and complete validation of the
                      required <code>resultType</code> field,{" "}
                      <code>subscriptions/listen</code> and the new request
                      headers are all outside what an outside-in probe can see.
                    </div>
                  </BlurFade>
                ) : (
                  <div className="mt-4 flex flex-col gap-3">
                    {result.findings.map((f: Finding, i: number) => (
                      <BlurFade key={f.ruleId} delay={0.1 + i * 0.07}>
                        <FindingCard finding={f} />
                      </BlurFade>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {/* ---------- distribution ---------- */}
        <BlurFade delay={0.1} inView>
          <section className="relative mt-20 overflow-hidden rounded-2xl border border-white/10 bg-panel p-6 sm:p-7">
            <BorderBeam
              size={140}
              duration={9}
              colorFrom="#37d399"
              colorTo="#6d8bff"
              borderWidth={1.5}
            />

            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
              One engine · four ways to use it
            </span>
            <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight">
              Check once, gate every PR, then{" "}
              <span className="text-warn">fix what fired</span>.
            </h2>
            <p className="mt-3 max-w-[62ch] text-[14.5px] leading-relaxed text-muted">
              The browser is the fastest outside-in check. The same deterministic
              engine ships as a zero-install CLI, a GitHub Action, and an agent
              skill. Their source checks scan TypeScript, Python and Rust
              repositories; the skill also works through each remediation.
            </p>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-raised p-4">
                <div className="font-display text-[15px] font-semibold">
                  Run once from the terminal
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-muted">
                  No install and no runtime dependencies. Probe a URL or scan a
                  TypeScript, Python or Rust repository, including SDK
                  constraints.
                </p>
                <pre className="mt-3 overflow-x-auto rounded-lg border border-white/10 bg-input p-3 font-mono text-[12px] leading-relaxed text-foreground">
                  <code>{`npx mcp-migration-check <url>
npx mcp-migration-check --source .`}</code>
                </pre>
              </div>

              <div className="rounded-xl border border-white/10 bg-raised p-4">
                <div className="font-display text-[15px] font-semibold">
                  Gate every pull request
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-muted">
                  The bundled Action scans TypeScript, Python and Rust projects
                  and fails only when the selected severity threshold is reached.
                </p>
                <pre className="mt-3 overflow-x-auto rounded-lg border border-white/10 bg-input p-3 font-mono text-[12px] leading-relaxed text-foreground">
                  <code>{`- uses: AlpayC/mcp-migration-check@v1
  with:
    source: .
    fail-on: critical`}</code>
                </pre>
                <a
                  href={`${REPO_URL}#github-action`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex text-[13px] text-accent transition-colors hover:text-foreground"
                >
                  See Action inputs →
                </a>
              </div>

              <div className="rounded-xl border border-white/10 bg-raised p-4 sm:col-span-2">
                <div className="font-display text-[15px] font-semibold">
                  Fix it with an agent
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-muted">
                  Install the Claude Code plugin for diagnosis plus the per-rule
                  migration procedure.
                </p>
                <pre className="mt-3 overflow-x-auto rounded-lg border border-white/10 bg-input p-3 font-mono text-[12px] leading-relaxed text-foreground">
                  <code>{`/plugin marketplace add AlpayC/mcp-migration-check
/plugin install mcp-migration@mcp-migration-check`}</code>
                </pre>
                <a
                  href={RELEASES_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex text-[13px] text-accent transition-colors hover:text-foreground"
                >
                  Or download the .skill →
                </a>
              </div>

              <div className="rounded-xl border border-white/10 bg-raised p-4 sm:col-span-2">
                <div className="font-display text-[15px] font-semibold">
                  See the ecosystem snapshot
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-muted">
                  13,350 unique remote registry endpoints probed. The report
                  separates gradeable responses from endpoints that exposed no
                  protocol or authentication signal, plus unreachable targets.
                </p>
                <a
                  href={ECOSYSTEM_REPORT_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex rounded-lg border border-accent/40 bg-accent/[0.14] px-3.5 py-2 text-[13px] font-medium text-foreground transition-colors hover:border-accent/70"
                >
                  Read the 2026-08-23 report →
                </a>
              </div>
            </div>
          </section>
        </BlurFade>

        {/* ---------- footer ---------- */}
        <footer className="mt-20 flex flex-col gap-4 border-t border-white/10 pt-6 text-[13px] text-muted">
          <span>
            Deterministic checker · no LLM, no cookies, nothing stored. Findings
            are signals to review against the canonical spec.
          </span>
          <span className="text-muted/80">
            Rules last verified against the spec on{" "}
            <span className="font-mono">{rulesVerifiedAt}</span>. A citation can
            stop being true without this page changing, so the date is stated
            rather than implied.
          </span>

          <nav className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="transition-colors hover:text-foreground"
            >
              Source
            </a>
            <a
              href={RELEASES_URL}
              target="_blank"
              rel="noreferrer"
              className="transition-colors hover:text-foreground"
            >
              Download the skill
            </a>
            <a
              href={AUTHOR_URL}
              target="_blank"
              rel="noreferrer"
              className="transition-colors hover:text-foreground"
            >
              alpaycelik.dev
            </a>
            <Link
              href="/legal"
              className="transition-colors hover:text-foreground"
            >
              Legal &amp; privacy
            </Link>
          </nav>
        </footer>
      </main>
    </div>
  );
}

function ReportHead({ result }: { result: CheckResult }) {
  const b = band(result.grade.letter);
  const s = BAND_STYLES[b];
  const count = result.findings.length;

  return (
    <BlurFade>
      <div
        className={cn(
          "relative flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-panel sm:flex-row",
          s.glow,
        )}
      >
        <BorderBeam
          size={110}
          duration={6}
          colorFrom={s.from}
          colorTo={s.to}
          borderWidth={1.5}
        />

        {/* grade seal */}
        <div
          className={cn(
            "flex shrink-0 items-center justify-center gap-4 border-b border-white/10 px-8 py-6 sm:w-44 sm:flex-col sm:gap-1 sm:border-b-0 sm:border-r",
            b === "ok" && "bg-ok/[0.07]",
            b === "warn" && "bg-warn/[0.07]",
            b === "bad" && "bg-bad/[0.07]",
          )}
        >
          <span
            className={cn(
              "font-display text-6xl font-bold leading-none sm:text-7xl",
              s.text,
            )}
          >
            {result.grade.letter}
          </span>
          <span className="font-mono text-xs tracking-[0.08em] text-muted">
            <NumberTicker
              value={result.grade.score}
              className="font-mono text-xs text-muted"
            />
            /100
          </span>
        </div>

        {/* meta */}
        <div className="flex min-w-0 flex-col justify-center px-6 py-5">
          <span className="break-all font-mono text-[14px]">
            {result.target}
          </span>
          <span className="mt-1.5 text-[13px] text-muted">
            {count === 0
              ? "No breaking-change signals"
              : `${count} finding${count === 1 ? "" : "s"}`}{" "}
            · checked {new Date(result.checkedAt).toLocaleString()}
          </span>
        </div>
      </div>
    </BlurFade>
  );
}

function FindingCard({ finding: f }: { finding: Finding }) {
  const s = SEV_STYLES[f.severity];

  return (
    <article
      className={cn(
        "group relative overflow-hidden rounded-xl border border-white/10 bg-panel p-5 transition-colors hover:border-white/20 hover:bg-raised",
        "before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:content-['']",
        s.edge,
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
        <span
          className={cn(
            "rounded-md px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em]",
            s.chip,
          )}
        >
          {f.severity}
        </span>
        <span className="font-display text-[16px] font-semibold">
          {f.title}
        </span>
        <span className="ml-auto font-mono text-[12px] text-muted">
          {f.ruleId}
        </span>
      </div>

      {f.location && (
        <div className="mt-2 font-mono text-[12px] text-muted">
          {f.location}
        </div>
      )}

      <p className="mt-2.5 text-[14px] leading-relaxed">{f.detail}</p>

      <div className="mt-3 border-t border-dashed border-white/10 pt-3 text-[14px] leading-relaxed">
        <b className="font-display text-accent">Fix</b> · {f.fix}
      </div>

      <a
        href={f.specRef}
        target="_blank"
        rel="noreferrer"
        className="mt-3 inline-block break-all font-mono text-[12px] text-muted underline-offset-4 transition-colors hover:text-accent hover:underline"
      >
        {f.specRef}
      </a>
    </article>
  );
}
