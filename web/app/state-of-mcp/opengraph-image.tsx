import { ImageResponse } from "next/og";

import { count, share, SNAPSHOT } from "@/lib/ecosystem-snapshot";
import { OG, OG_CONTENT_TYPE, OG_SIZE, OgFrame, SITE_HOST } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = `${share(SNAPSHOT.eras.legacy, SNAPSHOT.graded)} of graded MCP servers still answer only the legacy protocol, from ${count(SNAPSHOT.graded)} endpoints graded on ${SNAPSHOT.day}`;

/**
 * The card that carries the finding.
 *
 * Generated from the snapshot rather than drawn once and checked in, so the
 * percentage on it moves with the report like every other surface. A card
 * showing last quarter's number is worse than no card: it is the one part of
 * the page that gets screenshotted and quoted without the date attached.
 */
export default function Image() {
  return new ImageResponse(
    (
      <OgFrame
        eyebrow={`State of MCP migration · ${SNAPSHOT.day}`}
        footer={`${count(SNAPSHOT.graded)} registry endpoints graded · ${SITE_HOST}`}
      >
        <div
          style={{
            display: "flex",
            fontSize: 190,
            fontWeight: 700,
            letterSpacing: -6,
            lineHeight: 1,
            color: OG.bad,
          }}
        >
          {share(SNAPSHOT.eras.legacy, SNAPSHOT.graded)}
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 24,
            maxWidth: 900,
            fontSize: 42,
            lineHeight: 1.3,
            color: OG.foreground,
          }}
        >
          of graded MCP servers still answer only the legacy protocol
        </div>
      </OgFrame>
    ),
    size,
  );
}
