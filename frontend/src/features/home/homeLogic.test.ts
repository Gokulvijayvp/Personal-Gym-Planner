import { describe, expect, it } from "vitest";
import {
  cycleStatusLine, describeWeekDay, greetingFor, greetingText, hourInAppTz, noActiveCycleMessage, plannerDayLink, plannerWeekLink, plural,
} from "./homeLogic";
import { formatDistance, formatWeight } from "../settings/units";
import { WINTER, activeCard, makeDashboard } from "./testData";

const fmt = (d: string) => `<${d}>`;

describe("greeting", () => {
  it.each([[0, "Good evening"], [4, "Good evening"], [5, "Good morning"], [11, "Good morning"], [12, "Good afternoon"],
    [16, "Good afternoon"], [17, "Good evening"], [23, "Good evening"]])("hour %i -> %s", (h, text) => {
    expect(greetingFor(h)).toBe(text);
  });
  it("adds the display name only when there is one", () => {
    expect(greetingText(9, "Gokul")).toBe("Good morning, Gokul");
    expect(greetingText(9, null)).toBe("Good morning");
  });
  it("reads the hour in Asia/Kolkata, whatever the browser's zone is", () => {
    expect(hourInAppTz(new Date("2026-11-19T12:00:00Z"))).toBe(17);   // 17:30 in India, 12:00 in UTC
    expect(hourInAppTz(new Date("2026-11-19T18:29:00Z"))).toBe(23);
    expect(hourInAppTz(new Date("2026-11-19T18:30:00Z"))).toBe(0);    // midnight in India must be 0, not 24
    expect(hourInAppTz(new Date("2026-11-19T23:30:00Z"))).toBe(5);    // already the next morning there
  });
});

describe("cycle wording", () => {
  it("describes each state", () => {
    expect(cycleStatusLine(activeCard({ current_week: 3 }), fmt)).toBe("Week 3 of 8");
    expect(cycleStatusLine(activeCard({ state: "upcoming", current_week: null, days_until_start: 6 }), fmt)).toBe("Starts in 6 days");
    expect(cycleStatusLine(activeCard({ state: "upcoming", current_week: null, days_until_start: 1 }), fmt)).toBe("Starts tomorrow");
    expect(cycleStatusLine(activeCard({ state: "ended", current_week: null }), fmt)).toBe("Ended on <2027-01-10>");
  });
  it("explains why nothing is active from what exists", () => {
    const counts = { draft: 0, active: 0, completed: 0, archived: 0 };
    expect(noActiveCycleMessage(counts, null).title).toBe("No workout cycle yet");
    expect(noActiveCycleMessage(counts, { ...WINTER, status: "draft" }).text).toMatch(/still a draft/);
    expect(noActiveCycleMessage(counts, { ...WINTER, status: "completed" }).text).toMatch(/is completed/);
    expect(noActiveCycleMessage({ ...counts, archived: 2 }, { ...WINTER, status: "archived" }).text).toMatch(/archived/);
  });
});

describe("links and text", () => {
  it("builds the same planner links as the Calendar", () => {
    expect(plannerDayLink(1, 3, 4)).toBe("/planner?cycle=1&week=3&day=4");
    expect(plannerWeekLink(1, 3)).toBe("/planner?cycle=1&week=3");
    expect(plannerWeekLink(1, null)).toBe("/planner?cycle=1");
  });
  it("pluralises", () => {
    expect(plural(1, "day")).toBe("1 day");
    expect(plural(0, "day")).toBe("0 days");
    expect(plural(2, "more exercise")).toBe("2 more exercises");
  });
  it("describes a week day for screen readers", () => {
    const d = makeDashboard().week.days;
    expect(describeWeekDay(d[3], fmt)).toBe("Thursday <2026-11-19> (today): Strength + cardio, Chest, Triceps, 2 exercises");
    expect(describeWeekDay(d[1], fmt)).toBe("Tuesday <2026-11-17>: Rest day");
    expect(describeWeekDay({ ...d[0], cycle: null, plan: null }, fmt)).toBe("Monday <2026-11-16>: no active cycle");
  });
});

describe("units: converted for display, never just relabelled", () => {
  it("weight", () => {
    expect(formatWeight(80, "kg")).toBe("80 kg");
    expect(formatWeight(80, "lbs")).toBe("176.4 lbs");
    expect(formatWeight(2.5, "kg")).toBe("2.5 kg");
    expect(formatWeight(2.5, "lbs")).toBe("5.5 lbs");
    expect(formatWeight(0, "lbs")).toBe("0 lbs");
    expect(formatWeight(22.5, "lbs")).toBe("49.6 lbs");
  });
  it("distance", () => {
    expect(formatDistance(5, "km")).toBe("5 km");
    expect(formatDistance(5, "miles")).toBe("3.1 miles");
    expect(formatDistance(3.5, "km")).toBe("3.5 km");
    expect(formatDistance(3.5, "miles")).toBe("2.2 miles");
    expect(formatDistance(10, "miles")).toBe("6.2 miles");
  });
});
