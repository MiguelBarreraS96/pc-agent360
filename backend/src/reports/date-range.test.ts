import { isApiError } from "../errors";

import { parseDateRange, todayInBogota } from "./date-range";

describe("parseDateRange", () => {
  it("converts desde/hasta into a half-open Bogotá range (inclusive start, exclusive day-after end)", () => {
    const range = parseDateRange("2026-09-01", "2026-09-25");

    expect(range.from.toISOString()).toBe("2026-09-01T05:00:00.000Z");
    expect(range.to.toISOString()).toBe("2026-09-26T05:00:00.000Z");
    expect(range.desde).toBe("2026-09-01");
    expect(range.hasta).toBe("2026-09-25");
  });

  it("accepts a single-day range", () => {
    const range = parseDateRange("2026-09-25", "2026-09-25");

    expect(range.to.getTime() - range.from.getTime()).toBe(24 * 60 * 60 * 1_000);
  });

  it("rejects desde after hasta", () => {
    expect.assertions(2);
    try {
      parseDateRange("2026-09-25", "2026-09-01");
    } catch (error: unknown) {
      expect(isApiError(error)).toBe(true);
      expect(isApiError(error) && error.status).toBe(400);
    }
  });

  it("rejects a hasta date in the future relative to Bogotá", () => {
    const today = todayInBogota();
    const parts = today.split("-").map(Number) as [number, number, number];
    const tomorrow = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + 1)).toISOString().slice(0, 10);

    expect.assertions(1);
    try {
      parseDateRange(today, tomorrow);
    } catch (error: unknown) {
      expect(isApiError(error)).toBe(true);
    }
  });

  it("rejects a range spanning more than 366 days", () => {
    expect.assertions(1);
    try {
      parseDateRange("2025-01-01", "2026-01-03");
    } catch (error: unknown) {
      expect(isApiError(error)).toBe(true);
    }
  });

  it("accepts a range of exactly 366 days", () => {
    const range = parseDateRange("2025-01-01", "2026-01-01");

    expect(range.to.getTime() - range.from.getTime()).toBe(366 * 24 * 60 * 60 * 1_000);
  });

  it.each(["2026-02-30", "2026-13-01", "2026-00-10", "26-09-25", "2026/09/25", ""])(
    "rejects an invalid calendar date %j",
    (invalidDate) => {
      expect.assertions(1);
      try {
        parseDateRange(invalidDate, "2026-09-25");
      } catch (error: unknown) {
        expect(isApiError(error)).toBe(true);
      }
    },
  );
});
