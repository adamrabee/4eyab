import { describe, expect, it } from "vitest";
import { addDays, dayOfWeek, formatHijri, isISODate, todayISO, weekStart } from "@/lib/dates";

describe("dates", () => {
  it("computes weekday and week start without timezone drift", () => {
    expect(dayOfWeek("2026-11-15")).toBe(0); // Sunday
    expect(weekStart("2026-11-19")).toBe("2026-11-15"); // Thursday → Sunday
    expect(weekStart("2026-11-15")).toBe("2026-11-15");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("uses Riyadh time for 'today'", () => {
    // 22:30 UTC on Nov 14 is already Nov 15 in Riyadh (UTC+3)
    expect(todayISO(new Date("2026-11-14T22:30:00Z"))).toBe("2026-11-15");
  });

  it("validates ISO dates", () => {
    expect(isISODate("2026-02-29")).toBe(false);
    expect(isISODate("2028-02-29")).toBe(true);
    expect(isISODate("15-11-2026")).toBe(false);
  });

  it("formats Umm al-Qura Hijri dates", () => {
    expect(formatHijri("2026-11-15")).toMatch(/١٤٤٨/);
  });
});
