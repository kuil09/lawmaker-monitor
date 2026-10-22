import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

import {
  memberAnalysisIndexSchema,
  memberAnalysisDetailSchema
} from "../packages/schemas/dist/index.js";

const root = resolve(process.argv[2] ?? "artifacts/build");
const binary = process.env.DUCKDB_BIN ?? "duckdb";
const version = spawnSync(binary, ["-no-agent", "--version"], {
  encoding: "utf8"
});
if (version.status !== 0 || !/^v2\.0\./m.test(version.stdout))
  throw new Error("Member analysis requires a verified DuckDB 2.0.x CLI.");
const sql = await readFile(
  new URL("../packages/ingest/sql/member_analysis.sql", import.meta.url),
  "utf8"
);
const run = spawnSync(binary, ["-no-agent", "-bail", ":memory:"], {
  cwd: root,
  input: sql,
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024
});
if (run.status !== 0)
  throw new Error(
    `DuckDB member analysis failed:\n${run.stderr}\n${run.stdout}`
  );
const indexPath = join(root, "exports/member_analysis/index.json");
const [builtIndex] = JSON.parse(await readFile(indexPath, "utf8"));
const index = memberAnalysisIndexSchema.parse(builtIndex);
const details = JSON.parse(
  await readFile(join(root, "analysis-input/details.json"), "utf8")
);
if (details.length !== index.members.length)
  throw new Error("Incomplete member analysis export.");
for (const raw of details) {
  const detail = memberAnalysisDetailSchema.parse(raw);
  await writeFile(
    join(
      root,
      `exports/member_analysis/${encodeURIComponent(detail.memberId)}.json`
    ),
    JSON.stringify(detail)
  );
}
await writeFile(indexPath, JSON.stringify(index));
const files = {};
for (const name of [
  "analysis_members",
  "analysis_events",
  "analysis_activities",
  "analysis_monthly_topics"
]) {
  const path = `curated/${name}.parquet`;
  const bytes = await readFile(join(root, path));
  files[name] = {
    path,
    byteSize: bytes.length,
    checksumSha256: createHash("sha256").update(bytes).digest("hex")
  };
}
await writeFile(
  join(root, "exports/member_analysis/manifest.json"),
  JSON.stringify({
    engineVersion: index.engineVersion,
    snapshotId: index.snapshotId,
    files
  })
);
try {
  const manifestPath = join(root, "manifests/latest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const names = {
    analysis_members: "analysisMembers",
    analysis_events: "analysisEvents",
    analysis_activities: "analysisActivities",
    analysis_monthly_topics: "analysisMonthlyTopics"
  };
  for (const [name, file] of Object.entries(files))
    manifest.datasets[names[name]] = {
      ...file,
      url: new URL(file.path, manifest.dataRepoBaseUrl).toString()
    };
  const content = await readFile(indexPath);
  manifest.exports.memberAnalysis = {
    path: "exports/member_analysis/index.json",
    url: new URL(
      "exports/member_analysis/index.json",
      manifest.dataRepoBaseUrl
    ).toString(),
    rowCount: index.members.length,
    checksumSha256: createHash("sha256").update(content).digest("hex")
  };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
console.info(
  `DuckDB ${index.engineVersion}: published ${details.length} member analyses; ${index.coverage.statements} statements.`
);
