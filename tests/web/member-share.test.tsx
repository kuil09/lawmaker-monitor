import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MemberPerformanceShareCard } from "../../apps/web/src/components/MemberPerformanceShareCard.js";
import {
  buildMemberActivityHash,
  buildMemberActivityUrl,
  buildMemberCardImageUrl,
  buildMemberCanonicalPath,
  buildMemberCanonicalUrl,
  buildMemberShareData,
  normalizeAppBasePath
} from "../../apps/web/src/lib/member-share.js";

describe("member share URLs", () => {
  it("preserves the GitHub Pages base path in canonical URLs", () => {
    expect(normalizeAppBasePath("lawmaker-monitor")).toBe("/lawmaker-monitor/");
    expect(buildMemberCanonicalPath("M 001", "/lawmaker-monitor/")).toBe(
      "/lawmaker-monitor/members/M%20001/"
    );
    expect(
      buildMemberCanonicalUrl("M001", {
        origin: "https://kuil09.github.io",
        basePath: "/lawmaker-monitor/"
      })
    ).toBe("https://kuil09.github.io/lawmaker-monitor/members/M001/");
  });

  it("keeps hash navigation separate from the crawler-facing canonical URL", () => {
    expect(buildMemberActivityHash("M001")).toBe("#calendar?member=M001");
    expect(
      buildMemberActivityUrl("M001", {
        origin: "https://kuil09.github.io",
        basePath: "/lawmaker-monitor/"
      })
    ).toBe("https://kuil09.github.io/lawmaker-monitor/#calendar?member=M001");
  });

  it("builds the exact external card image URL", () => {
    expect(
      buildMemberCardImageUrl("M001", {
        origin: "https://kuil09.github.io",
        basePath: "/lawmaker-monitor/"
      })
    ).toBe("https://kuil09.github.io/lawmaker-monitor/member-cards/M001.png");
  });

  it("builds browser share data with party and constituency context", () => {
    expect(
      buildMemberShareData(
        {
          memberId: "M001",
          name: "김아라",
          party: "가나다당",
          district: "서울 가구"
        },
        {
          origin: "https://kuil09.github.io",
          basePath: "/lawmaker-monitor/"
        }
      )
    ).toEqual({
      title: "김아라 의원 기록 카드",
      text: "김아라 의원의 국회 활동 기록 (가나다당 · 서울 가구)",
      url: "https://kuil09.github.io/lawmaker-monitor/members/M001/"
    });
  });
});

describe("MemberPerformanceShareCard", () => {
  it("previews the generated card and copies the fragment-free member URL", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    render(
      <MemberPerformanceShareCard
        member={{
          memberId: "M001",
          name: "김아라",
          party: "가나다당",
          district: "서울 가구"
        }}
      />
    );

    expect(
      screen.getByRole("img", { name: "김아라 의원 실적 카드 미리보기" })
    ).toHaveAttribute("src", expect.stringMatching(/member-cards\/M001\.png$/));
    fireEvent.click(screen.getByRole("button", { name: "링크 복사" }));

    expect(
      await screen.findByText("의원 실적 카드 링크를 복사했습니다.")
    ).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(
      expect.stringMatching(/\/members\/M001\/$/)
    );
  });
});
