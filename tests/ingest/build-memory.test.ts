import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { createBuildMemoryRecorder } from "../../packages/ingest/src/build-memory.js";
import { runWithDiagnostics } from "../../packages/ingest/src/run-diagnostics.js";

describe("durable build diagnostics", () => {
  it("persists numeric checkpoints immediately without serializing env or payloads", async () => {
    const dir = await mkdtemp(join(tmpdir(), "build-memory-"));
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const record = createBuildMemoryRecorder(dir);
      record("property:start", { rows: 42, invalid: NaN });
      record("property:end", { rows: 42 });
      const rows = (await readFile(join(dir, "build-memory.ndjson"), "utf8"))
        .trim()
        .split("\n")
        .map(JSON.parse);
      expect(rows).toHaveLength(2);
      expect(rows[0].counts).toEqual({ rows: 42 });
      expect(rows[1].heapSizeLimit).toBeGreaterThan(0);
      expect(rows[1].sampledPeakHeapUsed).toBeGreaterThanOrEqual(
        rows[0].heapUsed
      );
      expect(rows[1].sampledPeakRss).toBeGreaterThanOrEqual(rows[0].rss);
      expect(rows[1]).not.toHaveProperty("env");
    } finally {
      spy.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("writes an unfinished report before invoking the task", async () => {
    const dir = await mkdtemp(join(tmpdir(), "build-start-"));
    try {
      await runWithDiagnostics(
        "test",
        async () => {
          expect(
            JSON.parse(await readFile(join(dir, "test.json"), "utf8"))
          ).toMatchObject({ outcome: "running", finishedAt: null });
        },
        dir
      );
      expect(
        JSON.parse(await readFile(join(dir, "test.json"), "utf8"))
      ).toMatchObject({ outcome: "success" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("keeps the last completed checkpoint when its process is killed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "build-killed-"));
    try {
      const url = pathToFileURL(
        join(process.cwd(), "packages/ingest/src/build-memory.ts")
      ).href;
      const child = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
        import { createBuildMemoryRecorder } from ${JSON.stringify(url)};
        createBuildMemoryRecorder(${JSON.stringify(dir)})("abort-simulation:start");
        process.kill(process.pid,"SIGKILL");
      `
        ],
        { encoding: "utf8", timeout: 10000 }
      );
      expect(child.signal).toBe("SIGKILL");
      expect(
        JSON.parse(
          (await readFile(join(dir, "build-memory.ndjson"), "utf8")).trim()
        )
      ).toMatchObject({ stage: "abort-simulation:start" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("preserves an aborted child exit code and shell-level resource report", async () => {
    const dir = await mkdtemp(join(tmpdir(), "build-wrapper-"));
    try {
      await writeFile(join(dir, "npm"), "#!/bin/sh\nexit 134\n");
      await chmod(join(dir, "npm"), 0o755);
      const child = spawnSync("bash", ["scripts/run-data-build.sh"], {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 10000,
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          BUILD_DIAGNOSTICS_DIR: dir
        }
      });
      expect(child.status, child.stderr).toBe(134);
      expect(
        JSON.parse(await readFile(join(dir, "process-exit.json"), "utf8"))
      ).toMatchObject({ exitCode: 134 });
      expect(
        await readFile(join(dir, "process-resources.txt"), "utf8")
      ).toContain("Maximum resident set size");
      expect(
        JSON.parse(await readFile(join(dir, "provenance.json"), "utf8"))
      ).toHaveProperty("heapSizeLimit");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
