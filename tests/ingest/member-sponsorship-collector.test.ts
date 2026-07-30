import { describe, expect, it, vi } from "vitest";

import {
  collectMemberSponsorshipAccounts,
  extractNaverBlogId,
  extractSponsorshipAccountFromOfficialProfile,
  extractSponsorshipAccountFromNaverPost,
  parseNaverSearchCandidates,
  parseOfficialProfileCandidates,
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

const officialProfileSearchHtml = `
  <div class="fds-web-root">
    <a href="https://www.youtube.com/channel/UC_OFFICIAL">김아라TV</a>
    <p>가나다당 제22대 국회의원 김아라입니다.</p>
    <p>후원계좌와 국회의원김아라후원회 안내</p>
  </div>
  <div class="fds-web-root">
    <a href="https://www.youtube.com/channel/UC_NEWS">김아라 뉴스 모음</a>
    <p>김아라 의원 관련 뉴스를 소개합니다.</p>
  </div>
`;

const officialProfileHtml = `
  <title>김아라TV - YouTube</title>
  <meta
    name="description"
    content="가나다당 제22대 국회의원 김아라입니다. 후원계좌 농협 301-0123-4567-89 국회의원김아라후원회"
  />
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

  it("accepts a current account from an identity-matched official profile", () => {
    expect(
      parseOfficialProfileCandidates({
        html: officialProfileSearchHtml,
        memberName: "김아라",
        party: "가나다당"
      })
    ).toEqual([
      {
        url: "https://www.youtube.com/channel/UC_OFFICIAL",
        score: 17
      }
    ]);
    expect(
      extractSponsorshipAccountFromOfficialProfile({
        html: officialProfileHtml,
        memberName: "김아라",
        party: "가나다당"
      })
    ).toEqual({
      bankName: "농협",
      accountNumber: "301-0123-4567-89",
      accountHolder: "국회의원김아라후원회",
      sourcePublishedAt: null
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

  it("discovers and publishes an account from an official profile", async () => {
    const supporterWithoutHomepage = supporterListHtml.replace(
      'href="http://blog.naver.com/member_a"',
      'href=""'
    );
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const value = String(url);
      if (value.includes("supporterSearch/list.do")) {
        return new Response(supporterWithoutHomepage, { status: 200 });
      }
      if (value.includes("m.search.naver.com")) {
        return new Response(officialProfileSearchHtml, { status: 200 });
      }
      if (value === "https://www.youtube.com/channel/UC_OFFICIAL") {
        return new Response(officialProfileHtml, { status: 200 });
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

    expect(result.stats.verifiedAccounts).toBe(1);
    expect(result.exportData.accounts).toEqual([
      expect.objectContaining({
        memberId: "M001",
        status: "verified",
        bankName: "농협",
        accountNumber: "301-0123-4567-89",
        accountHolder: "국회의원김아라후원회",
        sourceUrl: "https://www.youtube.com/channel/UC_OFFICIAL"
      })
    ]);
  });

  it("retains the last verified account after a transient source failure", async () => {
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
      previousAccounts: {
        generatedAt: "2026-07-30T12:00:00.000Z",
        snapshotId: "snapshot-123:sponsorship",
        assemblyNo: 22,
        assemblyLabel: "제22대 국회",
        accounts: [
          {
            recordId: "sponsorship-M001-existing",
            memberId: "M001",
            status: "verified",
            bankName: "농협",
            accountNumber: "301-0123-4567-89",
            accountHolder: "국회의원김아라후원회",
            sourceUrl: "https://blog.naver.com/member_a/223000000001",
            verifiedAt: "2026-07-30T12:00:00.000Z"
          }
        ]
      },
      fetchImpl,
      timeoutMs: 1_000,
      concurrency: 1
    });

    expect(result.exportData.accounts).toEqual([
      expect.objectContaining({
        memberId: "M001",
        status: "verified",
        accountNumber: "301-0123-4567-89",
        verifiedAt: "2026-07-30T12:00:00.000Z"
      })
    ]);
    expect(result.warnings).toContainEqual(
      expect.stringContaining("retained the last verified sponsorship account")
    );
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
