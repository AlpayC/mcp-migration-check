import type { Metadata } from "next";
import Link from "next/link";

import { BlurFade } from "@/components/ui/blur-fade";

export const metadata: Metadata = {
  title: "Legal notice & privacy · MCP Migration Check",
  description:
    "Provider identification under § 5 DDG and privacy information for mcp-migration-check.",
  robots: { index: false, follow: true },
};

/**
 * Legal notice and privacy information.
 *
 * Two things drive this page. The obvious one is § 5 DDG (the German provider
 * identification requirement). The less obvious one is that "no cookies" does
 * not mean "no personal data": the rate limiter keys on `cf-connecting-ip`, and
 * Cloudflare keeps its own access logs. That is processing of personal data
 * under the GDPR and belongs in writing, whatever one concludes about the
 * Impressum obligation itself.
 *
 * Written in English to match the rest of the site. German law does not
 * prescribe a language for the notice, but a German version is the more
 * conservative choice if German consumers are a target audience.
 */

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="font-display text-lg font-semibold text-foreground">
        {title}
      </h2>
      <div className="mt-3 flex flex-col gap-3 text-[14.5px] leading-relaxed text-muted">
        {children}
      </div>
    </section>
  );
}

export default function Legal() {
  return (
    <div className="relative isolate min-h-dvh">
      <main className="mx-auto w-full max-w-2xl px-6 pb-28 pt-16 sm:pt-24">
        <BlurFade delay={0.05}>
          <Link
            href="/"
            className="font-mono text-[12px] uppercase tracking-[0.16em] text-muted transition-colors hover:text-accent"
          >
            ← back to the checker
          </Link>
        </BlurFade>

        <BlurFade delay={0.12}>
          <h1 className="mt-6 font-display text-3xl font-bold tracking-tight sm:text-4xl">
            Legal notice &amp; privacy
          </h1>
          <p className="mt-2 font-mono text-[12px] text-muted">
            Impressum &amp; Datenschutzerklärung · § 5 DDG, GDPR
          </p>
        </BlurFade>

        <BlurFade delay={0.24}>
          <Section title="Provider identification (§ 5 DDG)">
            <p>
              Alpay Celik
              <br />
              Heidekamp 9
              <br />
              33790 Halle (Westf.)
              <br />
              Germany
            </p>
            <p>
              Email:{" "}
              <a
                href="mailto:hello@alpaycelik.dev"
                className="text-accent underline-offset-4 hover:underline"
              >
                hello@alpaycelik.dev
              </a>
            </p>
            <p>
              Responsible for content under § 18(2) MStV: Alpay Celik, address as
              above.
            </p>
            <p>
              This is a non-commercial demonstration project. No goods or
              services are offered and no payments are accepted.
            </p>
          </Section>

          <Section title="What this service does">
            <p>
              You supply the URL of an MCP endpoint. The server requests that
              URL, evaluates the response against a fixed set of rules, and
              displays the result. No language model is involved.
            </p>
            <p>
              <b className="text-foreground">Note:</b> the address you enter is
              actually contacted. Whoever operates that target will see a request
              originating from this service&apos;s infrastructure. Only check
              endpoints you are permitted to check.
            </p>
          </Section>

          <Section title="Data processed">
            <p>
              <b className="text-foreground">No cookies.</b> Nothing is stored in
              your browser, and there is no usage analytics or tracking. No
              consent banner is required.
            </p>
            <p>
              <b className="text-foreground">IP address.</b> To limit abuse, the
              number of checks per minute is counted per IP address (20 requests
              per minute). The address is processed transiently for that purpose
              only and is not retained. Legal basis: Art. 6(1)(f) GDPR —
              legitimate interest in keeping the service available.
            </p>
            <p>
              <b className="text-foreground">Checked URLs.</b> The address you
              enter and the resulting report are not stored. They exist only for
              the duration of the request.
            </p>
            <p>
              <b className="text-foreground">Server logs.</b> The application
              runs on Cloudflare Workers. As the infrastructure operator,
              Cloudflare processes its own access data under its own terms; see
              the{" "}
              <a
                href="https://www.cloudflare.com/privacypolicy/"
                target="_blank"
                rel="noreferrer"
                className="text-accent underline-offset-4 hover:underline"
              >
                Cloudflare Privacy Policy
              </a>
              .
            </p>
            <p>
              <b className="text-foreground">Fonts.</b> The display typeface is
              loaded from Google Fonts, so your browser connects to Google and
              transmits your IP address in the process.
            </p>
          </Section>

          <Section title="Your rights">
            <p>
              Under the GDPR you have the right to access, rectification,
              erasure, restriction of processing, data portability and
              objection, as well as the right to lodge a complaint with a
              supervisory authority. Since no personal data beyond the points
              above is retained, there is normally no stored data relating to
              you.
            </p>
          </Section>

          <Section title="Liability for content and links">
            <p>
              The reports are signals, not assurances. They derive from a fixed
              rule set and may be incomplete or wrong in a given case; the
              official specification is always authoritative. No liability is
              accepted for decisions made on the basis of this output.
            </p>
            <p>
              Operators of linked external sites are responsible for their own
              content.
            </p>
          </Section>
        </BlurFade>

        <footer className="mt-16 border-t border-white/10 pt-6 text-[13px] text-muted">
          <Link
            href="/"
            className="text-accent underline-offset-4 hover:underline"
          >
            ← back to the checker
          </Link>
        </footer>
      </main>
    </div>
  );
}
