import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getHeapStatistics } from "node:v8";

export type BuildMemoryRecorder = (
  stage: string,
  counts?: Record<string, number>
) => void;

/** Small synchronous checkpoints survive V8 aborts; never dump the heap or env. */
export function createBuildMemoryRecorder(
  directory: string
): BuildMemoryRecorder {
  const path = join(directory, "build-memory.ndjson");
  let writable = true;
  let sampledPeakHeapUsed = 0;
  let sampledPeakRss = 0;
  try {
    mkdirSync(directory, { recursive: true });
  } catch {
    writable = false;
  }

  return (stage, counts = {}) => {
    const memory = process.memoryUsage();
    sampledPeakHeapUsed = Math.max(sampledPeakHeapUsed, memory.heapUsed);
    sampledPeakRss = Math.max(sampledPeakRss, memory.rss);
    const row = {
      stage,
      at: new Date().toISOString(),
      ...memory,
      heapSizeLimit: getHeapStatistics().heap_size_limit,
      sampledPeakHeapUsed,
      sampledPeakRss,
      maxRssKiB: process.resourceUsage().maxRSS,
      counts: Object.fromEntries(
        Object.entries(counts).filter(([, value]) => Number.isFinite(value))
      )
    };
    const line = JSON.stringify(row);
    console.info(`[build-memory] ${line}`);
    if (writable) {
      try {
        appendFileSync(path, `${line}\n`);
      } catch {
        writable = false;
        console.warn(
          "Unable to append build memory diagnostics; inspect the job log."
        );
      }
    }
  };
}
