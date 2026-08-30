/**
 * Shared frame for the social cards.
 *
 * Every link to this site — Hacker News, Reddit, Slack, a newsletter — rendered
 * as a bare URL before these existed, which for a page whose entire value is a
 * single percentage is most of the value thrown away. The card carries the
 * figure so the number travels even when nobody clicks.
 *
 * Written for satori, not for a browser: it lays out a flexbox subset, so every
 * element with more than one child needs an explicit `display: flex`, and there
 * is no cascade to inherit from. The palette is duplicated from globals.css
 * because CSS variables do not reach here.
 */
export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

export const OG = {
  background: "#06070a",
  foreground: "#e7ecf3",
  muted: "#8b95a7",
  accent: "#6d8bff",
  bad: "#ff5d5d",
  line: "rgba(255,255,255,0.10)",
};

export const SITE_HOST = "mcp-migration-check.alpaycelik.workers.dev";

/**
 * The card frame: dark ground, an accent rule down the left, a footer line.
 *
 * `eyebrow` is the small tracked label, `footer` the attribution strip. The
 * caller owns everything between them.
 */
export function OgFrame({
  eyebrow,
  footer,
  children,
}: {
  eyebrow: string;
  footer: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        background: OG.background,
        color: OG.foreground,
        // A wash from the accent so the card is not a flat rectangle in a feed
        // of flat rectangles. Radial, off the top-left, the way the site's own
        // ambient background sits.
        backgroundImage:
          "radial-gradient(900px 520px at 12% -10%, rgba(109,139,255,0.20), transparent), " +
          "radial-gradient(700px 460px at 95% 110%, rgba(160,80,255,0.14), transparent)",
      }}
    >
      <div style={{ display: "flex", width: 12, background: OG.accent }} />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          flex: 1,
          padding: "64px 72px",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 24,
            letterSpacing: 4,
            textTransform: "uppercase",
            color: OG.accent,
          }}
        >
          {eyebrow}
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>{children}</div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            paddingTop: 28,
            borderTop: `1px solid ${OG.line}`,
            fontSize: 26,
            color: OG.muted,
          }}
        >
          {footer}
        </div>
      </div>
    </div>
  );
}
