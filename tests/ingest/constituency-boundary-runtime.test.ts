import { describe, expect, it } from "vitest";

import type { ConstituencyBoundaryExport } from "../../packages/schemas/src/index.js";

import {
  buildConstituencyBoundaryProvinceShardPath,
  buildConstituencyBoundaryRuntimeArtifacts,
  CONSTITUENCY_BOUNDARIES_INDEX_PATH
} from "../../packages/ingest/src/constituency-boundary-runtime.js";
import {
  assertPublishedJsonFileSize,
  buildManifest,
  serializePublishedJson
} from "../../packages/ingest/src/exports.js";
import { createNormalizedBundle } from "../../packages/ingest/src/normalize.js";
import { sha256 } from "../../packages/ingest/src/utils.js";
import {
  validateConstituencyBoundariesIndexExport,
  validateManifest
} from "../../packages/ingest/src/validation.js";

function polygon(
  west: number,
  south: number,
  east: number,
  north: number
): Array<Array<[number, number]>> {
  return [
    [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south]
    ]
  ];
}

function createBoundaryExport(): ConstituencyBoundaryExport {
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
          coordinates: polygon(126.98, 37.55, 127.04, 37.61)
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

describe("constituency boundary runtime artifacts", () => {
  it("builds province shards and wires the manifest export entry", () => {
    const runtimeArtifacts = buildConstituencyBoundaryRuntimeArtifacts({
      boundaryExport: createBoundaryExport(),
      generatedAt: "2026-03-28T08:00:00.000Z",
      snapshotId: "snapshot-22"
    });
    const index = validateConstituencyBoundariesIndexExport(
      runtimeArtifacts.index
    );

    expect(index.provinces).toEqual([
      {
        provinceName: "부산광역시",
        provinceShortName: "부산",
        featureCount: 1,
        path: buildConstituencyBoundaryProvinceShardPath("부산"),
        checksumSha256: runtimeArtifacts.shards[0]?.checksumSha256
      },
      {
        provinceName: "서울특별시",
        provinceShortName: "서울",
        featureCount: 2,
        path: buildConstituencyBoundaryProvinceShardPath("서울"),
        checksumSha256: runtimeArtifacts.shards[1]?.checksumSha256
      }
    ]);
    expect(
      JSON.parse(runtimeArtifacts.shards[1]?.content ?? "{}")
    ).toMatchObject({
      type: "Topology",
      objects: {
        constituencies: {
          type: "GeometryCollection",
          geometries: expect.arrayContaining([
            expect.objectContaining({
              properties: expect.objectContaining({
                memberDistrictKey: "서울종로구"
              })
            })
          ])
        }
      }
    });

    const bundle = createNormalizedBundle({
      members: [],
      rollCalls: [],
      voteFacts: [],
      meetings: [],
      sources: [],
      agendas: []
    });
    const manifest = validateManifest(
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
        constituencyBoundariesIndex: index
      })
    );

    expect(manifest.exports.constituencyBoundariesIndex?.path).toBe(
      CONSTITUENCY_BOUNDARIES_INDEX_PATH
    );
    expect(manifest.exports.constituencyBoundariesIndex?.rowCount).toBe(2);
    expect(manifest.exports.constituencyBoundariesIndex?.checksumSha256).toBe(
      sha256(serializePublishedJson(index))
    );
  });

  it("keeps the published boundary index and shards under the JSON size guard", () => {
    const runtimeArtifacts = buildConstituencyBoundaryRuntimeArtifacts({
      boundaryExport: createBoundaryExport(),
      generatedAt: "2026-03-28T08:00:00.000Z",
      snapshotId: "snapshot-22"
    });

    expect(() =>
      assertPublishedJsonFileSize(
        CONSTITUENCY_BOUNDARIES_INDEX_PATH,
        runtimeArtifacts.indexJson
      )
    ).not.toThrow();
    for (const shard of runtimeArtifacts.shards) {
      expect(() =>
        assertPublishedJsonFileSize(shard.path, shard.content)
      ).not.toThrow();
    }
  });
});
