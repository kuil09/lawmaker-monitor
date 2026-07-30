import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MemberSponsorshipAccount } from "../../apps/web/src/components/MemberSponsorshipAccount.js";
import { loadMemberSponsorshipAccounts } from "../../apps/web/src/lib/data.js";

import type { MemberSponsorshipAccount as Account } from "@lawmaker-monitor/schemas";

const verifiedAccount: Account = {
  recordId: "M001-2026",
  memberId: "M001",
  status: "verified",
  bankName: "국회은행",
  accountNumber: "123-456-789012",
  accountHolder: "김아라후원회",
  sourceUrl: "https://example.go.kr/members/M001/sponsorship",
  verifiedAt: "2026-07-30",
  donationUrl: "https://example.go.kr/members/M001/donate"
};

describe("MemberSponsorshipAccount", () => {
  it("copies the verified account number and full sourced record", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    render(
      <MemberSponsorshipAccount account={verifiedAccount} memberName="김아라" />
    );

    expect(screen.getByText("123-456-789012")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "계좌번호 복사" }));
    expect(
      await screen.findByText("계좌번호를 복사했습니다.")
    ).toBeInTheDocument();
    expect(writeText).toHaveBeenLastCalledWith("123-456-789012");

    fireEvent.click(
      screen.getByRole("button", { name: "계좌 정보 전체 복사" })
    );
    expect(
      await screen.findByText("계좌 정보와 공식 출처를 복사했습니다.")
    ).toBeInTheDocument();
    expect(writeText).toHaveBeenLastCalledWith(
      expect.stringContaining("국회의원: 김아라")
    );
    expect(writeText).toHaveBeenLastCalledWith(
      expect.stringContaining(
        "공식 출처: https://example.go.kr/members/M001/sponsorship"
      )
    );
    expect(
      screen.getByRole("link", { name: "공식 후원 안내" })
    ).toHaveAttribute("href", "https://example.go.kr/members/M001/donate");
  });

  it("never displays or copies an unverified account", () => {
    const account: Account = {
      recordId: "M002-review",
      memberId: "M002",
      status: "unverified",
      sourceUrl: "https://example.go.kr/members/M002/sponsorship",
      reviewedAt: "2026-07-30",
      reason: "Awaiting confirmation."
    };

    render(<MemberSponsorshipAccount account={account} memberName="박보라" />);

    expect(
      screen.getByText(
        "공식 출처와 대조 중이라 계좌번호를 표시하거나 복사하지 않습니다."
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("복사 불가")).toBeInTheDocument();
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
        "공식 후원회와 온라인 후원 경로는 확인했지만, 직접 계좌번호는 의원 공식 채널과 대조 중이라 표시하거나 복사하지 않습니다."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "공식 후원 페이지" })
    ).toHaveAttribute(
      "href",
      "https://www.give.go.kr/portal/give.do?supportNo=27002"
    );
    expect(screen.queryByText(/\d{3}-\d{4}-\d{4}/)).not.toBeInTheDocument();
  });

  it("reports clipboard permission failures through a live status", async () => {
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error("denied"))
      }
    });

    render(<MemberSponsorshipAccount account={verifiedAccount} />);
    fireEvent.click(screen.getByRole("button", { name: "계좌번호 복사" }));

    expect(
      await screen.findByText(
        "복사하지 못했습니다. 브라우저의 클립보드 권한을 확인해 주세요."
      )
    ).toHaveAttribute("role", "status");
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
        error="공식 후원계좌 정보를 불러오지 못했습니다."
        onRetry={onRetry}
      />
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "공식 후원계좌 정보를 불러오지 못했습니다."
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
