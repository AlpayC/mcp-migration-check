// GENERATED FILE — do not edit.
// Written by scripts/ecosystem-snapshot.mjs from reports/summary.json.
// Regenerate with `npm run report:ecosystem`, or re-render every surface from
// the committed summary with `npm run build:ecosystem-snapshot`.

/** Aggregate totals from the most recent ecosystem probe. */
export const SNAPSHOT = {
  "day": "2026-08-23",
  "startedAt": "2026-08-23T15:00:15.869Z",
  "specReleasedAt": "2026-07-28",
  "rulesVerifiedAt": "2026-08-01",
  "registryEntries": 24365,
  "localOnly": 10984,
  "probed": 13380,
  "outcomes": {
    "graded": 10890,
    "silent": 1597,
    "unreachable": 892,
    "blocked": 1
  },
  "graded": 10890,
  "eras": {
    "modern": 96,
    "dual": 594,
    "legacy": 6541,
    "unknown": 3659
  },
  "touchedSinceSpec": 6191,
  "legacyAmongTouched": 3950,
  "touchedBySource": {
    "repository": {
      "total": 4325,
      "legacy": 3223,
      "unknownEra": 806
    },
    "registry": {
      "total": 1866,
      "legacy": 727,
      "unknownEra": 912
    }
  },
  "withCritical": 7230,
  "grades": {
    "A": 3572,
    "B": 88,
    "C": 6692,
    "D": 442,
    "F": 96
  },
  "ruleCounts": {
    "MCP001": 6541,
    "MCP002": 310,
    "MCP003": 408,
    "MCP004": 4,
    "MCP005": 2,
    "MCP006": 677,
    "MCP007": 0,
    "MCP008": 17,
    "MCP101": 594,
    "MCP102": 74
  }
} as const;

/** `n` as a share of `of`, to one decimal. One rounding rule, in one place. */
export function share(n: number, of: number): string {
  return `${((n / of) * 100).toFixed(1)}%`;
}

/** Thousands separators, so no two figures on the page disagree about them. */
export function count(n: number): string {
  return n.toLocaleString("en-US");
}
