import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  buildConstituencyBoundariesIndex,
  CONSTITUENCY_BOUNDARIES_INDEX_PATH,
  iterateConstituencyBoundaryProvinceShards
} from "../constituency-boundary-runtime.js";
import { assertPublishedJsonFileSize } from "../exports.js";
import {
  buildHexmapStaticRuntimeArtifacts,
  HEXMAP_STATIC_INDEX_PATH
} from "../hexmap-static-runtime.js";
import {
  validateConstituencyBoundariesIndexExport,
  validateHexmapStaticIndexExport,
  validateHexmapStaticProvinceArtifact
} from "../validation.js";

import type { BuildMemoryRecorder } from "../build-memory.js";
import type {
  ConstituencyBoundaryExport,
  ConstituencyBoundariesIndexProvince,
  HexmapStaticIndexProvince
} from "@lawmaker-monitor/schemas";

/** Keep only one province's topology/hexmap/string, not every province at once. */
export async function publishGeographyOutputs(args: {
  boundaryDir: string;
  outputDir: string;
  generatedAt: string;
  snapshotId: string;
  memory: BuildMemoryRecorder;
}) {
  args.memory("boundary-read:start");
  const boundaryExport = JSON.parse(
    await readFile(
      join(args.boundaryDir, "constituency_boundaries.geojson"),
      "utf8"
    )
  ) as ConstituencyBoundaryExport;
  args.memory("boundary-read:end", {
    features: boundaryExport.features.length
  });
  const boundaryProvinces: ConstituencyBoundariesIndexProvince[] = [];
  const hexmapProvinces: HexmapStaticIndexProvince[] = [];
  const write = async (path: string, content: string) => {
    assertPublishedJsonFileSize(path, content);
    const destination = join(args.outputDir, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content);
  };
  for (const shard of iterateConstituencyBoundaryProvinceShards(
    boundaryExport
  )) {
    args.memory("boundary-province:built", {
      province: boundaryProvinces.length,
      features: shard.featureCount,
      bytes: Buffer.byteLength(shard.content)
    });
    await write(shard.path, shard.content);
    const { content: _content, topology: _topology, ...metadata } = shard;
    boundaryProvinces.push(metadata);
    const hexmap = buildHexmapStaticRuntimeArtifacts({
      generatedAt: args.generatedAt,
      snapshotId: args.snapshotId,
      provinceShards: [shard]
    });
    for (const province of hexmap.provinces) {
      validateHexmapStaticProvinceArtifact(province.artifact);
      await write(province.path, province.content);
      const { content: _json, artifact: _artifact, ...entry } = province;
      hexmapProvinces.push(entry);
      args.memory("hexmap-province:written", {
        province: hexmapProvinces.length,
        cells: entry.cellCount,
        bytes: Buffer.byteLength(province.content)
      });
    }
  }
  const constituencyBoundariesIndex = validateConstituencyBoundariesIndexExport(
    buildConstituencyBoundariesIndex({
      ...args,
      boundaryExport,
      provinces: boundaryProvinces
    })
  );
  const hexmapStaticIndex = validateHexmapStaticIndexExport({
    generatedAt: args.generatedAt,
    snapshotId: args.snapshotId,
    provinces: hexmapProvinces
  });
  await write(
    CONSTITUENCY_BOUNDARIES_INDEX_PATH,
    JSON.stringify(constituencyBoundariesIndex)
  );
  await write(HEXMAP_STATIC_INDEX_PATH, JSON.stringify(hexmapStaticIndex));
  args.memory("geography:end", { provinces: boundaryProvinces.length });
  return { constituencyBoundariesIndex, hexmapStaticIndex };
}
