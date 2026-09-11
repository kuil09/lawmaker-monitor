import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadBuildDataRawInputs,
  resolveBuildDataRuntimeConfig
} from "../build-data/input-stage.js";
import { buildNormalizedStage } from "../build-data/normalize-stage.js";
import { publishBuildOutputs } from "../build-data/publish-stage.js";
import { createBuildMemoryRecorder } from "../build-memory.js";
import { runWithDiagnostics } from "../run-diagnostics.js";

export async function buildData(args?: {
  env?: NodeJS.ProcessEnv;
  repositoryRoot?: string;
}): Promise<void> {
  const runtimeConfig = resolveBuildDataRuntimeConfig(args);
  const memory = createBuildMemoryRecorder(
    resolve(
      runtimeConfig.repositoryRoot,
      runtimeConfig.env.BUILD_DIAGNOSTICS_DIR ?? "artifacts/diagnostics"
    )
  );
  memory("raw-inputs:start");
  const normalized = await (async () => {
    const rawInputs = await loadBuildDataRawInputs(runtimeConfig);
    memory("normalize:start");
    return buildNormalizedStage(rawInputs);
  })();
  memory("normalize:end", {
    members: normalized.bundle.members.length,
    votes: normalized.bundle.voteFacts.length,
    attendance: normalized.bundle.attendanceFacts.length
  });

  await publishBuildOutputs({
    runtimeConfig,
    normalized,
    memory
  });
}

async function main(): Promise<void> {
  await buildData();
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void runWithDiagnostics("build-data", main);
}
