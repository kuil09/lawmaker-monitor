import { describe, expect, it } from "vitest";

import { formatShortDate } from "../../apps/web/src/lib/format.js";

describe("format helpers", () => {
  it("formats ISO dates and preserves unsupported values", () => {
    expect(formatShortDate("2026-08-01")).toBe("8/1");
    expect(formatShortDate("2026-08-01T12:30:00Z")).toBe("8/1");
    expect(formatShortDate("unknown")).toBe("unknown");
  });
});
