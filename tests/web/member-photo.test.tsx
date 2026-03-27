import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MemberIdentity } from "../../apps/web/src/components/MemberIdentity.js";
import { getOptimizedMemberPhotoUrl } from "../../apps/web/src/lib/member-photo.js";

describe("member photo optimization", () => {
  it("maps Assembly full-size member photos to thumbnail variants", () => {
    expect(
      getOptimizedMemberPhotoUrl(
        "https://www.assembly.go.kr/static/portal/img/openassm/new/91fb2f6800d143f8a702091abae98326.jpg"
      )
    ).toBe(
      "https://www.assembly.go.kr/static/portal/img/openassm/new/thumb/91fb2f6800d143f8a702091abae98326.jpg"
    );
  });

  it("keeps non-thumbnail-safe photo URLs unchanged", () => {
    expect(
      getOptimizedMemberPhotoUrl(
        "https://www.assembly.go.kr/static/portal/img/openassm/new/thumb/91fb2f6800d143f8a702091abae98326.jpg"
      )
    ).toBe(
      "https://www.assembly.go.kr/static/portal/img/openassm/new/thumb/91fb2f6800d143f8a702091abae98326.jpg"
    );
    expect(
      getOptimizedMemberPhotoUrl(
        "https://www.assembly.go.kr/static/portal/img/openassm/MRS4949T.jpg"
      )
    ).toBe("https://www.assembly.go.kr/static/portal/img/openassm/MRS4949T.jpg");
    expect(getOptimizedMemberPhotoUrl("https://example.test/member.jpg")).toBe(
      "https://example.test/member.jpg"
    );
  });

  it("renders member avatars with the optimized thumbnail URL", () => {
    const { container } = render(
      <MemberIdentity
        name="김아라"
        photoUrl="https://www.assembly.go.kr/static/portal/img/openassm/new/91fb2f6800d143f8a702091abae98326.jpg"
      />
    );

    const avatar = container.querySelector("img.member-identity__avatar");

    expect(avatar?.getAttribute("src")).toBe(
      "https://www.assembly.go.kr/static/portal/img/openassm/new/thumb/91fb2f6800d143f8a702091abae98326.jpg"
    );
  });
});
