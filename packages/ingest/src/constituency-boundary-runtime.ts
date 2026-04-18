import { createRequire } from "node:module";

import { sha256 } from "./utils.js";

import type {
  ConstituencyBoundaryExport,
  ConstituencyBoundaryFeature,
  ConstituencyBoundariesIndexExport,
  ConstituencyBoundariesIndexProvince
} from "@lawmaker-monitor/schemas";

const require = createRequire(import.meta.url);
const topojsonServer = require("topojson-server") as {
  topology(objects: Record<string, GeoJsonFeatureCollection>): Topology;
};

type GeoJsonFeatureCollection = {
  type: "FeatureCollection";
  features: ConstituencyBoundaryFeature[];
};

type Topology = {
  type: "Topology";
  objects: Record<
    string,
    {
      type: "GeometryCollection";
      geometries: unknown[];
    }
  >;
  arcs: unknown[];
  bbox?: [number, number, number, number];
  transform?: Record<string, unknown>;
};

export type ConstituencyBoundaryProvinceShard =
  ConstituencyBoundariesIndexProvince & {
    content: string;
    topology: Topology;
  };

export type ConstituencyBoundaryRuntimeArtifacts = {
  index: ConstituencyBoundariesIndexExport;
  indexJson: string;
  shards: ConstituencyBoundaryProvinceShard[];
};

export const CONSTITUENCY_BOUNDARIES_INDEX_PATH =
  "exports/constituency_boundaries/index.json";
export const CONSTITUENCY_BOUNDARY_PROVINCES_DIR =
  "exports/constituency_boundaries/provinces";

export function buildConstituencyBoundaryProvinceShardPath(
  provinceShortName: string
): string {
  return `${CONSTITUENCY_BOUNDARY_PROVINCES_DIR}/${provinceShortName}.topo.json`;
}

function cloneFeature(
  feature: ConstituencyBoundaryFeature
): ConstituencyBoundaryFeature {
  return {
    type: "Feature",
    properties: {
      ...feature.properties,
      aliases: [...feature.properties.aliases],
      sigunguCodes: [...feature.properties.sigunguCodes],
      sigunguNames: [...feature.properties.sigunguNames],
      emdCodes: [...feature.properties.emdCodes],
      emdNames: [...feature.properties.emdNames]
    },
    geometry: JSON.parse(
      JSON.stringify(feature.geometry)
    ) as ConstituencyBoundaryFeature["geometry"]
  };
}

function buildProvinceTopology(
  features: ConstituencyBoundaryFeature[]
): Topology {
  return topojsonServer.topology({
    constituencies: {
      type: "FeatureCollection",
      features: features.map(cloneFeature)
    }
  });
}

export function buildConstituencyBoundaryRuntimeArtifacts(args: {
  boundaryExport: ConstituencyBoundaryExport;
  generatedAt: string;
  snapshotId: string;
}): ConstituencyBoundaryRuntimeArtifacts {
  const provinces = new Map<string, ConstituencyBoundaryFeature[]>();

  for (const feature of args.boundaryExport.features) {
    const provinceShortName = feature.properties.provinceShortName;
    const bucket = provinces.get(provinceShortName) ?? [];
    bucket.push(feature);
    provinces.set(provinceShortName, bucket);
  }

  const shards = [...provinces.entries()]
    .sort(([leftProvince], [rightProvince]) =>
      leftProvince.localeCompare(rightProvince, "ko")
    )
    .map(([provinceShortName, features]) => {
      const sortedFeatures = [...features].sort((left, right) =>
        left.properties.memberDistrictKey.localeCompare(
          right.properties.memberDistrictKey,
          "ko"
        )
      );
      const provinceName =
        sortedFeatures[0]?.properties.provinceName ?? provinceShortName;
      const inconsistentProvince = sortedFeatures.find(
        (feature) => feature.properties.provinceName !== provinceName
      );

      if (inconsistentProvince) {
        throw new Error(
          `Province shard ${provinceShortName} mixes province names ${provinceName} and ${inconsistentProvince.properties.provinceName}.`
        );
      }

      const path =
        buildConstituencyBoundaryProvinceShardPath(provinceShortName);
      const topology = buildProvinceTopology(sortedFeatures);
      const content = JSON.stringify(topology);

      return {
        provinceName,
        provinceShortName,
        featureCount: sortedFeatures.length,
        path,
        checksumSha256: sha256(content),
        content,
        topology
      };
    });

  const index = {
    generatedAt: args.generatedAt,
    snapshotId: args.snapshotId,
    lawEffectiveDate: args.boundaryExport.lawEffectiveDate,
    lawSourceUrl: args.boundaryExport.lawSourceUrl,
    sourceGeneratedAt: args.boundaryExport.generatedAt,
    sourceFeatureCount: args.boundaryExport.features.length,
    sources: args.boundaryExport.sources.map((source) => ({
      ...source
    })),
    provinces: shards.map(
      ({ content: _content, topology: _topology, ...province }) => province
    )
  } satisfies ConstituencyBoundariesIndexExport;

  return {
    index,
    indexJson: JSON.stringify(index),
    shards
  };
}
