import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  loadMinutesBudget,
  saveMinutesBudget
} from "./minutes-budget-store.mjs";
import {
  needsMinutesAnalysisRefresh,
  reserveMinutesBackfill
} from "../packages/ingest/dist/minutes-backfill-policy.js";

const [command, directory] = process.argv.slice(2);
if (!directory) throw new Error("A published data directory is required.");
async function readOptional(path) {
  try {
    return JSON.parse(await readFile(join(directory, path), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
let output;
if (command === "reserve") {
  const path = "manifests/minutes_backfill_budget.json";
  const { budget, parent } = loadMinutesBudget(
    directory,
    await readOptional(path)
  );
  const batchId = `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
  if (!process.env.GITHUB_RUN_ID || !process.env.GITHUB_RUN_ATTEMPT)
    throw new Error("A GitHub run and attempt are required for reservation.");
  const result = reserveMinutesBackfill(
    budget,
    batchId,
    new Date(),
    process.env.MINUTES_BACKFILL_PARALLEL === "true"
  );
  if (result.admitted || !parent)
    saveMinutesBudget(directory, result.budget, parent);
  output = `admitted=${result.admitted}\n`;
} else if (command === "refresh") {
  const summaries = await readOptional(
    "exports/member_statement_summaries/index.json"
  );
  const analysis = await readOptional("exports/member_analysis/index.json");
  output = `needed=${Boolean(summaries && needsMinutesAnalysisRefresh(summaries, analysis))}\n`;
} else {
  throw new Error(`Unknown minutes control command: ${command}`);
}
process.stdout.write(output);
if (process.env.GITHUB_OUTPUT)
  await appendFile(process.env.GITHUB_OUTPUT, output);
