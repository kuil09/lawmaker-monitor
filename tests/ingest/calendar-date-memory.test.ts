import { describe, expect, it, vi } from "vitest";

import { toKoreanDateKey } from "../../packages/ingest/src/exports.js";

describe("Korean calendar date formatting", () => {
  it.each([
    ["2026-08-20T14:59:59Z", "2026-08-20"],
    ["2026-08-20T15:00:00Z", "2026-08-21"],
    ["2026-08-20T00:00:00+09:00", "2026-08-20"],
    ["2024-02-29T15:00:00Z", "2024-03-01"],
    ["2026-08-20", "2026-08-20"],
    ["invalid-date", "invalid-da"]
  ])("keeps existing day-key semantics for %s", (input, expected) => {
    expect(toKoreanDateKey(input)).toBe(expected);
  });

  it("never constructs an ICU formatter per row", () => {
    const formatter = vi.spyOn(Intl, "DateTimeFormat");
    try {
      for (let index = 0; index < 10000; index += 1) {
        expect(toKoreanDateKey("2026-08-20T15:00:00Z")).toBe("2026-08-21");
      }
      expect(formatter).not.toHaveBeenCalled();
    } finally {
      formatter.mockRestore();
    }
  });
});
