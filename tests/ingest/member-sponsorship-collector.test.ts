import { describe, expect, it, vi } from "vitest";

import {
  collectMemberSponsorshipAccounts,
  parseOfficialSupporterListPage,
  pickOfficialSupporter
} from "../../packages/ingest/src/member-sponsorship-accounts.js";

const supporterListHtml = `
  <table>
    <tbody id="listPcbody">
      <tr>
        <td>국회의원<br />(지역구)</td>
        <td>가나다당</td>
        <td>
          <a href="javascript:void(0);" onclick="pop_intro('22001');iframeOpener('layerFrm01');">
            국회의원김아라후원회
          </a>
          (02-1234-5678)
        </td>
        <td>서울특별시 가구</td>
        <td>
          <a href="http://blog.naver.com/member_a" class="btn tiny red">홈페이지</a>
          <a href="/portal/give.do?supportNo=27001" class="btn tiny">후원하기</a>
        </td>
      </tr>
    </tbody>
  </table>
  <a href="/portal/supporter/supporterSearch/list.do?pageIndex=1">1</a>
`;

describe("member sponsorship account collection", () => {
  it("parses official committee registration and donation routes", () => {
    const parsed = parseOfficialSupporterListPage(supporterListHtml);

    expect(parsed.maxPage).toBe(1);
    expect(parsed.records).toEqual([
      expect.objectContaining({
        memberName: "김아라",
        supporterName: "국회의원김아라후원회",
        party: "가나다당",
        congressNo: "22001",
        supportNo: "27001",
        homepageUrl: "https://blog.naver.com/member_a",
        donationUrl: "https://www.give.go.kr/portal/give.do?supportNo=27001"
      })
    ]);
  });

  it("does not match a same-name committee registered to another party", () => {
    const candidate = parseOfficialSupporterListPage(
      supporterListHtml.replace("가나다당", "다른당")
    ).records[0]!;

    expect(
      pickOfficialSupporter(
        {
          memberId: "M001",
          name: "김아라",
          party: "가나다당",
          district: "서울 가구",
          officialExternalUrl: null,
          officialProfileUrl: null
        },
        [candidate]
      )
    ).toBeNull();
  });

  it("publishes only the official committee and online donation route", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const value = String(url);
      if (value.includes("supporterSearch/list.do")) {
        return new Response(supporterListHtml, { status: 200 });
      }
      return new Response(null, { status: 404 });
    });

    const result = await collectMemberSponsorshipAccounts({
      members: [
        {
          memberId: "M001",
          name: "김아라",
          party: "가나다당",
          district: "서울 가구",
          officialExternalUrl: "https://blog.naver.com/member_a",
          officialProfileUrl: "https://www.assembly.go.kr/members/22nd/MEMBERA"
        }
      ],
      assemblyNo: 22,
      assemblyLabel: "제22대 국회",
      snapshotId: "snapshot-123",
      generatedAt: "2026-07-30T12:00:00.000Z",
      fetchImpl,
      timeoutMs: 1_000,
      concurrency: 1
    });

    expect(result.stats).toEqual({
      directoryMembers: 1,
      officialSupporters: 1,
      officialRoutes: 1
    });
    expect(result.exportData.accounts).toEqual([
      expect.objectContaining({
        memberId: "M001",
        status: "unverified",
        sourceUrl:
          "https://www.give.go.kr/portal/supporter/supporterSearch/congressView.do?viewType=BODY&congressNo=22001",
        donationUrl: "https://www.give.go.kr/portal/give.do?supportNo=27001"
      })
    ]);
    expect(result.exportData.accounts[0]).not.toHaveProperty("bankName");
    expect(result.exportData.accounts[0]).not.toHaveProperty("accountNumber");
    expect(result.exportData.accounts[0]).not.toHaveProperty("accountHolder");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not search external profiles for direct-deposit details", async () => {
    const supporterWithoutHomepage = supporterListHtml.replace(
      'href="http://blog.naver.com/member_a"',
      'href=""'
    );
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const value = String(url);
      if (value.includes("supporterSearch/list.do")) {
        return new Response(supporterWithoutHomepage, { status: 200 });
      }
      return new Response(null, { status: 404 });
    });

    const result = await collectMemberSponsorshipAccounts({
      members: [
        {
          memberId: "M001",
          name: "김아라",
          party: "가나다당",
          district: "서울 가구",
          officialExternalUrl: null,
          officialProfileUrl: "https://www.assembly.go.kr/members/22nd/MEMBERA"
        }
      ],
      assemblyNo: 22,
      assemblyLabel: "제22대 국회",
      snapshotId: "snapshot-123",
      generatedAt: "2026-07-30T12:00:00.000Z",
      fetchImpl,
      timeoutMs: 1_000,
      concurrency: 1
    });

    expect(result.stats.officialRoutes).toBe(1);
    expect(result.exportData.accounts).toEqual([
      expect.objectContaining({
        memberId: "M001",
        status: "unverified",
        donationUrl: "https://www.give.go.kr/portal/give.do?supportNo=27001"
      })
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("never follows or republishes non-NEC homepage URLs", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const value = String(url);
      if (value.includes("supporterSearch/list.do")) {
        return new Response(supporterListHtml, { status: 200 });
      }
      throw new TypeError("fetch failed");
    });

    const result = await collectMemberSponsorshipAccounts({
      members: [
        {
          memberId: "M001",
          name: "김아라",
          party: "가나다당",
          district: "서울 가구",
          officialExternalUrl: "https://blog.naver.com/member_a",
          officialProfileUrl: "https://www.assembly.go.kr/members/22nd/MEMBERA"
        }
      ],
      assemblyNo: 22,
      assemblyLabel: "제22대 국회",
      snapshotId: "snapshot-124",
      generatedAt: "2026-07-31T12:00:00.000Z",
      fetchImpl,
      timeoutMs: 1_000,
      concurrency: 1
    });

    expect(result.exportData.accounts).toEqual([
      expect.objectContaining({
        memberId: "M001",
        status: "unverified",
        donationUrl: "https://www.give.go.kr/portal/give.do?supportNo=27001"
      })
    ]);
    expect(result.exportData.accounts[0]).not.toHaveProperty("accountNumber");
    expect(result.exportData.accounts[0]?.sourceUrl).not.toContain(
      "blog.naver.com"
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.warnings).toEqual([]);
  });
});
