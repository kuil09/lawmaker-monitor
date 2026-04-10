import { describe, expect, it } from "vitest";

import type { ConstituencyBoundaryExport } from "../../packages/schemas/src/index.js";

import { buildConstituencyBoundaryRuntimeArtifacts } from "../../packages/ingest/src/constituency-boundary-runtime.js";
import {
  buildHexmapStaticProvinceArtifactPath,
  buildHexmapStaticRuntimeArtifacts,
  HEXMAP_STATIC_INDEX_PATH
} from "../../packages/ingest/src/hexmap-static-runtime.js";
import {
  buildManifest,
  serializePublishedJson
} from "../../packages/ingest/src/exports.js";
import { createNormalizedBundle } from "../../packages/ingest/src/normalize.js";
import { sha256 } from "../../packages/ingest/src/utils.js";
import {
  validateHexmapStaticIndexExport,
  validateHexmapStaticProvinceArtifact,
  validateManifest
} from "../../packages/ingest/src/validation.js";

function polygon(
  west: number,
  south: number,
  east: number,
  north: number
): Array<Array<[number, number]>> {
  return [[
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south]
  ]];
}

function createBoundaryExport(seoulEast = 127.04): ConstituencyBoundaryExport {
  return {
    type: "FeatureCollection",
    generatedAt: "2026-03-28T07:20:49.255Z",
    lawEffectiveDate: "2026-03-19",
    lawSourceUrl:
      "https://www.law.go.kr/lsBylInfoPLinkR.do?lsiSeq=284577&bylNo=0001&bylBrNo=00&bylCls=BE&bylEfYd=20260319&bylEfYdYn=Y",
    sources: [
      {
        sourceId: "law",
        title: "Official election law district table",
        sourcePageUrl: "https://www.law.go.kr/lsBylInfoPLinkR.do?lsiSeq=284577",
        downloadUrl: "https://www.law.go.kr/LSW/lsBylTextDownLoad.do",
        requestMethod: "POST",
        requestBody: "bylSeq=18012299&mode=0",
        encoding: "utf-8",
        checksumSha256: "law-checksum",
        retrievedAt: "2026-03-28T07:20:49.255Z",
        rowCount: 3
      },
      {
        sourceId: "sgis-sigungu",
        title: "Official sigungu boundary bundle",
        sourcePageUrl: "https://www.data.go.kr/data/15129688/fileData.do",
        downloadUrl:
          "https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000003601705",
        requestMethod: "GET",
        encoding: "utf-8",
        checksumSha256: "sigungu-checksum",
        retrievedAt: "2026-03-28T07:20:49.274Z",
        rowCount: 2
      },
      {
        sourceId: "sgis-emd",
        title: "Official administrative dong boundary bundle",
        sourcePageUrl: "https://www.data.go.kr/data/15129688/fileData.do",
        downloadUrl:
          "https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000003601705",
        requestMethod: "GET",
        encoding: "utf-8",
        checksumSha256: "emd-checksum",
        retrievedAt: "2026-03-28T07:20:49.274Z",
        rowCount: 4
      }
    ],
    features: [
      {
        type: "Feature",
        properties: {
          constituencyId: "서울종로구",
          lawDistrictName: "종로구선거구",
          districtName: "종로구",
          memberDistrictLabel: "서울 종로구",
          memberDistrictKey: "서울종로구",
          provinceName: "서울특별시",
          provinceShortName: "서울",
          areaText: "종로구 일원",
          aliases: ["서울 종로구"],
          sigunguCodes: ["11110"],
          sigunguNames: ["종로구"],
          emdCodes: ["11110101"],
          emdNames: ["사직동"]
        },
        geometry: {
          type: "Polygon",
          coordinates: polygon(126.9, 37.55, 126.98, 37.61)
        }
      },
      {
        type: "Feature",
        properties: {
          constituencyId: "서울중구",
          lawDistrictName: "중구선거구",
          districtName: "중구",
          memberDistrictLabel: "서울 중구",
          memberDistrictKey: "서울중구",
          provinceName: "서울특별시",
          provinceShortName: "서울",
          areaText: "중구 일원",
          aliases: ["서울 중구"],
          sigunguCodes: ["11140"],
          sigunguNames: ["중구"],
          emdCodes: ["11140101"],
          emdNames: ["소공동"]
        },
        geometry: {
          type: "Polygon",
          coordinates: polygon(126.98, 37.55, seoulEast, 37.61)
        }
      },
      {
        type: "Feature",
        properties: {
          constituencyId: "부산남구",
          lawDistrictName: "남구선거구",
          districtName: "남구",
          memberDistrictLabel: "부산 남구",
          memberDistrictKey: "부산남구",
          provinceName: "부산광역시",
          provinceShortName: "부산",
          areaText: "남구 일원",
          aliases: ["부산 남구"],
          sigunguCodes: ["26290"],
          sigunguNames: ["남구"],
          emdCodes: ["26290101"],
          emdNames: ["대연동"]
        },
        geometry: {
          type: "Polygon",
          coordinates: polygon(129.08, 35.1, 129.16, 35.18)
        }
      }
    ]
  };
}

function createManifestInput(hexmapStaticIndex: ReturnType<typeof validateHexmapStaticIndexExport>) {
  const bundle = createNormalizedBundle({
    members: [],
    rollCalls: [],
    voteFacts: [],
    meetings: [],
    sources: [],
    agendas: []
  });

  return validateManifest(
    buildManifest({
      bundle,
      dataRepoBaseUrl: "https://data.example.test/lawmaker-monitor/",
      currentAssembly: {
        assemblyNo: 22,
        label: "제22대 국회",
        unitCd: "100022"
      },
      latestVotes: {
        generatedAt: "2026-03-28T08:00:00.000Z",
        snapshotId: "snapshot-22",
        assemblyNo: 22,
        assemblyLabel: "제22대 국회",
        items: []
      },
      accountabilitySummary: {
        generatedAt: "2026-03-28T08:00:00.000Z",
        snapshotId: "snapshot-22",
        assemblyNo: 22,
        assemblyLabel: "제22대 국회",
        items: []
      },
      accountabilityTrends: {
        generatedAt: "2026-03-28T08:00:00.000Z",
        snapshotId: "snapshot-22",
        assemblyNo: 22,
        assemblyLabel: "제22대 국회",
        weeks: [],
        movers: []
      },
      memberActivityCalendar: {
        generatedAt: "2026-03-28T08:00:00.000Z",
        snapshotId: "snapshot-22",
        assemblyNo: 22,
        assemblyLabel: "제22대 국회",
        assembly: {
          assemblyNo: 22,
          label: "제22대 국회",
          startDate: "2026-01-01",
          endDate: "2026-12-31",
          votingDates: [],
          members: []
        }
      },
      hexmapStaticIndex
    })
  );
}

describe("hexmap static runtime artifacts", () => {
  it("builds province artifacts and wires the manifest export entry", () => {
    const boundaryRuntimeArtifacts = buildConstituencyBoundaryRuntimeArtifacts({
      boundaryExport: createBoundaryExport(),
      generatedAt: "2026-03-28T08:00:00.000Z",
      snapshotId: "snapshot-22"
    });
    const runtimeArtifacts = buildHexmapStaticRuntimeArtifacts({
      generatedAt: "2026-03-28T08:00:00.000Z",
      snapshotId: "snapshot-22",
      provinceShards: boundaryRuntimeArtifacts.shards
    });
    const index = validateHexmapStaticIndexExport(runtimeArtifacts.index);

    expect(index.provinces).toEqual([
      {
        provinceShortName: "부산",
        path: buildHexmapStaticProvinceArtifactPath("부산"),
        checksumSha256: runtimeArtifacts.provinces[0]?.checksumSha256,
        detailRes: 8,
        cellCount: runtimeArtifacts.provinces[0]?.cellCount,
        districtCount: 1
      },
      {
        provinceShortName: "서울",
        path: buildHexmapStaticProvinceArtifactPath("서울"),
        checksumSha256: runtimeArtifacts.provinces[1]?.checksumSha256,
        detailRes: 8,
        cellCount: runtimeArtifacts.provinces[1]?.cellCount,
        districtCount: 2
      }
    ]);
    expect(runtimeArtifacts.provinces[0]?.cellCount).toBeGreaterThan(0);
    expect(runtimeArtifacts.provinces[1]?.cellCount).toBeGreaterThan(0);

    const seoulProvinceArtifact = validateHexmapStaticProvinceArtifact(
      runtimeArtifacts.provinces[1]!.artifact
    );
    expect(seoulProvinceArtifact).toMatchObject({
      provinceShortName: "서울",
      detailRes: 8
    });
    expect(seoulProvinceArtifact.districts).toHaveLength(2);
    expect(seoulProvinceArtifact.cells[0]).toEqual(
      expect.objectContaining({
        h3Index: expect.any(String),
        districtKey: expect.any(String),
        districtLabel: expect.any(String),
        provinceShortName: "서울"
      })
    );

    const manifest = createManifestInput(index);
    expect(manifest.exports.hexmapStaticIndex?.path).toBe(HEXMAP_STATIC_INDEX_PATH);
    expect(manifest.exports.hexmapStaticIndex?.rowCount).toBe(2);
    expect(manifest.exports.hexmapStaticIndex?.checksumSha256).toBe(
      sha256(serializePublishedJson(index))
    );
  });

  it("changes the province checksum and manifest export checksum when the artifact content changes", () => {
    const originalBoundaryRuntimeArtifacts = buildConstituencyBoundaryRuntimeArtifacts({
      boundaryExport: createBoundaryExport(),
      generatedAt: "2026-03-28T08:00:00.000Z",
      snapshotId: "snapshot-22"
    });
    const changedBoundaryRuntimeArtifacts = buildConstituencyBoundaryRuntimeArtifacts({
      boundaryExport: createBoundaryExport(127.06),
      generatedAt: "2026-03-28T08:00:00.000Z",
      snapshotId: "snapshot-22"
    });

    const originalRuntimeArtifacts = buildHexmapStaticRuntimeArtifacts({
      generatedAt: "2026-03-28T08:00:00.000Z",
      snapshotId: "snapshot-22",
      provinceShards: originalBoundaryRuntimeArtifacts.shards
    });
    const changedRuntimeArtifacts = buildHexmapStaticRuntimeArtifacts({
      generatedAt: "2026-03-28T08:00:00.000Z",
      snapshotId: "snapshot-22",
      provinceShards: changedBoundaryRuntimeArtifacts.shards
    });

    expect(originalRuntimeArtifacts.provinces[1]?.path).toBe(
      changedRuntimeArtifacts.provinces[1]?.path
    );
    expect(originalRuntimeArtifacts.provinces[1]?.checksumSha256).not.toBe(
      changedRuntimeArtifacts.provinces[1]?.checksumSha256
    );

    const originalManifest = createManifestInput(
      validateHexmapStaticIndexExport(originalRuntimeArtifacts.index)
    );
    const changedManifest = createManifestInput(
      validateHexmapStaticIndexExport(changedRuntimeArtifacts.index)
    );

    expect(originalManifest.exports.hexmapStaticIndex?.checksumSha256).not.toBe(
      changedManifest.exports.hexmapStaticIndex?.checksumSha256
    );
  });
});
