#!/usr/bin/env node
/**
 * Re-render every surface that quotes the ecosystem numbers.
 *
 * `report:ecosystem` already does this at the end of a run. This entry point is
 * for the other two cases: a full report is still on disk and only the
 * extraction needs redoing (`--extract`), or nothing changed upstream and the
 * surfaces just need rendering again from the committed summary — which is what
 * CI runs before checking that none of them moved.
 */
import { extractSummary, renderSurfaces } from "./ecosystem-snapshot.mjs";

if (process.argv.includes("--extract")) {
  const { source, outfile } = await extractSummary();
  console.log(`Summary from reports/${source} → ${outfile}`);
}

const { summary, written } = await renderSurfaces();
console.log(`Ecosystem surfaces re-rendered from the ${summary.day} snapshot:`);
for (const path of written) console.log(`  ${path}`);
