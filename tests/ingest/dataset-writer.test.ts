import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { writeNdjsonDataset } from "../../packages/ingest/src/dataset-writer.js";
import {
  ATTENDANCE_DATASET_SEED,
  attendanceDatasetRows,
  buildManifest,
  toAttendanceFactsNdjson,
  toNdjson
} from "../../packages/ingest/src/exports.js";
import {
  loadBuildDataRawInputs,
  resolveBuildDataRuntimeConfig
} from "../../packages/ingest/src/build-data/input-stage.js";
import { buildNormalizedStage } from "../../packages/ingest/src/build-data/normalize-stage.js";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

describe("streamed dataset serialization", () => {
  it.each([
    { rows: [] },
    {
      rows: [
        { name: "가나다", id: 1 },
        { name: "漢字", id: 2 }
      ]
    }
  ])("matches legacy framing and UTF-8 checksum: %j", async ({ rows }) => {
    const dir = await mkdtemp(join(tmpdir(), "dataset-"));
    try {
      const expected = toNdjson(rows);
      const result = await writeNdjsonDataset(join(dir, "data.ndjson"), rows);
      expect(await readFile(join(dir, "data.ndjson"), "utf8")).toBe(expected);
      expect(result).toEqual({
        checksumSha256: hash(expected),
        rowCount: rows.length,
        byteSize: Buffer.byteLength(expected)
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("preserves the trailing newline of an empty optional seeded dataset", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dataset-seed-"));
    try {
      const prefix = '{"__seed":true}\n';
      const result = await writeNdjsonDataset(
        join(dir, "data.ndjson"),
        [],
        prefix
      );
      expect(await readFile(join(dir, "data.ndjson"), "utf8")).toBe(prefix);
      expect(result).toEqual({
        checksumSha256: hash(prefix),
        rowCount: 0,
        byteSize: Buffer.byteLength(prefix)
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("does not publish a partial file if iteration/serialization fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dataset-failure-"));
    try {
      const path = join(dir, "data.ndjson");
      await writeFile(path, "last-good");
      function* rows() {
        yield { id: 1 };
        throw new Error("broken source");
      }
      await expect(writeNdjsonDataset(path, rows())).rejects.toThrow(
        "broken source"
      );
      expect(await readFile(path, "utf8")).toBe("last-good");
      expect(await readdir(dir)).toEqual(["data.ndjson"]);
      await expect(writeNdjsonDataset(path, [undefined])).rejects.toThrow(
        "serializable"
      );
      expect(await readFile(path, "utf8")).toBe("last-good");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("propagates destination errors and removes its temporary file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dataset-io-"));
    try {
      await expect(writeNdjsonDataset(dir, [{ id: 1 }])).rejects.toThrow();
      expect(await readdir(dir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("keeps the full manifest and all sentinel/checksum semantics unchanged", async () => {
    const raw = await loadBuildDataRawInputs(
      resolveBuildDataRuntimeConfig({
        repositoryRoot: process.cwd(),
        env: {
          RAW_DIR: "tests/fixtures",
          DATA_REPO_DIR: "tests/fixtures/property_mirror"
        }
      })
    );
    const normalized = await buildNormalizedStage(raw);
    const bundle = normalized.bundle;
    const dir = await mkdtemp(join(tmpdir(), "dataset-manifest-"));
    try {
      const normalizedDatasets: any = {};
      for (const name of [
        "members",
        "rollCalls",
        "voteFacts",
        "meetings",
        "sources"
      ] as const) {
        normalizedDatasets[name] = await writeNdjsonDataset(
          join(dir, name),
          bundle[name]
        );
      }
      const seed = JSON.stringify(ATTENDANCE_DATASET_SEED);
      normalizedDatasets.attendanceFacts = await writeNdjsonDataset(
        join(dir, "attendance"),
        attendanceDatasetRows(bundle.attendanceFacts),
        seed + (bundle.attendanceFacts.length ? "\n" : "")
      );
      expect(await readFile(join(dir, "attendance"), "utf8")).toBe(
        toAttendanceFactsNdjson(bundle.attendanceFacts)
      );
      const empty = await writeNdjsonDataset(
        join(dir, "empty-attendance"),
        attendanceDatasetRows([]),
        seed
      );
      expect(empty.checksumSha256).toBe(hash(toAttendanceFactsNdjson([])));
      const properties = [{ id: 1, text: "한글" }];
      const optional = await writeNdjsonDataset(
        join(dir, "property"),
        properties,
        '{"__seed":true}\n'
      );
      const input = {
        bundle,
        currentAssembly: normalized.currentAssembly,
        dataRepoBaseUrl: "https://example.test/"
      };
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-09-12T00:00:00.000Z"));
      const legacy = buildManifest({
        ...input,
        assetDisclosureItemsDataset: {
          content: '{"__seed":true}\n' + toNdjson(properties),
          rowCount: 1
        }
      });
      const streamed = buildManifest({
        ...input,
        normalizedDatasets,
        assetDisclosureItemsDataset: optional
      });
      expect(streamed).toEqual(legacy);
    } finally {
      vi.useRealTimers();
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("writes a dataset larger than its 64 MiB child heap without buffering it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dataset-budget-"));
    try {
      const moduleUrl = pathToFileURL(
        join(process.cwd(), "packages/ingest/src/dataset-writer.ts")
      ).href;
      const path = join(dir, "large.ndjson");
      const child = spawnSync(
        process.execPath,
        [
          "--max-old-space-size=64",
          "--input-type=module",
          "-e",
          `
        import { writeNdjsonDataset } from ${JSON.stringify(moduleUrl)};
        function* rows() { const text="a".repeat(8192); for(let id=0;id<12000;id++) yield {id,text}; }
        console.log(JSON.stringify(await writeNdjsonDataset(${JSON.stringify(path)},rows())));
      `
        ],
        { encoding: "utf8", timeout: 30000 }
      );
      expect(child.status, child.stderr).toBe(0);
      const result = JSON.parse(child.stdout.trim());
      expect(result.rowCount).toBe(12000);
      expect(result.byteSize).toBe((await stat(path)).size);
      expect(result.byteSize).toBeGreaterThan(64 * 1024 * 1024);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 35000);
});
