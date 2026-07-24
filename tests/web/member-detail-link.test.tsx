import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MemberDetailLink } from "../../apps/web/src/components/MemberDetailLink.js";

describe("MemberDetailLink", () => {
  it("provides a direct detail href and supports routed navigation", () => {
    const onNavigate = vi.fn();

    render(
      <MemberDetailLink memberId="M001" name="김아라" onNavigate={onNavigate} />
    );

    const link = screen.getByRole("link", {
      name: "김아라 의원 상세 보기"
    });
    expect(link).toHaveAttribute("href", "#calendar?member=M001");

    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledWith("M001");
  });
});
