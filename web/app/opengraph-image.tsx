import { ImageResponse } from "next/og";

import { SNAPSHOT } from "@/lib/ecosystem-snapshot";
import { OG, OG_CONTENT_TYPE, OG_SIZE, OgFrame, SITE_HOST } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt =
  "MCP Migration Check — will your MCP server survive the 2026-07-28 rewrite?";

/** The card for the checker itself: the question, not the finding. */
export default function Image() {
  return new ImageResponse(
    (
      <OgFrame
        eyebrow={`Spec ${SNAPSHOT.specReleasedAt} · readiness`}
        footer={`Deterministic · no LLM, nothing stored · ${SITE_HOST}`}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            fontSize: 82,
            fontWeight: 700,
            letterSpacing: -2,
            lineHeight: 1.1,
            color: OG.foreground,
          }}
        >
          <div style={{ display: "flex" }}>Will your MCP server</div>
          <div style={{ display: "flex" }}>
            <span style={{ color: OG.accent }}>survive</span>
            <span>&nbsp;the rewrite?</span>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 28,
            maxWidth: 880,
            fontSize: 34,
            lineHeight: 1.35,
            color: OG.muted,
          }}
        >
          Probe a live endpoint or scan a TypeScript, Python or Rust server for
          the 2026-07-28 spec break.
        </div>
      </OgFrame>
    ),
    size,
  );
}
