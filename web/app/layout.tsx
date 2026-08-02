import type { Metadata } from "next";

import { GitHubChip } from "@/components/github-chip";
import "./globals.css";

export const metadata: Metadata = {
  title: "MCP Migration Check · 2026-07-28 readiness",
  description:
    "Paste an MCP endpoint and see whether it survives the 2026-07-28 spec break — stateless model, OAuth 2.1, deprecated features. Deterministic, no data stored.",
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
