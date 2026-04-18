import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildConstituencyMapRegions,
  findLowestAttendanceRegion,
  resolveProvinceForDistrict
} from "../../apps/web/src/lib/constituency-map.js";
import { buildDistributionMembers } from "../../apps/web/src/lib/distribution.js";

const fixturesDir = resolve(process.cwd(), "tests/fixtures/contracts");
const accountabilitySummaryFixture = JSON.parse(
  readFileSync(resolve(fixturesDir, "accountability_summary.json"), "utf8")
);
const memberActivityCalendarFixture = JSON.parse(
  readFileSync(resolve(fixturesDir, "member_activity_calendar.json"), "utf8")
);
const constituencyBoundariesIndexFixture = JSON.parse(
  readFileSync(
    resolve(fixturesDir, "constituency_boundaries_index.json"),
    "utf8"
  )
);
const busanTopologyFixture = JSON.parse(
  readFileSync(
    resolve(fixturesDir, "constituency_province_busan.topo.json"),
    "utf8"
  )
);

describe("constituency map helpers", () => {
  it("resolves a province shard from the current member district", () => {
    expect(
      resolveProvinceForDistrict(
        "부산 남구",
        constituencyBoundariesIndexFixture.provinces
      )?.provinceShortName
    ).toBe("부산");
    expect(
      resolveProvinceForDistrict(
        "서울 중구",
        constituencyBoundariesIndexFixture.provinces
      )?.provinceShortName
    ).toBe("서울");
    expect(
      resolveProvinceForDistrict(
        "제주 제주시갑",
        constituencyBoundariesIndexFixture.provinces
      )
    ).toBeNull();
  });

  it("matches district boundaries to member statistics and produces SVG paths", () => {
    const members = buildDistributionMembers(
      accountabilitySummaryFixture,
      memberActivityCalendarFixture
    );
    const regions = buildConstituencyMapRegions({
      topology: busanTopologyFixture,
      members,
      highlightedMemberIds: new Set(["M002"])
    });

    expect(regions).toHaveLength(1);
    expect(regions[0]).toMatchObject({
      districtKey: "부산남구",
      highlighted: true,
      properties: {
        memberDistrictLabel: "부산 남구"
      },
      member: {
        memberId: "M002",
        district: "부산 남구"
      }
    });
    expect(regions[0]?.path.startsWith("M")).toBe(true);
  });

  it("finds the region with the lowest attendance rate among matched regions", () => {
    const members = buildDistributionMembers(
      accountabilitySummaryFixture,
      memberActivityCalendarFixture
    );
    const regions = buildConstituencyMapRegions({
      topology: busanTopologyFixture,
      members,
      highlightedMemberIds: new Set(members.map((m) => m.memberId))
    });

    const lowest = findLowestAttendanceRegion(regions);
    expect(lowest).not.toBeNull();
    expect(lowest?.member?.memberId).toBe("M002");
  });

  it("returns null from findLowestAttendanceRegion when no regions have members", () => {
    expect(findLowestAttendanceRegion([])).toBeNull();
    expect(
      findLowestAttendanceRegion([
        {
          districtKey: "test",
          properties: {} as never,
          path: "",
          member: null,
          highlighted: false
        }
      ])
    ).toBeNull();
  });
});
