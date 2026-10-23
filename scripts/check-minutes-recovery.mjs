import { readFile } from "node:fs/promises";

import { shouldRunScheduledMinutesRecovery } from "../packages/ingest/dist/minutes-summary-policy.js";

let state = null;
try {
  state = JSON.parse(await readFile(process.argv[2], "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
process.stdout.write(`${shouldRunScheduledMinutesRecovery(state)}\n`);
