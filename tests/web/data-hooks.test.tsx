import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dataMocks = vi.hoisted(() => ({
  loadMemberActivityCalendar: vi.fn(),
  loadMemberActivityCalendarMemberDetail: vi.fn(),
  loadMemberAssetsIndex: vi.fn(),
  loadMemberAssetsHistory: vi.fn()
}));

vi.mock("../../apps/web/src/lib/data.js", () => ({
  loadMemberActivityCalendar: dataMocks.loadMemberActivityCalendar,
  loadMemberActivityCalendarMemberDetail:
    dataMocks.loadMemberActivityCalendarMemberDetail,
  loadMemberAssetsIndex: dataMocks.loadMemberAssetsIndex,
  loadMemberAssetsHistory: dataMocks.loadMemberAssetsHistory
}));

import { useActivityCalendarData } from "../../apps/web/src/hooks/useActivityCalendarData.js";
import { useMemberAssetsData } from "../../apps/web/src/hooks/useMemberAssetsData.js";

const fixturesDir = resolve(process.cwd(), "tests/fixtures/contracts");
const memberActivityCalendarFixture = JSON.parse(
  readFileSync(resolve(fixturesDir, "member_activity_calendar.json"), "utf8")
);
const memberActivityCalendarMemberDetailFixture = JSON.parse(
  readFileSync(
    resolve(fixturesDir, "member_activity_calendar_members/M001.json"),
    "utf8"
  )
);
const memberAssetsIndexFixture = JSON.parse(
  readFileSync(resolve(fixturesDir, "member_assets_index.json"), "utf8")
);
const memberAssetsHistoryFixture = JSON.parse(
  readFileSync(resolve(fixturesDir, "member_assets_history/M001.json"), "utf8")
);

describe("web data hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deduplicates concurrent member-detail requests in the activity hook", async () => {
    dataMocks.loadMemberActivityCalendar.mockResolvedValue(
      memberActivityCalendarFixture
    );
    dataMocks.loadMemberActivityCalendarMemberDetail.mockResolvedValue(
      memberActivityCalendarMemberDetailFixture
    );

    const { result } = renderHook(() =>
      useActivityCalendarData({
        manifest: null,
        shouldLoad: true
      })
    );

    await waitFor(() => {
      expect(result.current.activityCalendar).not.toBeNull();
    });

    const member = result.current.activityCalendar!.assembly.members[0]!;

    await act(async () => {
      await Promise.all([
        result.current.ensureActivityMemberDetailLoaded(member),
        result.current.ensureActivityMemberDetailLoaded(member)
      ]);
    });

    expect(
      dataMocks.loadMemberActivityCalendarMemberDetail
    ).toHaveBeenCalledTimes(1);
    expect(result.current.activityMemberDetails[member.memberId]).toEqual(
      memberActivityCalendarMemberDetailFixture
    );
  });

  it("loads activity calendar once on failure and still allows manual retry", async () => {
    dataMocks.loadMemberActivityCalendar
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(memberActivityCalendarFixture);

    const { result } = renderHook(() =>
      useActivityCalendarData({
        manifest: null,
        shouldLoad: true
      })
    );

    await waitFor(() => {
      expect(result.current.activityError).not.toBeNull();
    });

    expect(dataMocks.loadMemberActivityCalendar).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.ensureActivityCalendarLoaded();
    });

    await waitFor(() => {
      expect(result.current.activityCalendar).not.toBeNull();
    });

    expect(dataMocks.loadMemberActivityCalendar).toHaveBeenCalledTimes(2);
  });

  it("supports retrying failed member asset history fetches", async () => {
    dataMocks.loadMemberAssetsIndex.mockResolvedValue(memberAssetsIndexFixture);
    dataMocks.loadMemberAssetsHistory
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(memberAssetsHistoryFixture);

    const { result } = renderHook(() =>
      useMemberAssetsData({
        manifest: null,
        routeState: {
          route: "calendar",
          memberId: "M001",
          compareMemberId: null,
          view: "single"
        }
      })
    );

    await waitFor(() => {
      expect(result.current.memberAssetsIndex).not.toBeNull();
    });

    const member = memberActivityCalendarFixture.assembly.members[0]!;

    await act(async () => {
      await result.current.ensureMemberAssetHistoryLoaded(member);
    });

    await waitFor(() => {
      expect(
        result.current.memberAssetHistoryErrors[member.memberId]
      ).toContain("재산 공개 이력을 불러오지 못했습니다.");
    });

    await act(async () => {
      result.current.retryMemberAssetHistory(member);
    });

    await waitFor(() => {
      expect(result.current.memberAssetHistories[member.memberId]).toEqual(
        memberAssetsHistoryFixture
      );
    });

    expect(dataMocks.loadMemberAssetsHistory).toHaveBeenCalledTimes(2);
  });
});
