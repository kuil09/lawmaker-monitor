import { describe, expect, it, vi } from "vitest";

import {
  collectMemberSponsorshipAccounts,
  extractNaverBlogId,
  extractSponsorshipAccountFromNaverPost,
  parseNaverSearchCandidates,
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

const naverSearchHtml = `
  <table>
    <tr>
      <td>
        <a class="s_link" href="https://blog.naver.com/member_a?Redirect=Log&logNo=223000000001">
          [후원안내] 김아라 의원 후원회
        </a>
      </td>
    </tr>
    <tr><td>후원계좌와 영수증 발급 방법을 안내합니다.</td></tr>
  </table>
`;

const naverPostHtml = `
  <span class="se_publishDate">2026. 7. 30. 10:20</span>
  <div class="se-main-container">
    <p>국회의원 김아라 후원 안내</p>
    <p>계좌 입금으로 후원하기</p>
    <p>농협 301-0123-4567-89</p>
    <p>예금주: 국회의원 김아라 후원회</p>
    <p>문의 02-1234-5678</p>
  </div>
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

  it("discovers a likely sponsorship post without accepting phone numbers", () => {
    expect(extractNaverBlogId("https://blog.naver.com/member_a")).toBe(
      "member_a"
    );
    expect(parseNaverSearchCandidates(naverSearchHtml)[0]).toMatchObject({
      logNo: "223000000001",
      score: expect.any(Number)
    });
    expect(
      extractSponsorshipAccountFromNaverPost({
        html: naverPostHtml,
        memberName: "김아라",
        supporterName: "국회의원김아라후원회"
      })
    ).toEqual({
      bankName: "농협",
      accountNumber: "301-0123-4567-89",
      accountHolder: "국회의원 김아라 후원회",
      sourcePublishedAt: "2026-07-30T10:20:00+09:00"
    });
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

  it("collects only a source-attributed current account", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const value = String(url);
      if (value.includes("supporterSearch/list.do")) {
        return new Response(supporterListHtml, { status: 200 });
      }
      if (value.includes("PostSearchList.naver")) {
        return new Response(naverSearchHtml, { status: 200 });
      }
      if (value.includes("PostView.naver")) {
        return new Response(naverPostHtml, { status: 200 });
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
      verifiedAccounts: 1,
      officialDonationOnly: 0
    });
    expect(result.exportData.accounts).toEqual([
      expect.objectContaining({
        memberId: "M001",
        status: "verified",
        bankName: "농협",
        accountNumber: "301-0123-4567-89",
        accountHolder: "국회의원 김아라 후원회",
        sourceUrl: "https://blog.naver.com/member_a/223000000001",
        donationUrl: "https://www.give.go.kr/portal/give.do?supportNo=27001"
      })
    ]);
  });

  it("does not publish an old account as verified", () => {
    const oldPost = naverPostHtml.replace(
      "2026. 7. 30. 10:20",
      "2024. 5. 1. 10:20"
    );

    expect(
      extractSponsorshipAccountFromNaverPost({
        html: oldPost,
        memberName: "김아라",
        supporterName: "국회의원김아라후원회"
      })
    ).toBeNull();
  });

  it("does not publish an undated account as verified", () => {
    const undatedPost = naverPostHtml.replace(
      '<span class="se_publishDate">2026. 7. 30. 10:20</span>',
      ""
    );

    expect(
      extractSponsorshipAccountFromNaverPost({
        html: undatedPost,
        memberName: "김아라",
        supporterName: "국회의원김아라후원회"
      })
    ).toBeNull();
  });
});
