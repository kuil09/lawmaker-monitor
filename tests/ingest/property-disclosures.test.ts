import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildPropertyDisclosureArtifacts,
  extractLawmakerLines,
  parsePropertyDisclosureSummary
} from "../../packages/ingest/src/property-disclosures.js";
import { loadPropertyMemberContext } from "../../packages/ingest/src/property-member-context.js";
const propertyMirrorDir = resolve(process.cwd(), "tests/fixtures/property_mirror");

async function loadCurrentFixtureMembers() {
  return loadPropertyMemberContext({
    dataRepoDir: propertyMirrorDir,
    assemblyNo: 22
  });
}

describe("property disclosure pipeline", () => {
  it("supports multiline total summaries and skips files without a lawmaker section", () => {
    expect(
      parsePropertyDisclosureSummary(
        [
          "▶ 고지거부 및 등록제외사항 - - - -",
          "장남 고지거부 0 0 0 0 독립생계유지",
          "증감액: 80,579천원",
          "총 계 2,551,815 176,881 96,302 2,632,394",
          "(가액변동: -19,261천원)"
        ],
        3
      )
    ).toMatchObject({
      previousAmount: 2551815,
      increaseAmount: 176881,
      decreaseAmount: 96302,
      currentAmount: 2632394,
      deltaAmount: 80579,
      valueChangeAmount: -19261,
      consumed: 2
    });

    expect(
      extractLawmakerLines([
        { pageNumber: 1, text: "국 회 공 보" },
        { pageNumber: 1, text: "1. 신규 재산등록사항 공개목록" },
        { pageNumber: 1, text: "소속 국회 직위 정책연구위원 성명 박성은" }
      ])
    ).toEqual([]);

    expect(
      extractLawmakerLines([
        { pageNumber: 1, text: "1. 국회의원" },
        { pageNumber: 1, text: "소속 국회 직위 국회의원 성명 김기웅" },
        { pageNumber: 1, text: "경기도 남양주시 다산동 다산안강럭스나인 대지 4.27㎡ 중" },
        { pageNumber: 1, text: "2.14㎡ 건물 19.66㎡ 중 9.83㎡" },
        { pageNumber: 2, text: "2. 법원공무원" },
        { pageNumber: 2, text: "소속 법원 직위 법관 성명 홍길동" }
      ]).map((line) => line.text)
    ).toEqual([
      "소속 국회 직위 국회의원 성명 김기웅",
      "경기도 남양주시 다산동 다산안강럭스나인 대지 4.27㎡ 중",
      "2.14㎡ 건물 19.66㎡ 중 9.83㎡"
    ]);
  });

  it("parses mirrored property disclosure PDFs into file, record, category, and item rows", async () => {
    const { currentMembers, tenureIndex } = await loadCurrentFixtureMembers();
    const artifacts = await buildPropertyDisclosureArtifacts({
      assemblyLabel: "제22대 국회",
      assemblyNo: 22,
      currentMembers,
      dataRepoDir: propertyMirrorDir,
      generatedAt: "2025-04-29T00:00:00.000Z",
      snapshotId: "fixture-snapshot-20260322-114500",
      tenureIndex
    });

    expect(artifacts.files).toHaveLength(2);
    expect(artifacts.records).toHaveLength(4);
    expect(artifacts.categories).toHaveLength(9);
    expect(artifacts.items).toHaveLength(9);

    expect(artifacts.files.map((file) => file.fileSeq)).toEqual([10001706, 10001707]);
    expect(
      artifacts.records.map((record) => ({
        name: record.disclosureName,
        reportedAt: record.reportedAt,
        memberId: record.memberId
      }))
    ).toEqual([
      { name: "김아라", reportedAt: "2025-03-27", memberId: "M001" },
      { name: "박민", reportedAt: "2025-03-27", memberId: "M002" },
      { name: "김아라", reportedAt: "2025-04-29", memberId: "M001" },
      { name: "박민", reportedAt: "2025-04-29", memberId: "M002" }
    ]);

    const regularKimAra = artifacts.records.find(
      (record) => record.disclosureName === "김아라" && record.reportedAt === "2025-03-27"
    );
    expect(regularKimAra).toMatchObject({
      pageStart: 1,
      pageEnd: 2,
      currentAmount: 790000,
      deltaAmount: 40000,
      valueChangeAmount: 10000
    });

    const depositCategory = artifacts.categories.find(
      (category) =>
        category.disclosureRecordId === regularKimAra?.disclosureRecordId &&
        category.categoryLabel === "예금"
    );
    expect(depositCategory).toMatchObject({
      currentAmount: 220000,
      increaseAmount: 30000,
      decreaseAmount: 10000
    });

    const depositItem = artifacts.items.find(
      (item) =>
        item.disclosureRecordId === regularKimAra?.disclosureRecordId &&
        item.categoryOrder === depositCategory?.categoryOrder
    );
    expect(depositItem).toMatchObject({
      relation: "본인",
      assetTypeLabel: "국민은행",
      currentAmount: 220000,
      reasonText: "급여저축 등"
    });
  });

  it("builds current-member asset history exports from the parsed disclosures", async () => {
    const { currentMembers, tenureIndex } = await loadCurrentFixtureMembers();
    const artifacts = await buildPropertyDisclosureArtifacts({
      assemblyLabel: "제22대 국회",
      assemblyNo: 22,
      currentMembers,
      dataRepoDir: propertyMirrorDir,
      generatedAt: "2025-04-29T00:00:00.000Z",
      snapshotId: "fixture-snapshot-20260322-114500",
      tenureIndex
    });

    expect(artifacts.memberAssetsIndex.members).toHaveLength(2);
    expect(artifacts.memberAssetsIndex.members[0]).toMatchObject({
      memberId: "M001",
      latestTotal: 820000,
      latestRealEstateTotal: 510000,
      totalDelta: 30000,
      historyPath: "exports/member_assets_history/M001.json"
    });

    const kimAraHistory = artifacts.memberAssetsHistory.find((item) => item.memberId === "M001");
    expect(kimAraHistory?.series).toHaveLength(2);
    expect(kimAraHistory?.series[0]).toMatchObject({
      reportedAt: "2025-03-27",
      currentAmount: 790000
    });
    expect(kimAraHistory?.series[1]).toMatchObject({
      reportedAt: "2025-04-29",
      currentAmount: 820000
    });
    expect(kimAraHistory?.selfOnly?.series).toHaveLength(2);
    expect(kimAraHistory?.selfOnly?.series[0]).toMatchObject({
      reportedAt: "2025-03-27",
      currentAmount: 730000
    });
    expect(kimAraHistory?.selfOnly?.series[1]).toMatchObject({
      reportedAt: "2025-04-29",
      currentAmount: 760000
    });
    expect(
      kimAraHistory?.categorySeries.map((series) => series.categoryLabel)
    ).toEqual(["예금", "건물", "증권"]);
    expect(
      kimAraHistory?.selfOnly?.categorySeries.map((series) => series.categoryLabel)
    ).toEqual(["예금", "건물"]);

    const parkMinHistory = artifacts.memberAssetsHistory.find((item) => item.memberId === "M002");
    expect(parkMinHistory?.selfOnly?.latestSummary).toMatchObject({
      currentAmount: 360000,
      deltaAmount: 10000
    });
  });
});
