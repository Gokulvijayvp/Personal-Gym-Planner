import { describe, expect, it } from "vitest";
import {
  compactLabel, describeDay, monthGrid, parseCalendarParams, rangeFor, serializeCalendarParams, shiftDate, titleFor, weekDates,
} from "./calendarLogic";
import { addMonths, daysInMonth, endOfMonth, startOfMonth, weekdayIndex } from "../../utils/date";
import { chestDay, makeCycle, makeDay } from "../planner/testData";
import type { CalendarDay } from "../../types/calendar";

const TODAY = "2026-11-19";
const brief = (c = makeCycle()) => ({ id: c.id, name: c.name, status: c.status, start_date: c.start_date, end_date: c.end_date, total_weeks: c.total_weeks });

describe("month helpers", () => {
  it("days in month, including leap years and century rules", () => {
    expect(daysInMonth("2026-11-19")).toBe(30);
    expect(daysInMonth("2027-02-10")).toBe(28);
    expect(daysInMonth("2028-02-10")).toBe(29);       // leap
    expect(daysInMonth("2100-02-01")).toBe(28);       // century, not a leap year
    expect(daysInMonth("2000-02-01")).toBe(29);       // divisible by 400
    expect(daysInMonth("2026-12-31")).toBe(31);
  });
  it("start / end of month", () => {
    expect(startOfMonth("2026-11-19")).toBe("2026-11-01");
    expect(endOfMonth("2026-11-19")).toBe("2026-11-30");
    expect(endOfMonth("2028-02-03")).toBe("2028-02-29");
  });
  it("addMonths clamps the day and crosses years", () => {
    expect(addMonths("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2027-01-10", -1)).toBe("2026-12-10");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonths("2026-11-19", 14)).toBe("2028-01-19");
    expect(addMonths("2026-11-19", -11)).toBe("2025-12-19");
  });
});

describe("month grid (Monday first)", () => {
  const flat = (g: string[][]) => g.flat();
  it("November 2026 starts on a Sunday -> six rows", () => {
    const g = monthGrid("2026-11-19");
    expect(g).toHaveLength(6);
    expect(g[0][0]).toBe("2026-10-26"); expect(g[0][6]).toBe("2026-11-01");
    expect(g[5][0]).toBe("2026-11-30"); expect(g[5][6]).toBe("2026-12-06");
    expect(flat(g)).toHaveLength(42);
  });
  it("February 2027 fits exactly four rows (starts Monday, 28 days)", () => {
    const g = monthGrid("2027-02-14");
    expect(g).toHaveLength(4);
    expect(g[0][0]).toBe("2027-02-01"); expect(g[3][6]).toBe("2027-02-28");
  });
  it("leap February 2028 includes the 29th", () => {
    const g = flat(monthGrid("2028-02-10"));
    expect(g).toContain("2028-02-29");
    expect(g[0]).toBe("2028-01-31"); expect(g[g.length - 1]).toBe("2028-03-05");
    expect(g).toHaveLength(35);
  });
  it("January 2027 reaches back into December (year boundary)", () => {
    const g = monthGrid("2027-01-20");
    expect(g[0][0]).toBe("2026-12-28");
    expect(g[g.length - 1][6]).toBe("2027-01-31");
  });
  it("every row is Monday..Sunday and rows are consecutive, for every month of 2026-2028", () => {
    for (let m = 0; m < 36; m++) {
      const anchor = addMonths("2026-01-15", m);
      const g = monthGrid(anchor);
      expect(g.length).toBeGreaterThanOrEqual(4); expect(g.length).toBeLessThanOrEqual(6);
      g.forEach((row, i) => {
        expect(weekdayIndex(row[0])).toBe(0); expect(weekdayIndex(row[6])).toBe(6);
        if (i > 0) expect(weekDates(row[0])[0]).toBe(row[0]);
      });
      const all = flat(g);
      expect(all).toContain(startOfMonth(anchor)); expect(all).toContain(endOfMonth(anchor));
    }
  });
});

describe("ranges, week dates and shifting", () => {
  it("week dates are Monday..Sunday for any day of the week", () => {
    for (const d of ["2026-11-16", "2026-11-19", "2026-11-22"]) {
      expect(weekDates(d)).toEqual(["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"]);
    }
    expect(weekDates("2026-12-30")[0]).toBe("2026-12-28"); expect(weekDates("2026-12-30")[6]).toBe("2027-01-03");
  });
  it("range per view", () => {
    expect(rangeFor("day", TODAY)).toEqual({ start: TODAY, end: TODAY });
    expect(rangeFor("week", TODAY)).toEqual({ start: "2026-11-16", end: "2026-11-22" });
    expect(rangeFor("month", TODAY)).toEqual({ start: "2026-10-26", end: "2026-12-06" });
  });
  it("a month range never exceeds the backend limit of 62 days", () => {
    for (let m = 0; m < 60; m++) {
      const { start, end } = rangeFor("month", addMonths("2026-01-01", m));
      const span = (new Date(end).getTime() - new Date(start).getTime()) / 86400000 + 1;
      expect(span).toBeLessThanOrEqual(42);
    }
  });
  it("previous / next", () => {
    expect(shiftDate("month", "2026-12-15", 1)).toBe("2027-01-15");
    expect(shiftDate("month", "2027-01-31", 1)).toBe("2027-02-28");
    expect(shiftDate("month", "2026-01-10", -1)).toBe("2025-12-10");
    expect(shiftDate("week", "2026-12-30", 1)).toBe("2027-01-06");
    expect(shiftDate("week", "2026-11-19", -1)).toBe("2026-11-12");
    expect(shiftDate("day", "2028-02-28", 1)).toBe("2028-02-29");
    expect(shiftDate("day", "2028-02-29", 1)).toBe("2028-03-01");
    expect(shiftDate("day", "2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("titles", () => {
  it("month / week / day", () => {
    expect(titleFor("month", TODAY)).toBe("November 2026");
    expect(titleFor("week", TODAY)).toBe("16 – 22 Nov 2026");
    expect(titleFor("week", "2026-11-30")).toBe("30 Nov – 6 Dec 2026");
    expect(titleFor("week", "2026-12-30")).toBe("28 Dec 2026 – 3 Jan 2027");
    expect(titleFor("day", TODAY)).toBe("Thursday, 19 November 2026");
  });
});

describe("URL <-> state", () => {
  it("defaults to the month view of today", () => {
    expect(parseCalendarParams(new URLSearchParams(), TODAY)).toEqual({ view: "month", date: TODAY });
  });
  it("round trips and omits defaults", () => {
    const s = { view: "week" as const, date: "2026-12-30" };
    expect(serializeCalendarParams(s, TODAY).toString()).toBe("view=week&date=2026-12-30");
    expect(parseCalendarParams(serializeCalendarParams(s, TODAY), TODAY)).toEqual(s);
    expect(serializeCalendarParams({ view: "month", date: TODAY }, TODAY).toString()).toBe("");
    expect(serializeCalendarParams({ view: "day", date: TODAY }, TODAY).toString()).toBe("view=day");
  });
  it("ignores malformed values", () => {
    for (const q of ["view=year", "date=nope", "date=2026-02-30", "date=1999-12-31", "date=2101-01-01", "view=&date="]) {
      expect(parseCalendarParams(new URLSearchParams(q), TODAY), q).toEqual({ view: "month", date: TODAY });
    }
    expect(parseCalendarParams(new URLSearchParams("view=day&date=bad"), TODAY)).toEqual({ view: "day", date: TODAY });
  });
});

describe("compact labels", () => {
  const day = (plan: CalendarDay["plan"], cycle = brief()): CalendarDay => ({ date: "2026-11-16", day_of_week: 0, cycle: plan ? cycle : null, week_number: plan ? 1 : null, also_covered_by: [], plan, workout: null });
  const groups = (...names: string[]) => names.map((name, i) => ({ id: i + 1, name }));
  it("summarises each kind of day", () => {
    expect(compactLabel(day(null))).toBe("");
    expect(compactLabel(day(makeDay({ kind: "empty" })))).toBe("");
    expect(compactLabel(day(makeDay({ kind: "rest", status: "rest" })))).toBe("Rest");
    expect(compactLabel(day(makeDay({ kind: "cardio", cardio_count: 1 })))).toBe("Cardio");
    expect(compactLabel(day(makeDay({ kind: "strength", muscle_groups: groups("Chest") })))).toBe("Chest");
    expect(compactLabel(day(makeDay({ kind: "strength", muscle_groups: groups("Chest", "Triceps") })))).toBe("Chest, Triceps");
    expect(compactLabel(day(makeDay({ kind: "strength", muscle_groups: groups("Chest", "Triceps", "Shoulders", "Abs") })))).toBe("Chest, Triceps +2");
    expect(compactLabel(day(makeDay({ kind: "mixed", muscle_groups: groups("Back") })))).toBe("Back + cardio");
  });
  it("describes a day for screen readers", () => {
    expect(describeDay(day(null))).toBe("Monday, 16 November: no workout cycle");
    expect(describeDay(day(chestDay()))).toBe("Monday, 16 November: Strength (Chest), week 1 of Winter Block");
    expect(describeDay(day(makeDay({ kind: "rest", status: "rest" })))).toBe("Monday, 16 November: Rest day, week 1 of Winter Block");
  });
});
