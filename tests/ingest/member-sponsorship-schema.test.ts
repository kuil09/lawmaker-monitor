import { describe, expect, it } from "vitest";

import {
  memberSponsorshipAccountsExportSchema,
  type MemberSponsorshipAccountsExport
} from "../../packages/schemas/src/index.js";

function buildExport(
  accounts: MemberSponsorshipAccountsExport["accounts"]
): unknown {
  return {
    generatedAt: "2026-07-30T10:00:00.000Z",
    snapshotId: "sponsorship-20260730",
    assemblyNo: 22,
    assemblyLabel: "제22대 국회",
    accounts
  };
}

describe("memberSponsorshipAccountsExportSchema", () => {
  it("accepts a fully sourced verified account", () => {
    const payload = memberSponsorshipAccountsExportSchema.parse(
      buildExport([
        {
          recordId: "M001-2026",
          memberId: "M001",
          status: "verified",
          bankName: "국회은행",
          accountNumber: "123-456-789012",
          accountHolder: "김아라후원회",
          sourceUrl: "https://example.go.kr/members/M001/sponsorship",
          verifiedAt: "2026-07-30",
          donationUrl: "https://example.go.kr/members/M001/donate"
        }
      ])
    );

    expect(payload.accounts[0]).toMatchObject({
      memberId: "M001",
      status: "verified",
      verifiedAt: "2026-07-30"
    });
  });

  it("keeps unverified records free of account details", () => {
    const result = memberSponsorshipAccountsExportSchema.safeParse(
      buildExport([
        {
          recordId: "M001-review",
          memberId: "M001",
          status: "unverified",
          sourceUrl: "https://example.go.kr/members/M001/sponsorship",
          reviewedAt: "2026-07-30",
          reason: "The source is awaiting a second official confirmation.",
          accountNumber: "123-456-789012"
        }
      ])
    );

    expect(result.success).toBe(false);
  });

  it("retains superseded records for audit without treating them as current", () => {
    const payload = memberSponsorshipAccountsExportSchema.parse(
      buildExport([
        {
          recordId: "M001-2025",
          memberId: "M001",
          status: "superseded",
          bankName: "국회은행",
          accountNumber: "111-222-333333",
          accountHolder: "김아라후원회",
          sourceUrl: "https://example.go.kr/members/M001/archive",
          verifiedAt: "2025-01-02",
          supersededAt: "2026-01-02",
          supersededReason: "A new official account was published.",
          replacedByRecordId: "M001-2026"
        }
      ])
    );

    expect(payload.accounts[0]?.status).toBe("superseded");
  });

  it("rejects multiple current verified accounts for one member", () => {
    const verifiedAccount = {
      memberId: "M001",
      status: "verified" as const,
      bankName: "국회은행",
      accountNumber: "123-456-789012",
      accountHolder: "김아라후원회",
      sourceUrl: "https://example.go.kr/members/M001/sponsorship",
      verifiedAt: "2026-07-30"
    };
    const result = memberSponsorshipAccountsExportSchema.safeParse(
      buildExport([
        { ...verifiedAccount, recordId: "M001-a" },
        { ...verifiedAccount, recordId: "M001-b" }
      ])
    );

    expect(result.success).toBe(false);
  });

  it("requires an explicit accounts list and ISO verification dates", () => {
    expect(
      memberSponsorshipAccountsExportSchema.safeParse({
        generatedAt: "2026-07-30T10:00:00.000Z",
        snapshotId: "sponsorship-20260730",
        assemblyNo: 22,
        assemblyLabel: "제22대 국회"
      }).success
    ).toBe(false);

    expect(
      memberSponsorshipAccountsExportSchema.safeParse(
        buildExport([
          {
            recordId: "M001-2026",
            memberId: "M001",
            status: "verified",
            bankName: "국회은행",
            accountNumber: "123-456-789012",
            accountHolder: "김아라후원회",
            sourceUrl: "https://example.go.kr/members/M001/sponsorship",
            verifiedAt: "July 30, 2026"
          }
        ])
      ).success
    ).toBe(false);
  });

  it("rejects unsafe source schemes, future reviews, and duplicate records", () => {
    const unsafeUrl = memberSponsorshipAccountsExportSchema.safeParse(
      buildExport([
        {
          recordId: "M001-unsafe",
          memberId: "M001",
          status: "unverified",
          sourceUrl: "javascript:alert(1)",
          reviewedAt: "2026-07-30",
          reason: "Unsafe URL fixture."
        }
      ])
    );
    const futureReview = memberSponsorshipAccountsExportSchema.safeParse(
      buildExport([
        {
          recordId: "M001-future",
          memberId: "M001",
          status: "unverified",
          sourceUrl: "https://example.go.kr/members/M001/sponsorship",
          reviewedAt: "2026-08-01",
          reason: "Future review fixture."
        }
      ])
    );
    const duplicateRecord = {
      recordId: "M001-duplicate",
      memberId: "M001",
      status: "unverified" as const,
      sourceUrl: "https://example.go.kr/members/M001/sponsorship",
      reviewedAt: "2026-07-30",
      reason: "Duplicate record fixture."
    };
    const duplicates = memberSponsorshipAccountsExportSchema.safeParse(
      buildExport([duplicateRecord, duplicateRecord])
    );

    expect(unsafeUrl.success).toBe(false);
    expect(futureReview.success).toBe(false);
    expect(duplicates.success).toBe(false);
  });
});
