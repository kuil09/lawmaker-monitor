import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export type DatasetMetadata = {
  checksumSha256: string;
  rowCount: number;
  byteSize: number;
};

/** Preserve join("\n") framing and hash the bytes actually written, not a second copy. */
export async function writeNdjsonDataset(
  path: string,
  rows: Iterable<unknown> | AsyncIterable<unknown>,
  prefix = ""
): Promise<DatasetMetadata> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  const hash = createHash("sha256");
  let rowCount = 0;
  let byteSize = 0;

  async function* chunks(): AsyncGenerator<Buffer> {
    if (prefix) {
      const bytes = Buffer.from(prefix);
      hash.update(bytes);
      byteSize += bytes.length;
      yield bytes;
    }
    for await (const row of rows) {
      const serialized = JSON.stringify(row);
      if (serialized === undefined) {
        throw new Error("NDJSON rows must be JSON serializable values.");
      }
      const bytes = Buffer.from(`${rowCount > 0 ? "\n" : ""}${serialized}`);
      hash.update(bytes);
      byteSize += bytes.length;
      rowCount += 1;
      yield bytes;
    }
  }

  try {
    // pipeline propagates write failures and applies backpressure to the generator.
    await pipeline(
      Readable.from(chunks(), { objectMode: false, highWaterMark: 64 * 1024 }),
      createWriteStream(temporaryPath, {
        flags: "wx",
        highWaterMark: 64 * 1024
      })
    );
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }

  return { checksumSha256: hash.digest("hex"), rowCount, byteSize };
}
