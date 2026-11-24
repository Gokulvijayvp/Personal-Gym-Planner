import { describe, expect, it } from "vitest";
import {
  computeEndDate, emptyCycleForm, formatRange, groupCycles, nextMonday, toCycleInput, validateCycleForm,
  valuesFromCycle, type CycleFormValues,
} from "./cycleForm";
import type { CycleSummary } from "../../types/planner";

const valid: CycleFormValues = { name: "Winter Block", description: "", startDate: "2026-11-16", totalWeeks: "8" };

const cycle = (over: Partial<CycleSummary>): CycleSummary => ({
  id: 1, name: "C", description: null, start_date: "2026-11-16", end_date: "2027-01-10", total_weeks: 8, status: "draft",
  planned_days: 0, rest_days: 0, exercise_count: 0, cardio_count: 0, created_at: "2026-11-18T10:00:00Z", updated_at: "2026-11-18T10:00:00Z",
  ...over,
});

describe("end date calculation (same formula as the backend)", () => {
  it.each([
    ["2026-11-16", "1", "2026-11-22"],   // one week ends on its Sunday
    ["2026-11-16", "8", "2027-01-10"],   // crosses the year
    ["2026-11-16", "12", "2027-02-07"],
    ["2028-02-21", "2", "2028-03-05"],   // across a leap day
    ["2026-11-16", "52", "2027-11-14"],
  ])("%s + %s weeks -> %s", (start, weeks, end) => {
    expect(computeEndDate(start, weeks)).toBe(end);
  });

  it("is null until both inputs are usable", () => {
    expect(computeEndDate("", "8")).toBeNull();
    expect(computeEndDate("2026-11-16", "")).toBeNull();
    expect(computeEndDate("2026-11-16", "0")).toBeNull();
    expect(computeEndDate("2026-11-16", "53")).toBeNull();
    expect(computeEndDate("2026-11-16", "2.5")).toBeNull();
    expect(computeEndDate("2026-02-30", "4")).toBeNull();
  });
});

describe("next Monday suggestion", () => {
  it("snaps forward to a Monday and keeps a Monday", () => {
    expect(nextMonday("2026-11-16")).toBe("2026-11-16"); // Monday stays
    expect(nextMonday("2026-11-17")).toBe("2026-11-23"); // Tuesday -> next Monday
    expect(nextMonday("2026-11-22")).toBe("2026-11-23"); // Sunday -> next day
    expect(nextMonday("2026-12-30")).toBe("2027-01-04"); // across the year
  });

  it("the default form starts on a Monday in Asia/Kolkata, not the runtime zone", () => {
    // 20:00 UTC on Wed 18 Nov is already Thu 19 Nov 01:30 in India -> next Monday is 23 Nov.
    expect(emptyCycleForm(new Date("2026-11-18T20:00:00Z")).startDate).toBe("2026-11-23");
    expect(emptyCycleForm(new Date("2026-11-15T19:00:00Z")).startDate).toBe("2026-11-16"); // Mon 00:30 IST -> that Monday
    expect(emptyCycleForm().totalWeeks).toBe("8");
  });
});

describe("validateCycleForm", () => {
  it("accepts a valid form, including unusual durations", () => {
    expect(validateCycleForm(valid)).toEqual({});
    for (const w of ["1", "5", "13", "52"]) expect(validateCycleForm({ ...valid, totalWeeks: w })).toEqual({});
  });

  it("name rules", () => {
    expect(validateCycleForm({ ...valid, name: "  " }).name).toBeTruthy();
    expect(validateCycleForm({ ...valid, name: "a" }).name).toMatch(/at least 2/);
    expect(validateCycleForm({ ...valid, name: "x".repeat(121) }).name).toMatch(/at most 120/);
  });

  it("start date must be a real Monday", () => {
    expect(validateCycleForm({ ...valid, startDate: "2026-11-18" }).start_date).toMatch(/Monday/);
    expect(validateCycleForm({ ...valid, startDate: "" }).start_date).toBeTruthy();
    expect(validateCycleForm({ ...valid, startDate: "2026-02-30" }).start_date).toMatch(/valid date/);
    expect(validateCycleForm({ ...valid, startDate: "1999-01-04" }).start_date).toMatch(/2000 and 2100/);
  });

  it("weeks must be a whole number from 1 to 52", () => {
    for (const w of ["0", "-3", "53", "1000"]) expect(validateCycleForm({ ...valid, totalWeeks: w }).total_weeks, w).toMatch(/between 1 and 52/);
    for (const w of ["", "abc", "2.5"]) expect(validateCycleForm({ ...valid, totalWeeks: w }).total_weeks, w).toMatch(/whole number/);
  });

  it("description length", () => {
    expect(validateCycleForm({ ...valid, description: "x".repeat(2001) }).description).toBeTruthy();
  });
});

describe("toCycleInput / valuesFromCycle", () => {
  it("normalises text and converts types", () => {
    expect(toCycleInput({ ...valid, name: "  Winter   Block ", description: "  " })).toEqual({
      name: "Winter Block", description: null, start_date: "2026-11-16", total_weeks: 8 });
  });
  it("round trips an existing cycle", () => {
    const v = valuesFromCycle(cycle({ name: "X1", description: "d", total_weeks: 6 }));
    expect(toCycleInput(v)).toEqual({ name: "X1", description: "d", start_date: "2026-11-16", total_weeks: 6 });
  });
});

describe("groupCycles", () => {
  it("splits into active / drafts / previous, newest first", () => {
    const g = groupCycles([
      cycle({ id: 1, status: "completed", start_date: "2026-01-05" }), cycle({ id: 2, status: "active" }),
      cycle({ id: 3, status: "draft", start_date: "2027-03-01" }), cycle({ id: 4, status: "archived", start_date: "2026-08-03" }),
      cycle({ id: 5, status: "draft", start_date: "2027-06-07" }),
    ]);
    expect(g.active.map((c) => c.id)).toEqual([2]);
    expect(g.drafts.map((c) => c.id)).toEqual([5, 3]);
    expect(g.previous.map((c) => c.id)).toEqual([4, 1]);
  });
});

describe("formatRange", () => {
  it("formats within a year and across years", () => {
    expect(formatRange("2026-11-16", "2026-12-13")).toBe("16 Nov – 13 Dec 2026");
    expect(formatRange("2026-11-16", "2027-01-10")).toBe("16 Nov 2026 – 10 Jan 2027");
  });
});
