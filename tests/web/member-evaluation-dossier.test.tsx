import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import React from "react";
import { fireEvent, render, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MemberEvaluationDossier } from "../../apps/web/src/components/MemberEvaluationDossier.js";

import {
  accountabilitySummaryExportSchema,
  accountabilityTrendsExportSchema,
  billProposalActivityExportSchema,
  memberActivityCalendarExportSchema,
  memberAssetsHistoryExportSchema,
  memberAssetsIndexExportSchema
} from "@lawmaker-monitor/schemas";

const fixturesDir = resolve(import.meta.dirname, "../fixtures/contracts");

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve(fixturesDir, name), "utf8"));
}

const activity = memberActivityCalendarExportSchema.parse(
  readFixture("member_activity_calendar.json")
);
const accountability = accountabilitySummaryExportSchema.parse(
  readFixture("accountability_summary.json")
);
const trends = accountabilityTrendsExportSchema.parse(
  readFixture("accountability_trends.json")
);
const bills = billProposalActivityExportSchema.parse(
  readFixture("bill_proposal_activity.json")
);
const assets = memberAssetsIndexExportSchema.parse(
  readFixture("member_assets_index.json")
);
const assetHistory = memberAssetsHistoryExportSchema.parse(
  readFixture("member_assets_history/M001.json")
);
const member = activity.assembly.members.find(
  (candidate) => candidate.memberId === "M001"
)!;
const accountabilityItem = accountability.items.find(
  (candidate) => candidate.memberId === member.memberId
)!;
const billItem = bills.items.find(
  (candidate) => candidate.memberId === member.memberId
)!;
const assetIndex = assets.members.find(
  (candidate) => candidate.memberId === member.memberId
)!;

describe("member evaluation dossier", () => {
  it("shows neutral evidence with explicit denominators, region, and dated change records", () => {
    const { container, getAllByText, getByRole, getByText } = render(
      <MemberEvaluationDossier
        assembly={activity.assembly}
        member={member}
        accountabilityItem={accountabilityItem}
        accountabilityTrends={trends}
        billItem={billItem}
        billOutcomeDataAvailable={bills.outcomeDataAvailable}
        billDataLoaded
        assetIndex={assetIndex}
        assetHistory={assetHistory}
        voteRecords={[]}
        voteRecordCount={0}
        voteRecordsLoading={false}
        voteRecordsError={null}
        resolvedDistrict="서울 중구"
        onShare={vi.fn()}
      />
    );

    expect(getByText("서울 중구")).toBeInTheDocument();
    const evidenceGrid = container.querySelector(
      ".member-evaluation__evidence-grid"
    );
    expect(evidenceGrid).not.toBeNull();
    expect(
      within(evidenceGrid!).getByText("2 / 2 (100.0%)")
    ).toBeInTheDocument();
    expect(
      within(evidenceGrid!).getAllByText(
        "확인된 표결 2건 / 전체 대상 2건 · 확인 불가 0건"
      ).length
    ).toBeGreaterThanOrEqual(4);
    expect(
      getByText("반대 여부는 의안별 판단 기록이며 평가 점수가 아닙니다.")
    ).toBeInTheDocument();

    fireEvent.click(
      getByRole("tab", {
        name: "3. 재산·발의 기록은 어떻게 달라졌나?"
      })
    );

    expect(getAllByText(/2025년 3월 27일/).length).toBeGreaterThan(0);
    expect(getAllByText(/2025년 4월 29일/).length).toBeGreaterThan(0);
  });

  it("shows participation as unavailable when every member vote row is unresolved", () => {
    const unresolvedItem = {
      ...accountabilityItem,
      totalRecordedVotes: 537,
      noCount: 0,
      abstainCount: 0,
      absentCount: 0,
      unresolvedCount: 537,
      noRate: 0,
      abstainRate: 0,
      absentRate: 0,
      lastVoteAt: null
    };
    const { container } = render(
      <MemberEvaluationDossier
        assembly={activity.assembly}
        member={member}
        accountabilityItem={unresolvedItem}
        voteRecords={[]}
        voteRecordCount={537}
        voteRecordsLoading={false}
        voteRecordsError={null}
        resolvedDistrict="비례대표"
        onShare={vi.fn()}
      />
    );
    const evidenceGrid = container.querySelector(
      ".member-evaluation__evidence-grid"
    );

    expect(evidenceGrid).not.toBeNull();
    expect(
      within(evidenceGrid!).getAllByText("산정 불가").length
    ).toBeGreaterThanOrEqual(4);
    expect(
      within(evidenceGrid!).getByText(
        "537건 모두 의원별 표결행을 확인할 수 없습니다."
      )
    ).toBeInTheDocument();
    expect(
      within(evidenceGrid!).getByText(
        "확인 불가 537건 · 불참으로 추론하지 않음"
      )
    ).toBeInTheDocument();
    expect(within(evidenceGrid!).queryByText("0 / 537 (0.0%)")).toBeNull();
  });

  it("does not infer proportional representation when region data is missing", () => {
    const { getByText, queryByText } = render(
      <MemberEvaluationDossier
        assembly={activity.assembly}
        member={member}
        voteRecords={[]}
        voteRecordCount={0}
        voteRecordsLoading={false}
        voteRecordsError={null}
        resolvedDistrict={undefined}
        onShare={vi.fn()}
      />
    );

    expect(getByText("지역 정보 미확인")).toBeInTheDocument();
    expect(queryByText("비례대표")).not.toBeInTheDocument();
  });
});
