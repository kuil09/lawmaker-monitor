import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MemberSponsorshipAccount } from "../../apps/web/src/components/MemberSponsorshipAccount.js";
import { loadMemberSponsorshipAccounts } from "../../apps/web/src/lib/data.js";

import {
  memberSponsorshipAccountsExportSchema,
  type MemberSponsorshipAccount as Account
} from "@lawmaker-monitor/schemas";

const verifiedAccount = memberSponsorshipAccountsExportSchema.parse({
  generatedAt: "2026-07-30T10:00:00.000Z",
  snapshotId: "sponsorship-20260730",
  assemblyNo: 22,
  assemblyLabel: "제22대 국회",
  accounts: [
    {
      recordId: "M001-2026",
      memberId: "M001",
      status: "verified",
      bankName: "국회은행",
      accountNumber: "123-456-789012",
      accountHolder: "김아라후원회",
      sourceUrl: "https://example.go.kr/members/M001/sponsorship",
      verifiedAt: "2026-07-30",
      donationUrl: "https://www.give.go.kr/portal/give.do?supportNo=27001"
    }
  ]
}).accounts[0]!;

describe("MemberSponsorshipAccount", () => {
  it("never exposes direct-deposit details from a legacy verified record", () => {
    render(
      <MemberSponsorshipAccount account={verifiedAccount} memberName="김아라" />
    );

    expect(screen.queryByText("123-456-789012")).not.toBeInTheDocument();
    expect(screen.queryByText("국회은행")).not.toBeInTheDocument();
    expect(screen.queryByText("김아라후원회")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("공식 링크 확인")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "중앙선관위 공식 온라인 후원" })
    ).toHaveAttribute(
      "href",
      "https://www.give.go.kr/portal/give.do?supportNo=27001"
    );
  });

  it("links to the NEC directory when only registration information exists", () => {
    const account: Account = {
      recordId: "M002-review",
      memberId: "M002",
      status: "unverified",
      sourceUrl:
        "https://www.give.go.kr/portal/supporter/supporterSearch/congressView.do?congressNo=22002",
      reviewedAt: "2026-07-30",
      reason: "Awaiting confirmation."
    };

    render(<MemberSponsorshipAccount account={account} memberName="박보라" />);

    expect(
      screen.getByText(
        "중앙선관위 정치후원금센터의 등록 정보에서 최신 후원 방법을 확인해 주세요."
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("등록 정보 확인")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "중앙선관위 후원회 등록 정보" })
    ).toHaveAttribute(
      "href",
      "https://www.give.go.kr/portal/supporter/supporterSearch/congressView.do?congressNo=22002"
    );
  });

  it("keeps the official online donation route visible while direct account verification is pending", () => {
    const account: Account = {
      recordId: "M002-review",
      memberId: "M002",
      status: "unverified",
      sourceUrl: "https://www.give.go.kr/official/M002",
      reviewedAt: "2026-07-30",
      reason: "A direct account was not found on a current official page.",
      donationUrl: "https://www.give.go.kr/portal/give.do?supportNo=27002"
    };

    render(<MemberSponsorshipAccount account={account} memberName="박보라" />);

    expect(
      screen.getByText(
        "중앙선관위 정치후원금센터에서 공식 등록 후원회와 온라인 후원 경로를 확인할 수 있습니다."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "중앙선관위 공식 온라인 후원" })
    ).toHaveAttribute(
      "href",
      "https://www.give.go.kr/portal/give.do?supportNo=27002"
    );
    expect(screen.queryByText(/\d{3}-\d{4}-\d{4}/)).not.toBeInTheDocument();
  });

  it("does not expose superseded sponsorship routes", () => {
    const account: Account = {
      recordId: "M003-old",
      memberId: "M003",
      status: "superseded",
      sourceUrl: "https://www.give.go.kr/portal/give.do?supportNo=27003",
      verifiedAt: "2026-06-01",
      supersededAt: "2026-07-01",
      supersededReason: "The official route was replaced.",
      donationUrl: "https://www.give.go.kr/portal/give.do?supportNo=27003"
    };

    render(<MemberSponsorshipAccount account={account} memberName="최초록" />);

    expect(
      screen.getByRole("link", { name: "중앙선관위 후원회 찾기" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "중앙선관위 공식 온라인 후원" })
    ).not.toBeInTheDocument();
  });

  it("links to the official donation center when no account is published", () => {
    render(<MemberSponsorshipAccount memberName="이의원" />);

    expect(
      screen.getByRole("link", { name: "중앙선관위 후원회 찾기" })
    ).toHaveAttribute(
      "href",
      "https://www.give.go.kr/portal/supporter/supporterSearch/list.do?menuNo=200025"
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("separates a load failure from an unpublished account and retries", () => {
    const onRetry = vi.fn();

    render(
      <MemberSponsorshipAccount
        memberName="이의원"
        error="공식 후원 링크를 불러오지 못했습니다."
        onRetry={onRetry}
      />
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "공식 후원 링크를 불러오지 못했습니다."
    );
    fireEvent.click(screen.getByRole("button", { name: "다시 확인" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe("loadMemberSponsorshipAccounts", () => {
  it("loads the optional default export with strict validation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          generatedAt: "2026-07-30T10:00:00.000Z",
          snapshotId: "sponsorship-20260730",
          assemblyNo: 22,
          assemblyLabel: "제22대 국회",
          accounts: [verifiedAccount]
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await loadMemberSponsorshipAccounts();

    expect(result?.accounts).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/exports\/member_sponsorship_accounts\.json$/)
    );
  });

  it("returns null when the optional export is not published", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 404 }))
    );

    await expect(loadMemberSponsorshipAccounts()).resolves.toBeNull();
  });
});
