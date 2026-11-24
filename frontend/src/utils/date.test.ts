import { describe, expect, it } from "vitest";
import {
  addDays, formatDate, formatDateOnly, formatDateTime, parseDateOnly, startOfWeek, todayISO, weekdayIndex,
} from "./date";

const at = (iso: string) => new Date(iso);

describe("todayISO (Asia/Kolkata)", () => {
  it.each([
    ["2026-11-18T20:00:00Z", "2026-11-19"], // 01:30 IST next day: classic off-by-one
    ["2026-11-18T18:29:59Z", "2026-11-18"], // 23:59:59 IST
    ["2026-11-18T18:30:00Z", "2026-11-19"], // 00:00:00 IST
    ["2026-12-31T19:00:00Z", "2027-01-01"], // year boundary
    ["2028-02-28T19:00:00Z", "2028-02-29"], // leap day
  ])("%s -> %s", (utc, expected) => {
    expect(todayISO(at(utc))).toBe(expected);
  });

  it("matches the backend's today_local for the same instants", () => {
    // Same fixtures as backend/tests/test_timezone.py::test_today_local_boundaries.
    expect(todayISO(at("2026-11-18T00:00:00Z"))).toBe("2026-11-18");
  });
});

describe("date-only handling has no timezone shift", () => {
  it("formats the same calendar day regardless of runtime zone", () => {
    expect(formatDateOnly("2026-11-19", { day: "numeric", month: "short", year: "numeric" })).toBe("19 Nov 2026");
    expect(formatDateOnly("2026-11-19")).toContain("Thursday");
  });

  it("rejects malformed and impossible dates", () => {
    expect(() => parseDateOnly("19-11-2026")).toThrow(RangeError);
    expect(() => parseDateOnly("2026-02-30")).toThrow(RangeError);
  });

  it("addDays crosses month/year/leap boundaries", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("weekday index is Monday=0 like the backend", () => {
    expect(weekdayIndex("2026-11-16")).toBe(0); // Monday
    expect(weekdayIndex("2026-11-18")).toBe(2); // Wednesday
    expect(weekdayIndex("2026-11-22")).toBe(6); // Sunday
  });

  it("startOfWeek returns Monday", () => {
    expect(startOfWeek("2026-11-18")).toBe("2026-11-16");
    expect(startOfWeek("2026-11-16")).toBe("2026-11-16");
    expect(startOfWeek("2026-11-22")).toBe("2026-11-16");
  });
});

describe("timestamp display in Asia/Kolkata", () => {
  it("converts API UTC timestamps to IST", () => {
    expect(formatDateTime("2026-11-18T20:00:00Z")).toBe("19 Nov 2026, 1:30 am");
    expect(formatDateTime("2026-11-18T08:00:00Z")).toBe("18 Nov 2026, 1:30 pm");
  });

  it("formats an instant's date in IST, not the runtime zone", () => {
    expect(formatDate(at("2026-11-18T20:00:00Z"), { day: "numeric", month: "long", year: "numeric" })).toBe("19 November 2026");
  });

  it("rejects invalid timestamps", () => {
    expect(() => formatDateTime("garbage")).toThrow(RangeError);
  });
});
