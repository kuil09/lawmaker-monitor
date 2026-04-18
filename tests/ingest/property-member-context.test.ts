import { readFileSync } from "node:fs";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConstituencyBoundaryExport } from "../../packages/schemas/src/index.js";
import {
  hexmapStaticIndexExportSchema,
  hexmapStaticProvinceArtifactSchema,
  manifestSchema,
  memberAssetsIndexExportSchema
} from "../../packages/schemas/src/index.js";

import {
  DEFAULT_PROPERTY_MEMBER_CONTEXT_MANIFEST_PATH,
  extractOfficialOpenApiJsonRows,
  loadPropertyMemberContext,
  syncPropertyMemberContextCache
} from "../../packages/ingest/src/property-member-context.js";
import {
  parseMemberHistoryRows,
  parseMemberHistoryXml,
  parseMemberInfoRows,
  parseMemberInfoXml
} from "../../packages/ingest/src/parsers.js";
import { buildData } from "../../packages/ingest/src/scripts/build-data.js";

const rawFixtureSnapshotDir = resolve(
  process.cwd(),
  "tests/fixtures/raw/fixture-snapshot-20260322-114500"
);
const propertyMirrorDir = resolve(
  process.cwd(),
  "tests/fixtures/property_mirror"
);
const xmlOfficialDir = resolve(rawFixtureSnapshotDir, "official");

let tempDirs: string[] = [];

function createBoundaryExport(): ConstituencyBoundaryExport {
  return {
    type: "FeatureCollection",
    generatedAt: "2026-03-28T07:20:49.255Z",
    lawEffectiveDate: "2026-03-19",
    lawSourceUrl: "https://law.example.test/constituencies",
    sources: [
      {
        sourceId: "law",
        title: "Official election law district table",
        sourcePageUrl: "https://law.example.test/constituencies",
        downloadUrl: "https://law.example.test/download",
        requestMethod: "GET",
        encoding: "utf-8",
        checksumSha256: "law-checksum",
        retrievedAt: "2026-03-28T07:20:49.255Z",
        rowCount: 2
      },
      {
        sourceId: "sgis-sigungu",
        title: "Official sigungu boundary bundle",
        sourcePageUrl: "https://data.example.test/sigungu",
        downloadUrl: "https://data.example.test/sigungu.zip",
        requestMethod: "GET",
        encoding: "utf-8",
        checksumSha256: "sigungu-checksum",
        retrievedAt: "2026-03-28T07:20:49.274Z",
        rowCount: 2
      }
    ],
    features: [
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
          coordinates: [
            [
              [126.98, 37.55],
              [127.04, 37.55],
              [127.04, 37.61],
              [126.98, 37.61],
              [126.98, 37.55]
            ]
          ]
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
          coordinates: [
            [
              [129.08, 35.09],
              [129.15, 35.09],
              [129.15, 35.14],
              [129.08, 35.14],
              [129.08, 35.09]
            ]
          ]
        }
      }
    ]
  };
}

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function createBuildWorkspace(): Promise<{
  rootDir: string;
  rawRoot: string;
  dataRepoDir: string;
  outputDir: string;
  boundaryDir: string;
}> {
  const rootDir = await createTempDir("lawmaker-property-context-");
  const rawRoot = join(rootDir, "fixtures");
  const dataRepoDir = join(rootDir, "published-data");
  const outputDir = join(rootDir, "build");
  const boundaryDir = join(rootDir, "boundaries");

  await mkdir(join(rawRoot, "raw"), { recursive: true });
  await cp(
    rawFixtureSnapshotDir,
    join(rawRoot, "raw", "fixture-snapshot-20260322-114500"),
    { recursive: true }
  );
  await cp(propertyMirrorDir, dataRepoDir, { recursive: true });
  await mkdir(boundaryDir, { recursive: true });
  await writeFile(
    join(boundaryDir, "constituency_boundaries.geojson"),
    JSON.stringify(createBoundaryExport(), null, 2)
  );

  return {
    rootDir,
    rawRoot,
    dataRepoDir,
    outputDir,
    boundaryDir
  };
}

afterEach(async () => {
  vi.restoreAllMocks();

  await Promise.all(
    tempDirs.map((dir) => rm(dir, { recursive: true, force: true }))
  );
  tempDirs = [];
});

describe("property member context", () => {
  it("loads cached property member context JSON and builds the tenure index", async () => {
    const context = await loadPropertyMemberContext({
      dataRepoDir: propertyMirrorDir,
      assemblyNo: 22
    });

    expect(context.manifest.assemblyNo).toBe(22);
    expect(context.currentMembers.map((member) => member.memberId)).toEqual([
      "M001",
      "M002",
      "M003"
    ]);
    expect(
      context.currentMembers.find((member) => member.memberId === "M001")
    ).toMatchObject({
      name: "김아라",
      officialExternalUrl: "https://blog.example.kr/kim-ara"
    });
    expect(context.tenureIndex.get("M001")).toEqual([
      {
        startDate: "2024-05-30",
        endDate: "2028-05-29"
      }
    ]);
  });

  it("reuses the same row normalization path for XML and JSON member context payloads", () => {
    const memberInfoXml = readFileSync(
      resolve(xmlOfficialDir, "member_info/page-1.xml"),
      "utf8"
    );
    const memberHistoryXml = readFileSync(
      resolve(xmlOfficialDir, "member_history/page-1.xml"),
      "utf8"
    );
    const memberInfoJson = JSON.parse(
      readFileSync(
        resolve(
          propertyMirrorDir,
          "raw/official/property_member_context/member_info.json"
        ),
        "utf8"
      )
    );
    const memberHistoryJson = JSON.parse(
      readFileSync(
        resolve(
          propertyMirrorDir,
          "raw/official/property_member_context/member_history.json"
        ),
        "utf8"
      )
    );

    expect(
      parseMemberInfoRows(
        extractOfficialOpenApiJsonRows(memberInfoJson, "nwvrqwxyaytdsfvhu")
      )
    ).toEqual(parseMemberInfoXml(memberInfoXml));
    expect(
      parseMemberHistoryRows(
        extractOfficialOpenApiJsonRows(memberHistoryJson, "nexgtxtmaamffofof")
      )
    ).toEqual(parseMemberHistoryXml(memberHistoryXml));
  });

  it("fails loudly when the cached JSON envelope is invalid", async () => {
    const tempDir = await createTempDir("lawmaker-property-invalid-");
    const dataRepoDir = join(tempDir, "published-data");

    await cp(propertyMirrorDir, dataRepoDir, { recursive: true });
    await writeFile(
      join(
        dataRepoDir,
        "raw/official/property_member_context/member_info.json"
      ),
      JSON.stringify(
        {
          nwvrqwxyaytdsfvhu: [
            {
              head: [{ list_total_count: "0" }]
            }
          ]
        },
        null,
        2
      )
    );

    await expect(
      loadPropertyMemberContext({
        dataRepoDir,
        assemblyNo: 22
      })
    ).rejects.toThrow(/has no row items/i);
  });

  it("fails loudly when current members are missing tenure history", async () => {
    const tempDir = await createTempDir("lawmaker-property-missing-tenure-");
    const dataRepoDir = join(tempDir, "published-data");

    await cp(propertyMirrorDir, dataRepoDir, { recursive: true });
    await writeFile(
      join(
        dataRepoDir,
        "raw/official/property_member_context/member_history.json"
      ),
      JSON.stringify(
        {
          nexgtxtmaamffofof: [
            {
              head: [{ list_total_count: "1" }]
            },
            {
              row: [
                {
                  HG_NM: "김아라",
                  FRTO_DATE: "2024.05.30 ~ 2028.05.29",
                  PROFILE_SJ: "제22대 국회의원",
                  MONA_CD: "M001",
                  UNIT_CD: "100022",
                  UNIT_NM: "제22대"
                }
              ]
            }
          ]
        },
        null,
        2
      )
    );

    await expect(
      loadPropertyMemberContext({
        dataRepoDir,
        assemblyNo: 22
      })
    ).rejects.toThrow(/missing tenure history/i);
  });

  it("syncs raw JSON payloads and writes a sanitized manifest", async () => {
    const rootDir = await createTempDir("lawmaker-property-sync-");
    const publishedDataDir = join(rootDir, "published-data");

    await mkdir(publishedDataDir, { recursive: true });

    const memberInfoPayload = JSON.parse(
      readFileSync(
        resolve(
          propertyMirrorDir,
          "raw/official/property_member_context/member_info.json"
        ),
        "utf8"
      )
    );
    const memberHistoryPayload = JSON.parse(
      readFileSync(
        resolve(
          propertyMirrorDir,
          "raw/official/property_member_context/member_history.json"
        ),
        "utf8"
      )
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);

        if (url.includes("nwvrqwxyaytdsfvhu")) {
          return new Response(JSON.stringify(memberInfoPayload), {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          });
        }

        if (url.includes("nexgtxtmaamffofof")) {
          return new Response(JSON.stringify(memberHistoryPayload), {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          });
        }

        return new Response("not found", { status: 404 });
      })
    );

    const manifest = await syncPropertyMemberContextCache({
      repositoryRoot: rootDir,
      env: {
        ASSEMBLY_API_KEY: "fixture-key",
        ASSEMBLY_FETCH_RETRIES: "0",
        ASSEMBLY_FETCH_TIMEOUT_MS: "1000",
        ASSEMBLY_PAGE_SIZE: "1000",
        DATA_REPO_DIR: "published-data"
      }
    });

    expect(manifest.assemblyNo).toBe(22);
    expect(manifest.memberInfo.sourceUrl).not.toContain("KEY=");
    expect(manifest.memberHistory.sourceUrl).not.toContain("KEY=");
    expect(manifest.memberInfo.requestParams).not.toHaveProperty("KEY");
    expect(manifest.memberHistory.requestParams).not.toHaveProperty("KEY");

    const manifestOnDisk = JSON.parse(
      await readFile(
        join(publishedDataDir, DEFAULT_PROPERTY_MEMBER_CONTEXT_MANIFEST_PATH),
        "utf8"
      )
    );
    expect(manifestOnDisk.memberInfoPath).toBe(
      "raw/official/property_member_context/member_info.json"
    );
    expect(manifestOnDisk.memberHistoryPath).toBe(
      "raw/official/property_member_context/member_history.json"
    );

    const context = await loadPropertyMemberContext({
      dataRepoDir: publishedDataDir,
      assemblyNo: 22
    });
    expect(context.currentMembers).toHaveLength(3);
  });

  it("build-data uses the property JSON cache instead of XML-derived member metadata", async () => {
    const workspace = await createBuildWorkspace();
    const memberProfileAllPath = join(
      workspace.rawRoot,
      "raw/fixture-snapshot-20260322-114500/official/member_profile_all/page-1.xml"
    );
    const originalProfileXml = await readFile(memberProfileAllPath, "utf8");

    await writeFile(
      memberProfileAllPath,
      originalProfileXml.replace(
        "https://blog.example.kr/kim-ara",
        "https://wrong.example.test/from-xml-profile"
      )
    );

    await buildData({
      repositoryRoot: workspace.rootDir,
      env: {
        RAW_DIR: workspace.rawRoot,
        DATA_REPO_DIR: workspace.dataRepoDir,
        OUTPUT_DIR: workspace.outputDir,
        CONSTITUENCY_BOUNDARIES_DIR: workspace.boundaryDir,
        DATA_REPO_BASE_URL: "https://data.example.test/lawmaker-monitor/"
      }
    });

    const memberAssetsIndex = memberAssetsIndexExportSchema.parse(
      JSON.parse(
        await readFile(
          join(workspace.outputDir, "exports/member_assets_index.json"),
          "utf8"
        )
      )
    );
    const hexmapStaticIndex = hexmapStaticIndexExportSchema.parse(
      JSON.parse(
        await readFile(
          join(workspace.outputDir, "exports/hexmap_static/index.json"),
          "utf8"
        )
      )
    );
    const seoulHexmapStaticProvince = hexmapStaticProvinceArtifactSchema.parse(
      JSON.parse(
        await readFile(
          join(
            workspace.outputDir,
            "exports/hexmap_static/provinces/서울.json"
          ),
          "utf8"
        )
      )
    );
    const manifest = manifestSchema.parse(
      JSON.parse(
        await readFile(
          join(workspace.outputDir, "manifests/latest.json"),
          "utf8"
        )
      )
    );
    const kimAra = memberAssetsIndex.members.find(
      (member) => member.memberId === "M001"
    );

    expect(kimAra?.officialExternalUrl).toBe("https://blog.example.kr/kim-ara");
    expect(hexmapStaticIndex.provinces).toHaveLength(2);
    expect(seoulHexmapStaticProvince.districts).toHaveLength(1);
    expect(seoulHexmapStaticProvince.cells.length).toBeGreaterThan(0);
    expect(manifest.exports.hexmapStaticIndex?.path).toBe(
      "exports/hexmap_static/index.json"
    );
  });

  it("build-data fails explicitly when the property member context manifest is missing", async () => {
    const workspace = await createBuildWorkspace();

    await rm(
      join(
        workspace.dataRepoDir,
        DEFAULT_PROPERTY_MEMBER_CONTEXT_MANIFEST_PATH
      ),
      { force: true }
    );

    await expect(
      buildData({
        repositoryRoot: workspace.rootDir,
        env: {
          RAW_DIR: workspace.rawRoot,
          DATA_REPO_DIR: workspace.dataRepoDir,
          OUTPUT_DIR: workspace.outputDir,
          CONSTITUENCY_BOUNDARIES_DIR: workspace.boundaryDir,
          DATA_REPO_BASE_URL: "https://data.example.test/lawmaker-monitor/"
        }
      })
    ).rejects.toThrow(/property member context manifest/i);
  });
});
