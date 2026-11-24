import { describe, expect, it } from "vitest";
import {
  axisDate, customError, daysBetween, distanceValue, formatDistance, formatMinutes, formatSeconds, formatSetVolume, formatVolume, formatWeight,
  isValidDate, labelIndexes, lineScale, monthLabel, niceScale, parseRangeParams, rangeQuery, weightValue, type RangeSelection,
} from "./progressLogic";

const sel = (preset: RangeSelection["preset"], from = "", to = ""): RangeSelection => ({ preset, from, to });

describe("date ranges (Asia/Kolkata calendar dates)", () => {
  const today = "2026-11-19";
  it("'last N days' includes today", () => {
    expect(rangeQuery(sel("7d"), today)).toEqual({ start: "2026-11-13", end: today });
    expect(rangeQuery(sel("30d"), today)).toEqual({ start: "2026-10-21", end: today });
    expect(rangeQuery(sel("90d"), today)).toEqual({ start: "2026-08-22", end: today });
  });
  it("months are calendar months, kept inside the end of shorter months", () => {
    expect(rangeQuery(sel("6m"), today)).toEqual({ start: "2026-05-20", end: today });
    expect(rangeQuery(sel("12m"), today)).toEqual({ start: "2025-11-20", end: today });
    expect(rangeQuery(sel("6m"), "2026-08-31")).toEqual({ start: "2026-03-01", end: "2026-08-31" });          // 28 Feb + 1 day
    expect(rangeQuery(sel("12m"), "2028-02-29")).toEqual({ start: "2027-03-01", end: "2028-02-29" });          // leap day
  });
  it("year boundaries", () => {
    expect(rangeQuery(sel("7d"), "2027-01-03")).toEqual({ start: "2026-12-28", end: "2027-01-03" });
    expect(rangeQuery(sel("30d"), "2028-03-01")).toEqual({ start: "2028-02-01", end: "2028-03-01" });      // leap February has 29 days
  });
  it("all time sends no dates; the server finds the first workout", () => {
    expect(rangeQuery(sel("all"), today)).toEqual({});
  });
  it("custom needs two valid dates in order", () => {
    expect(rangeQuery(sel("custom", "2026-11-01", "2026-11-10"), today)).toEqual({ start: "2026-11-01", end: "2026-11-10" });
    expect(rangeQuery(sel("custom", "2026-11-01", "2026-11-01"), today)).toEqual({ start: "2026-11-01", end: "2026-11-01" });
    for (const [a, b] of [["", ""], ["2026-11-01", ""], ["2026-11-10", "2026-11-01"], ["2026-02-30", "2026-03-01"], ["x", "y"]]) {
      expect(rangeQuery(sel("custom", a, b), today), `${a}..${b}`).toBeNull();
    }
  });
  it("explains what is wrong with a custom range", () => {
    expect(customError(sel("30d"))).toBeNull();
    expect(customError(sel("custom", "", ""))).toMatch(/both/);
    expect(customError(sel("custom", "2026-02-30", "2026-03-01"))).toMatch(/valid dates/);
    expect(customError(sel("custom", "2026-11-10", "2026-11-01"))).toMatch(/on or after/);
    expect(customError(sel("custom", "2026-11-01", "2026-11-10"))).toBeNull();
  });
  it("reads the range from the URL, defaulting to 30 days", () => {
    expect(parseRangeParams(new URLSearchParams(""))).toEqual({ preset: "30d", from: "", to: "" });
    expect(parseRangeParams(new URLSearchParams("range=all"))).toEqual({ preset: "all", from: "", to: "" });
    expect(parseRangeParams(new URLSearchParams("range=custom&from=2026-11-01&to=2026-11-09"))).toEqual({ preset: "custom", from: "2026-11-01", to: "2026-11-09" });
    expect(parseRangeParams(new URLSearchParams("range=banana")).preset).toBe("30d");
  });
  it("validates calendar dates, not just their shape", () => {
    expect(isValidDate("2028-02-29")).toBe(true);
    expect(isValidDate("2027-02-29")).toBe(false);
    expect(isValidDate("2026-13-01")).toBe(false);
    expect(isValidDate("26-11-01")).toBe(false);
    expect(daysBetween("2026-02-28", "2026-03-01")).toBe(1);
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
  });
});

describe("units: canonical kilograms and kilometres, converted for display only", () => {
  it("weights", () => {
    expect(formatWeight(62.5, "kg")).toBe("62.5 kg");
    expect(formatWeight(80, "kg")).toBe("80 kg");
    expect(formatWeight(80, "lbs")).toBe("176.4 lbs");
    expect(formatWeight(22.5, "lbs")).toBe("49.6 lbs");
    expect(weightValue(100, "lbs")).toBeCloseTo(220.462, 3);
    expect(weightValue(100, "kg")).toBe(100);
  });
  it("volume is rounded for display and labelled with the unit", () => {
    expect(formatVolume(12345.6, "kg")).toBe("12,346 kg");
    expect(formatVolume(12345.6, "lbs")).toBe("27,217 lbs");
    expect(formatVolume(0, "kg")).toBe("0 kg");
    expect(formatSetVolume(750, "kg")).toBe("750 kg");
    expect(formatSetVolume(1512.5, "kg")).toBe("1,512.5 kg");
    expect(formatSetVolume(1512.5, "lbs")).toBe("3,334.5 lbs");
  });
  it("distance", () => {
    expect(formatDistance(5, "km")).toBe("5 km");
    expect(formatDistance(5, "miles")).toBe("3.11 miles");
    expect(formatDistance(0.001, "km")).toBe("0 km");
    expect(distanceValue(10, "miles")).toBeCloseTo(6.2137, 4);
  });
  it("durations", () => {
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(60)).toBe("1 h");
    expect(formatMinutes(135)).toBe("2 h 15 min");
    expect(formatSeconds(21600)).toBe("6 h");
    expect(formatSeconds(3725)).toBe("1 h 2 min");
  });
});

describe("axis and date labels follow the date-format setting", () => {
  it("compact axis dates", () => {
    expect(axisDate("2026-11-02", "DD MMM YYYY")).toBe("02 Nov");
    expect(axisDate("2026-11-02", "DD/MM/YYYY")).toBe("02/11");
    expect(axisDate("2026-11-02", "YYYY-MM-DD")).toBe("11-02");
  });
  it("month labels", () => {
    expect(monthLabel("2026-11", "DD MMM YYYY")).toBe("Nov 2026");
    expect(monthLabel("2026-11", "DD/MM/YYYY")).toBe("11/2026");
    expect(monthLabel("2026-11", "YYYY-MM-DD")).toBe("2026-11");
  });
});

describe("chart maths", () => {
  it("bar charts start at zero with a tidy top", () => {
    expect(niceScale(0)).toEqual({ max: 1, step: 1 });
    expect(niceScale(3)).toEqual({ max: 3, step: 1 });
    expect(niceScale(7)).toEqual({ max: 8, step: 2 });
    expect(niceScale(46)).toEqual({ max: 60, step: 20 });
    expect(niceScale(12345)).toEqual({ max: 15000, step: 5000 });
    for (const max of [1, 2, 5, 9, 13, 99, 480, 7000.6]) {
      const s = niceScale(max);
      expect(s.max).toBeGreaterThanOrEqual(max);
      expect(s.max / s.step).toBeLessThanOrEqual(10);
    }
  });
  it("line charts hug the data and never collapse when it is flat", () => {
    expect(lineScale(62.5, 80)).toEqual({ min: 60, max: 80, step: 5 });
    const flat = lineScale(70, 70);
    expect(flat.min).toBeLessThan(70); expect(flat.max).toBeGreaterThan(70);
    for (const [a, b] of [[0, 1], [10.2, 10.6], [40, 400], [1000, 1002]]) {
      const s = lineScale(a, b);
      expect(s.min).toBeLessThanOrEqual(a); expect(s.max).toBeGreaterThanOrEqual(b);
    }
  });
  it("a whole-number axis never uses fractional ticks", () => {
    const flat = lineScale(5, 5, 4, true);
    expect(flat).toEqual({ min: 4, max: 6, step: 1 });
    for (const [a, b] of [[5, 5], [8, 12], [3, 4], [10, 40]]) {
      const s = lineScale(a, b, 4, true);
      expect(Number.isInteger(s.step) && Number.isInteger(s.min) && Number.isInteger(s.max), `${a}..${b}`).toBe(true);
      expect(s.min).toBeLessThanOrEqual(a); expect(s.max).toBeGreaterThanOrEqual(b);
    }
  });
  it("labels never collide and always include the last one", () => {
    expect(labelIndexes(5, 8)).toEqual([0, 1, 2, 3, 4]);
    expect(labelIndexes(0, 8)).toEqual([]);
    const idx = labelIndexes(30, 6);
    expect(idx.length).toBeLessThanOrEqual(6);
    expect(idx[idx.length - 1]).toBe(29);
    expect(labelIndexes(104, 8).length).toBeLessThanOrEqual(8);
  });
});
