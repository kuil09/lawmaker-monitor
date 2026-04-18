import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { syncPropertyMemberContextCache } from "../property-member-context.js";

async function main(): Promise<void> {
  const manifest = await syncPropertyMemberContextCache();

  console.log(
    `synced property member context for assembly ${manifest.assemblyNo} -> ${manifest.memberInfoPath}, ${manifest.memberHistoryPath}`
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void main();
}
