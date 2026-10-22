import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

// Run after Parquet materialization; checksums describe the published bytes.
const root = resolve(process.argv[2] ?? "artifacts/build");
const path = join(root, "manifests/latest.json");
const manifest = JSON.parse(await readFile(path, "utf8"));
for (const file of Object.values(manifest.datasets)) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(join(root, file.path))) {
    hash.update(chunk);
  }
  file.checksumSha256 = hash.digest("hex");
}
await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
