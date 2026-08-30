import { SNAPSHOT } from "./ecosystem-snapshot";

/** Single place for the outward-facing URLs, so a rename touches one file. */
export const REPO_URL = "https://github.com/AlpayC/mcp-migration-check";
export const RELEASES_URL = `${REPO_URL}/releases/latest`;
export const AUTHOR_URL = "https://alpaycelik.dev";

/**
 * The snapshot lives on this site now, not only in the repository.
 *
 * It is the half of the project that people link to and quote — the reason
 * anyone goes looking for a checker in the first place — and a Markdown file
 * under `reports/` only reaches whoever was already reading the repository.
 * The rendered report stays there as the source, linked from the page itself.
 */
export const ECOSYSTEM_REPORT_URL = "/state-of-mcp";
export const ECOSYSTEM_REPORT_SOURCE_URL = `${REPO_URL}/blob/main/reports/ecosystem-${SNAPSHOT.day}.md`;
