import type { Metadata } from "next";

import { GitHubChip } from "@/components/github-chip";
import "./globals.css";

const SITE_URL = "https://mcp-migration-check.alpaycelik.workers.dev";
const DESCRIPTION =
  "Check a live MCP endpoint or scan a TypeScript, Python or Rust server for the 2026-07-28 spec break — deterministic, no data stored.";

export const metadata: Metadata = {
  // Required for the `opengraph-image` convention to emit absolute URLs.
  // Without it every card resolves relative and no crawler can fetch one.
  metadataBase: new URL(SITE_URL),
  title: "MCP Migration Check · 2026-07-28 readiness",
  description: DESCRIPTION,
  // Each route's own `opengraph-image.tsx` fills in `images` here. A page
  // without one inherits the site card rather than falling back to a bare link.
  openGraph: {
    type: "website",
    siteName: "MCP Migration Check",
    url: SITE_URL,
    title: "MCP Migration Check · 2026-07-28 readiness",
    description: DESCRIPTION,
  },
  // No `twitter.images`: the `opengraph-image` file convention emits
  // `twitter:image` from the same route, so naming one here would be a second
  // place for the card to be wrong. The card type does have to be stated, or
  // the image renders as a thumbnail beside the text instead of above it.
  twitter: {
    card: "summary_large_image",
    title: "MCP Migration Check · 2026-07-28 readiness",
    description: DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* Loaded at runtime rather than via next/font so the build stays
            network-independent. Falls back to the system stack. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&display=swap"
        />
      </head>
      <body className="min-h-dvh antialiased">
        <GitHubChip />
        {children}
      </body>
    </html>
  );
}
