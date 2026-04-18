import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadBuildDataRawInputs,
  resolveBuildDataRuntimeConfig
} from "../build-data/input-stage.js";
import { buildNormalizedStage } from "../build-data/normalize-stage.js";
import { publishBuildOutputs } from "../build-data/publish-stage.js";

export async function buildData(args?: {
  env?: NodeJS.ProcessEnv;
  repositoryRoot?: string;
}): Promise<void> {
  const runtimeConfig = resolveBuildDataRuntimeConfig(args);
  const rawInputs = await loadBuildDataRawInputs(runtimeConfig);
  const normalized = await buildNormalizedStage(rawInputs);

  await publishBuildOutputs({
    runtimeConfig: rawInputs,
    normalized
  });
}

async function main(): Promise<void> {
  await buildData();
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void main();
}
