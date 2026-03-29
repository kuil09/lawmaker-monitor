import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildConstituencyBoundaryExportFromRecords,
  CONSTITUENCY_LAW_EFFECTIVE_DATE,
  CONSTITUENCY_LAW_PAGE_URL,
  fetchOfficialConstituencyBoundaryInputs,
  parseConstituencyLawText
} from "../constituency-boundaries.js";
import { validateConstituencyBoundaryExport } from "../validation.js";

async function main(): Promise<void> {
  const repositoryRoot = resolve(fileURLToPath(new URL("../../../../", import.meta.url)));
  const outputDir = resolve(
    repositoryRoot,
    process.env.OUTPUT_DIR ?? "artifacts/constituency-boundaries/current"
  );
  const generatedAt = process.env.GENERATED_AT ?? new Date().toISOString();
  const timeoutMs = Number.parseInt(process.env.FETCH_TIMEOUT_MS ?? "", 10) || 120_000;

  const inputs = await fetchOfficialConstituencyBoundaryInputs({
    timeoutMs
  });
  const lawRecords = parseConstituencyLawText(inputs.law.text);

  const boundaryExport = validateConstituencyBoundaryExport(
    buildConstituencyBoundaryExportFromRecords({
      generatedAt,
      lawEffectiveDate: CONSTITUENCY_LAW_EFFECTIVE_DATE,
      lawSourceUrl: CONSTITUENCY_LAW_PAGE_URL,
      lawRecords,
      lawSource: inputs.law.source,
      indexedEmdRecords: inputs.boundaryBundle.indexedEmdRecords,
      sigunguSource: inputs.boundaryBundle.sigunguSource,
      emdSource: inputs.boundaryBundle.emdSource
    })
  );
  const boundaryExportJson = JSON.stringify(boundaryExport);

  await mkdir(outputDir, { recursive: true });

  await Promise.all([
    writeFile(join(outputDir, "constituency_boundaries.geojson"), boundaryExportJson),
    writeFile(
      join(outputDir, "source_manifest.json"),
      JSON.stringify(
        {
          generatedAt,
          lawEffectiveDate: CONSTITUENCY_LAW_EFFECTIVE_DATE,
          lawSourceUrl: CONSTITUENCY_LAW_PAGE_URL,
          sources: boundaryExport.sources,
          featureCount: boundaryExport.features.length
        },
        null,
        2
      )
    )
  ]);

  process.stdout.write(
    [
      `Wrote ${boundaryExport.features.length} constituency features.`,
      `GeoJSON: ${join(outputDir, "constituency_boundaries.geojson")}`,
      `Manifest: ${join(outputDir, "source_manifest.json")}`
    ].join("\n")
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
