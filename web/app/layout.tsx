import type { Metadata } from "next";
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
      <body>{children}</body>
    </html>
  );
}
