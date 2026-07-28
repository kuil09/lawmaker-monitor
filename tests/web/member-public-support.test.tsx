import React from "react";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MemberPublicSupportSection } from "../../apps/web/src/components/MemberPublicSupportSection.js";
import {
  buildMemberPublicSupportModel,
  formatWonExact
} from "../../apps/web/src/lib/member-public-support.js";

describe("member public support model", () => {
  it("calculates the annual staff base-pay estimate from the official quota", () => {
    const model = buildMemberPublicSupportModel();

    expect(model.staffHeadcount).toBe(8);
    expect(model.monthlyStaffBaseEstimateWon).toBe(33_569_400);
    expect(model.annualStaffBaseEstimateWon).toBe(402_832_800);
    expect(
      model.staffGrades.reduce((sum, grade) => sum + grade.annualAmountWon, 0)
    ).toBe(model.annualStaffBaseEstimateWon);
  });

  it("formats Korean won without losing the remainder", () => {
    expect(formatWonExact(402_832_800)).toBe("4억 283만 2,800원");
    expect(formatWonExact(33_569_400)).toBe("3,356만 9,400원");
  });
});

describe("member public support section", () => {
  it("separates estimates, statutory items, unavailable execution, and shared costs", () => {
    render(<MemberPublicSupportSection memberName="홍길동" />);

    expect(
      screen.getByRole("region", { name: "공적 지원 현황" })
    ).toBeInTheDocument();
    expect(screen.getByText("4억 283만 2,800원")).toBeInTheDocument();
    expect(screen.getByText("실제 의원실 집행액 아님")).toBeInTheDocument();
    expect(screen.getByText("개인별 집행 미확보")).toBeInTheDocument();
    expect(screen.getAllByText("개인 배분 제외")).toHaveLength(2);
    expect(
      screen.getByRole("link", { name: "2026년 일반직공무원 봉급표" })
    ).toHaveAttribute(
      "href",
      "https://www.mpm.go.kr/mpm/info/resultPay/bizSalary/2026/"
    );
  });
});
