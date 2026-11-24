// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { ToastProvider } from "../components/ui/Toast";
import CalendarPage from "./CalendarPage";
import { ApiError } from "../services/apiError";
import { calendarService } from "../services/calendarService";
import { workoutService } from "../services/workoutService";
import type { SessionRef } from "../types/workout";
import type { CalendarDay, CalendarResponse } from "../types/calendar";
import type { DayDetail } from "../types/planner";
import { cardioDay, chestDay, makeCycle, makeDay } from "../features/planner/testData";
import { addDays, weekdayIndex } from "../utils/date";

vi.mock("../services/calendarService", () => ({ calendarService: { get: vi.fn() } }));
vi.mock("../services/workoutService", () => ({ workoutService: { start: vi.fn() } }));
const svc = vi.mocked(calendarService);

const CYCLE = makeCycle({ id: 1, name: "Winter Block", status: "active", start_date: "2026-11-16", end_date: "2027-01-10", total_weeks: 8 });
const brief = (c = CYCLE) => ({ id: c.id, name: c.name, status: c.status, start_date: c.start_date, end_date: c.end_date, total_weeks: c.total_weeks });

/** What the Weekly Planner holds, by date. */
const PLANS: Record<string, Partial<DayDetail>> = {
  "2026-11-16": chestDay({ title: "Push day", notes: "Heavy compounds first.", display_title: "Push day",
    muscle_groups: [{ id: 1, name: "Chest" }, { id: 5, name: "Triceps" }, { id: 3, name: "Shoulders" }] }),
  "2026-11-17": { status: "rest", kind: "rest", display_title: "Rest day" },
  "2026-11-18": cardioDay({ day_of_week: 2, date: "2026-11-18" }),
  "2026-11-19": chestDay({ day_of_week: 3, date: "2026-11-19", kind: "mixed", cardio_count: 1, cardio: cardioDay().cardio,
    display_title: "Chest + Cardio" }),
};

/** Logged workouts by date (what the real API puts in `day.workout`). */
let LOGGED: Record<string, SessionRef> = {};

/** A fake backend: every date in [start, end] mapped onto the cycle exactly like the real one. */
function fakeCalendar(start: string, end: string): CalendarResponse {
  const days: CalendarDay[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const offset = Math.round((Date.parse(d) - Date.parse(CYCLE.start_date)) / 86400000);
    const inCycle = offset >= 0 && offset < 7 * CYCLE.total_weeks;
    if (!inCycle) { days.push({ date: d, day_of_week: weekdayIndex(d), cycle: null, week_number: null, also_covered_by: [], plan: null, workout: LOGGED[d] ?? null }); continue; }
    const week = Math.floor(offset / 7) + 1, dow = offset % 7;
    const plan = makeDay({ cycle_id: 1, week_number: week, day_of_week: dow, date: d, ...(PLANS[d] ?? {}) });
    days.push({ date: d, day_of_week: dow, cycle: brief(), week_number: week, also_covered_by: d === "2026-11-23" ? [brief(makeCycle({ id: 2, name: "Draft Block", status: "draft" }))] : [], plan, workout: LOGGED[d] ?? null });
  }
  return { start, end, timezone: "Asia/Kolkata", today: "2026-11-19", days };
}

function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname + l.search}</div>; }
function renderCal(url = "/calendar") {
  return render(<MemoryRouter initialEntries={[url]}><ToastProvider><CalendarPage /></ToastProvider><Where /></MemoryRouter>);
}
const cell = (label: RegExp | string) => screen.getByRole("gridcell", { name: label });
const title = () => screen.getByTestId("cal-title").textContent;
const lastRange = () => svc.get.mock.calls[svc.get.mock.calls.length - 1].slice(0, 2);

beforeEach(() => {
  LOGGED = {};
  // Only Date is faked, so timers/promises behave normally. 11:30 in India on Thursday 19 Nov 2026.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-19T06:00:00Z"));
  svc.get.mockImplementation(async (s, e) => fakeCalendar(s, e));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

describe("month view", () => {
  it("opens on the current month and asks for the whole six-week grid", async () => {
    renderCal();
    await screen.findByRole("grid", { name: "Month" });
    expect(title()).toBe("November 2026");
    expect(lastRange()).toEqual(["2026-10-26", "2026-12-06"]);
    expect(screen.getAllByRole("gridcell")).toHaveLength(42);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(screen.getByRole("button", { name: "Month", pressed: true })).toBeTruthy();
  });

  it("highlights today (and only today)", async () => {
    renderCal();
    await screen.findByRole("grid");
    const today = screen.getAllByRole("gridcell").filter((c) => c.getAttribute("aria-current") === "date");
    expect(today).toHaveLength(1);
    expect(today[0].textContent).toContain("19");
    expect(today[0].className).toMatch(/\btoday\b/);
  });

  it("today follows India's date, not the browser's: 20:00 UTC on the 18th is already the 19th", async () => {
    vi.setSystemTime(new Date("2026-11-18T20:00:00Z"));
    renderCal();
    await screen.findByRole("grid");
    expect(screen.getAllByRole("gridcell").find((c) => c.getAttribute("aria-current") === "date")!.textContent).toContain("19");
    cleanup();
    vi.setSystemTime(new Date("2026-11-18T18:29:00Z")); // 23:59 IST
    renderCal();
    await screen.findByRole("grid");
    expect(screen.getAllByRole("gridcell").find((c) => c.getAttribute("aria-current") === "date")!.textContent).toContain("18");
  });

  it("shows compact summaries: groups, rest, cardio, mixed - and nothing for unplanned or no-cycle dates", async () => {
    renderCal();
    await screen.findByRole("grid");
    expect(cell(/Monday, 16 November: Strength/).textContent).toContain("Chest, Triceps +1");   // long lists are cut
    expect(cell(/Tuesday, 17 November: Rest day/).textContent).toContain("Rest");
    expect(cell(/Wednesday, 18 November: Cardio/).textContent).toContain("Cardio");
    expect(cell(/Thursday, 19 November: Strength \+ cardio/).textContent).toContain("Chest + cardio");
    const unplanned = cell(/Friday, 20 November: Not planned/);
    expect(unplanned.textContent).toBe("20Not planned");                                       // visibly "in a cycle", just empty
    expect(unplanned.className).toMatch(/in-cycle/);
    const before = cell(/Saturday, 14 November: no workout cycle/);
    expect(before.textContent).toBe("14");                                                     // outside any cycle: only the number
    expect(before.className).not.toMatch(/in-cycle/);
    expect(cell(/Monday, 16 November/).textContent).toContain("W1");                           // cycle week tag on Mondays
    expect(cell(/Monday, 23 November/).textContent).toContain("W2");
    expect(cell(/Monday, 16 November/).textContent).not.toMatch(/Squat|Barbell Bench/);       // never long exercise lists
  });

  it("dims days of the neighbouring months", async () => {
    renderCal();
    await screen.findByRole("grid");
    expect(cell(/Saturday, 31 October/).className).toMatch(/\bout\b/);
    expect(cell(/Monday, 2 November/).className).not.toMatch(/\bout\b/);
  });

  it("previous / next month and Today", async () => {
    const user = userEvent.setup();
    renderCal();
    await screen.findByRole("grid");
    await user.click(screen.getByRole("button", { name: "Next month" }));
    await waitFor(() => expect(title()).toBe("December 2026"));
    await waitFor(() => expect(lastRange()).toEqual(["2026-11-30", "2027-01-03"]));
    await user.click(screen.getByRole("button", { name: "Next month" }));
    await waitFor(() => expect(title()).toBe("January 2027"));                               // year boundary
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    await waitFor(() => expect(title()).toBe("October 2026"));
    await user.click(screen.getByRole("button", { name: "Today" }));
    await waitFor(() => expect(title()).toBe("November 2026"));
    expect(screen.getByTestId("where").textContent).toBe("/calendar");                      // today = clean URL
  });

  it("clicking a date opens that date in Day view", async () => {
    const user = userEvent.setup();
    renderCal();
    await screen.findByRole("grid");
    await user.click(cell(/Monday, 16 November/));
    await waitFor(() => expect(title()).toBe("Monday, 16 November 2026"));
    expect(screen.getByRole("button", { name: "Day", pressed: true })).toBeTruthy();
    expect(screen.getByTestId("where").textContent).toBe("/calendar?view=day&date=2026-11-16");
    expect(await screen.findByRole("article", { name: "Chest exercises" })).toBeTruthy();
  });

  it("clicking a date from a neighbouring month shows that date", async () => {
    const user = userEvent.setup();
    renderCal();
    await screen.findByRole("grid");
    await user.click(cell(/Tuesday, 1 December/));
    await waitFor(() => expect(title()).toBe("Tuesday, 1 December 2026"));
  });
});

describe("a cycle with nothing planned yet", () => {
  const emptyPlans = () => svc.get.mockImplementation(async (s, e) => {
    const r = fakeCalendar(s, e);
    return { ...r, days: r.days.map((d) => (d.plan ? { ...d, plan: makeDay({ ...d.plan, kind: "empty", status: "unplanned", display_title: null, title: null, notes: null, strength: [], cardio: [], muscle_groups: [], exercise_count: 0, cardio_count: 0 }) } : d)) };
  });

  it("is not mistaken for 'no cycle': days look different and a banner explains", async () => {
    emptyPlans();
    renderCal();
    await screen.findByRole("grid");
    const note = await screen.findByTestId("unplanned-cycle");
    expect(note.textContent).toMatch(/Winter Block covers these dates, but no workouts are planned in it yet/);
    expect(within(note).getByRole("link", { name: /Plan it in the Weekly Planner/ }).getAttribute("href")).toBe("/planner?cycle=1");
    expect(cell(/Tuesday, 17 November: Not planned/).className).toMatch(/in-cycle/);
    expect(cell(/Tuesday, 17 November: Not planned/).textContent).toContain("Not planned");
    expect(cell(/Saturday, 14 November: no workout cycle/).className).not.toMatch(/in-cycle/);
  });

  it("is also shown in week view, but not in day view", async () => {
    emptyPlans();
    renderCal("/calendar?view=week");
    expect(await screen.findByTestId("unplanned-cycle")).toBeTruthy();
    cleanup();
    renderCal("/calendar?view=day&date=2026-11-17");
    await screen.findByTestId("unplanned");
    expect(screen.queryByTestId("unplanned-cycle")).toBeNull();
  });

  it("does not appear once anything is planned, or when no cycle is visible", async () => {
    renderCal();                                   // fixtures have planned days
    await screen.findByRole("grid");
    expect(screen.queryByTestId("unplanned-cycle")).toBeNull();
    cleanup();
    renderCal("/calendar?date=2026-03-10");        // months before any cycle
    await screen.findByRole("grid");
    expect(screen.queryByTestId("unplanned-cycle")).toBeNull();
  });
});

describe("week view", () => {
  it("shows Monday to Sunday with each kind of day", async () => {
    renderCal("/calendar?view=week");
    await screen.findByRole("list", { name: "Week" });
    expect(title()).toBe("16 – 22 Nov 2026");
    expect(lastRange()).toEqual(["2026-11-16", "2026-11-22"]);
    const rows = screen.getAllByTestId(/^week-day-/);
    expect(rows.map((r) => within(r).getAllByText(/day$/)[0].textContent)).toEqual(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);
    const row = (d: string) => within(screen.getByTestId(`week-day-${d}`));
    expect(row("2026-11-16").getByText("Strength")).toBeTruthy();
    expect(row("2026-11-16").getByText("Push day")).toBeTruthy();
    expect(row("2026-11-16").getByText("Chest")).toBeTruthy();
    expect(row("2026-11-16").getByText("2 exercises")).toBeTruthy();
    expect(row("2026-11-17").getByText("Rest day")).toBeTruthy();
    expect(row("2026-11-18").getByText("Cardio", { selector: ".kind-badge" })).toBeTruthy();
    expect(row("2026-11-19").getByText("Strength + cardio")).toBeTruthy();
    expect(row("2026-11-19").getByText("Today")).toBeTruthy();
    expect(row("2026-11-20").getByText("Not planned")).toBeTruthy();
    expect(row("2026-11-16").getByText(/Winter Block · week 1/)).toBeTruthy();
  });

  it("previous / next week and Today", async () => {
    const user = userEvent.setup();
    renderCal("/calendar?view=week");
    await screen.findByRole("list", { name: "Week" });
    await user.click(screen.getByRole("button", { name: "Next week" }));
    await waitFor(() => expect(title()).toBe("23 – 29 Nov 2026"));
    expect(await screen.findByText(/Winter Block · week 2/, { selector: "li[data-testid='week-day-2026-11-23'] *" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Next week" }));
    await waitFor(() => expect(title()).toBe("30 Nov – 6 Dec 2026"));                      // month boundary
    await user.click(screen.getByRole("button", { name: "Previous week" }));
    await user.click(screen.getByRole("button", { name: "Previous week" }));
    await user.click(screen.getByRole("button", { name: "Previous week" }));
    await waitFor(() => expect(title()).toBe("9 – 15 Nov 2026"));
    await user.click(screen.getByRole("button", { name: "Today" }));
    await waitFor(() => expect(title()).toBe("16 – 22 Nov 2026"));
  });

  it("weeks that cross the year", async () => {
    renderCal("/calendar?view=week&date=2026-12-30");
    await screen.findByRole("list", { name: "Week" });
    expect(title()).toBe("28 Dec 2026 – 3 Jan 2027");
    expect(lastRange()).toEqual(["2026-12-28", "2027-01-03"]);
    expect(screen.getAllByTestId(/^week-day-/)).toHaveLength(7);
  });

  it("days outside any cycle say so", async () => {
    renderCal("/calendar?view=week&date=2026-11-12");     // 9 - 15 Nov: before the cycle starts on the 16th
    await screen.findByRole("list", { name: "Week" });
    expect(screen.getAllByText("No cycle")).toHaveLength(7);
  });

  it("View day opens that date", async () => {
    const user = userEvent.setup();
    renderCal("/calendar?view=week");
    await screen.findByRole("list", { name: "Week" });
    await user.click(screen.getByRole("button", { name: /View Tuesday 2026-11-17/ }));
    await waitFor(() => expect(title()).toBe("Tuesday, 17 November 2026"));
    expect(await screen.findByTestId("rest-note")).toBeTruthy();
  });
});

describe("day view", () => {
  it("shows the full plan: groups, exercises, sets, reps, weight, rest, notes, cardio and day notes", async () => {
    renderCal("/calendar?view=day&date=2026-11-16");
    const group = within(await screen.findByRole("article", { name: "Chest exercises" }));
    const rows = group.getAllByRole("listitem");
    expect(rows[0].textContent).toContain("Barbell Bench Press");
    expect(rows[0].textContent).toContain("4 × 6-8 @ 80 kg · rest 120s");
    expect(rows[0].textContent).toContain("Middle Chest"); expect(rows[0].textContent).toContain("Barbell");
    expect(rows[1].textContent).toContain("Cable Fly"); expect(rows[1].textContent).toContain("3 × 10");
    expect(screen.getByText("Push day", { selector: "h3" })).toBeTruthy();
    expect(screen.getByTestId("day-notes").textContent).toContain("Heavy compounds first.");
    expect(lastRange()).toEqual(["2026-11-16", "2026-11-16"]);
  });

  it("shows cardio details and mixed days", async () => {
    renderCal("/calendar?view=day&date=2026-11-19");
    const cardio = within(await screen.findByRole("article", { name: "Cardio" }));
    expect(cardio.getByText("Running")).toBeTruthy();
    expect(cardio.getByText(/40 min · 5 km/)).toBeTruthy();
    expect(screen.getByRole("article", { name: "Chest exercises" })).toBeTruthy();
    expect(screen.getByText("Strength + cardio")).toBeTruthy();
    expect(screen.getByText("Today", { selector: ".badge" })).toBeTruthy();
  });

  it("identifies a rest day", async () => {
    renderCal("/calendar?view=day&date=2026-11-17");
    expect((await screen.findByTestId("rest-note")).textContent).toMatch(/Rest day/);
    expect(screen.getByText("Rest day", { selector: ".kind-badge" })).toBeTruthy();
    expect(screen.queryByRole("article", { name: /exercises/ })).toBeNull();
  });

  it("identifies a day inside a cycle with nothing planned, and links to the planner", async () => {
    renderCal("/calendar?view=day&date=2026-11-20");
    const note = await screen.findByTestId("unplanned");
    expect(note.textContent).toMatch(/Nothing is planned/);
    expect(within(note).getByRole("link", { name: /Plan it in the Weekly Planner/ }).getAttribute("href")).toBe("/planner?cycle=1&week=1&day=4");
  });

  it("shows the cycle, its status and the cycle week", async () => {
    renderCal("/calendar?view=day&date=2026-11-24");   // Tuesday of week 2
    const week = await screen.findByTestId("cycle-week");
    expect(week.textContent).toBe("Week 2 of 8 · 16 Nov 2026 – 10 Jan 2027");
    expect(screen.getByText("Winter Block")).toBeTruthy();
    expect(screen.getByText("Active", { selector: ".badge" })).toBeTruthy();
  });

  it("lists other cycles that also cover the date", async () => {
    renderCal("/calendar?view=day&date=2026-11-23");
    expect((await screen.findByTestId("also-covered")).textContent).toContain("Draft Block (Draft)");
  });

  it("links to the right Weekly Planner week and day", async () => {
    renderCal("/calendar?view=day&date=2026-11-25");   // Wednesday of week 2
    const link = await screen.findByRole("link", { name: /Open in Weekly Planner/ });
    expect(link.getAttribute("href")).toBe("/planner?cycle=1&week=2&day=2");
  });

  it("dates before and after the cycle have an empty state, not a plan", async () => {
    for (const [d, msg] of [["2026-11-15", /No workout cycle covers this date/], ["2027-01-11", /No workout cycle covers this date/]] as const) {
      renderCal(`/calendar?view=day&date=${d}`);
      expect(await screen.findByText(msg)).toBeTruthy();
      expect(screen.getByRole("link", { name: "Go to Workout Cycles" }).getAttribute("href")).toBe("/cycles");
      expect(screen.queryByRole("link", { name: /Open in Weekly Planner/ })).toBeNull();
      cleanup();
    }
  });

  it("first and last day of the cycle map correctly", async () => {
    renderCal("/calendar?view=day&date=2027-01-10");
    expect((await screen.findByTestId("cycle-week")).textContent).toMatch(/^Week 8 of 8/);
    expect(screen.getByRole("link", { name: /Open in Weekly Planner/ }).getAttribute("href")).toBe("/planner?cycle=1&week=8&day=6");
  });

  it("previous / next day", async () => {
    const user = userEvent.setup();
    renderCal("/calendar?view=day&date=2026-11-19");
    await screen.findByTestId("cycle-week");
    await user.click(screen.getByRole("button", { name: "Next day" }));
    await waitFor(() => expect(title()).toBe("Friday, 20 November 2026"));
    await user.click(screen.getByRole("button", { name: "Previous day" }));
    await user.click(screen.getByRole("button", { name: "Previous day" }));
    await waitFor(() => expect(title()).toBe("Wednesday, 18 November 2026"));
    await user.click(screen.getByRole("button", { name: "Today" }));
    await waitFor(() => expect(title()).toBe("Thursday, 19 November 2026"));
  });

  it("is read-only: only links out to the planner, no editing controls", async () => {
    renderCal("/calendar?view=day&date=2026-11-16");
    await screen.findByRole("article", { name: "Chest exercises" });
    for (const name of [/add/i, /edit/i, /remove/i, /delete/i, /clear/i, /copy/i, /save/i, /rest day$/i]) {
      expect(screen.queryByRole("button", { name }), String(name)).toBeNull();
    }
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});

describe("switching views and the URL", () => {
  it("Month, Week and Day switch while keeping the selected date", async () => {
    const user = userEvent.setup();
    renderCal("/calendar?date=2026-11-25");
    await screen.findByRole("grid");
    await user.click(screen.getByRole("button", { name: "Week" }));
    await waitFor(() => expect(title()).toBe("23 – 29 Nov 2026"));
    await user.click(screen.getByRole("button", { name: "Day" }));
    await waitFor(() => expect(title()).toBe("Wednesday, 25 November 2026"));
    await user.click(screen.getByRole("button", { name: "Month" }));
    await waitFor(() => expect(title()).toBe("November 2026"));
    expect(screen.getByTestId("where").textContent).toBe("/calendar?date=2026-11-25");
  });

  it("restores view and date from the URL (refresh / shared link)", async () => {
    renderCal("/calendar?view=week&date=2027-01-05");
    await screen.findByRole("list", { name: "Week" });
    expect(title()).toBe("4 – 10 Jan 2027");
  });

  it("falls back to this month for nonsense in the URL", async () => {
    renderCal("/calendar?view=year&date=banana");
    await screen.findByRole("grid");
    expect(title()).toBe("November 2026");
  });
});

describe("loading, errors and empty calendar", () => {
  it("shows skeletons while loading", async () => {
    let resolve!: (v: CalendarResponse) => void;
    svc.get.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderCal();
    expect((await screen.findAllByTestId("cal-skeleton")).length).toBeGreaterThan(0);
    expect(screen.getByRole("status", { name: "Loading calendar" })).toBeTruthy();
    resolve(fakeCalendar("2026-10-26", "2026-12-06"));
    await screen.findByRole("grid");
    expect(screen.queryAllByTestId("cal-skeleton")).toHaveLength(0);
  });

  it("error state with retry", async () => {
    const user = userEvent.setup();
    svc.get.mockRejectedValueOnce(new ApiError({ kind: "network", message: "Can't reach the server." }));
    renderCal();
    await screen.findByText("Couldn't load the calendar");
    expect(screen.getByText("Can't reach the server.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("grid");
  });

  it("a failure while moving to another month keeps the toolbar usable", async () => {
    const user = userEvent.setup();
    renderCal();
    await screen.findByRole("grid");
    svc.get.mockRejectedValueOnce(new ApiError({ kind: "server", message: "Something went wrong on the server." }));
    await user.click(screen.getByRole("button", { name: "Next month" }));
    await waitFor(() => expect(title()).toBe("December 2026"));
    expect((await screen.findAllByRole("alert")).some((a) => /Something went wrong/.test(a.textContent ?? ""))).toBe(true);
    await user.click(screen.getByRole("button", { name: "Today" }));
    await waitFor(() => expect(title()).toBe("November 2026"));
  });

  it("with no cycles at all every date says so", async () => {
    svc.get.mockImplementation(async (s, e) => ({ ...fakeCalendar(s, e), days: fakeCalendar(s, e).days.map((d) => ({ ...d, cycle: null, week_number: null, plan: null })) }));
    const user = userEvent.setup();
    renderCal();
    await screen.findByRole("grid");
    expect(screen.getAllByRole("gridcell").every((c) => /no workout cycle/.test(c.getAttribute("aria-label") ?? ""))).toBe(true);
    await user.click(screen.getAllByRole("gridcell")[10]);
    expect(await screen.findByText(/No workout cycle covers this date/)).toBeTruthy();
  });
});


describe("starting and resuming workouts", () => {
  const ref = (over: Partial<SessionRef> = {}): SessionRef => ({ id: 9, status: "in_progress", workout_date: "2026-11-19", title: "Chest + Cardio", ...over });

  it("Day view offers Start workout for a planned day and opens the new session", async () => {
    vi.mocked(workoutService.start).mockResolvedValue({ id: 31 } as never);
    renderCal("/calendar?view=day&date=2026-11-19");
    await userEvent.click(await screen.findByRole("button", { name: /Start workout/ }));
    expect(workoutService.start).toHaveBeenCalledWith({ source: "plan", cycle_id: 1, week_number: 1, day_of_week: 3 });
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/workout/31"));
  });

  it("starts a planned day in the past too", async () => {
    vi.mocked(workoutService.start).mockResolvedValue({ id: 32 } as never);
    renderCal("/calendar?view=day&date=2026-11-16");
    await userEvent.click(await screen.findByRole("button", { name: /Start workout/ }));
    expect(workoutService.start).toHaveBeenCalledWith({ source: "plan", cycle_id: 1, week_number: 1, day_of_week: 0 });
  });

  it("Day view shows Resume workout for an unfinished session, with no Start", async () => {
    LOGGED = { "2026-11-19": ref() };
    renderCal("/calendar?view=day&date=2026-11-19");
    const link = await screen.findByRole("link", { name: /Resume workout/ });
    expect(link.getAttribute("href")).toBe("/workout/9");
    expect(screen.queryByRole("button", { name: /Start workout/ })).toBeNull();
  });

  it("Day view shows a completed workout as logged, with a link to it, and no second Start", async () => {
    LOGGED = { "2026-11-19": ref({ status: "completed" }) };
    renderCal("/calendar?view=day&date=2026-11-19");
    expect(await screen.findByText("Workout logged")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View workout" }).getAttribute("href")).toBe("/workout/9");
    expect(screen.queryByRole("button", { name: /Start workout/ })).toBeNull();
  });

  it("offers nothing for a rest day, an unplanned day or a future day", async () => {
    renderCal("/calendar?view=day&date=2026-11-17");                     // rest
    await screen.findByTestId("rest-note");
    expect(screen.queryByRole("button", { name: /Start workout/ })).toBeNull();
    cleanup();
    renderCal("/calendar?view=day&date=2026-11-20");                     // planned nothing (and tomorrow)
    await screen.findByTestId("unplanned");
    expect(screen.queryByRole("button", { name: /Start workout/ })).toBeNull();
    cleanup();
    vi.setSystemTime(new Date("2026-11-17T06:00:00Z"));                  // "today" is Tuesday: Thursday's plan is in the future
    renderCal("/calendar?view=day&date=2026-11-19");
    await screen.findByRole("article", { name: "Chest exercises" });
    expect(screen.queryByRole("button", { name: /Start workout/ })).toBeNull();
  });

  it("never changes the plan: the Calendar only reads", async () => {
    renderCal("/calendar?view=day&date=2026-11-19");
    await screen.findByRole("button", { name: /Start workout/ });
    expect(svc.get).toHaveBeenCalled();
    expect(workoutService.start).not.toHaveBeenCalled();
  });

  it("Week view labels logged and in-progress days", async () => {
    LOGGED = { "2026-11-16": ref({ id: 3, status: "completed", workout_date: "2026-11-16" }), "2026-11-19": ref() };
    renderCal("/calendar?view=week");
    expect((await screen.findByTestId("logged-2026-11-16")).textContent).toBe("Workout logged");
    expect(screen.getByTestId("logged-2026-11-19").textContent).toBe("Workout in progress");
    expect(screen.queryByTestId("logged-2026-11-17")).toBeNull();
  });

  it("Month view marks days with a logged workout and says so for screen readers", async () => {
    LOGGED = { "2026-11-16": ref({ id: 3, status: "completed", workout_date: "2026-11-16" }), "2026-11-19": ref() };
    renderCal();
    await screen.findByRole("grid", { name: "Month" });
    expect(cell(/^Monday, 16 November/).getAttribute("aria-label")).toContain("workout logged");
    expect(cell(/^Thursday, 19 November/).getAttribute("aria-label")).toContain("workout in progress");
    expect(cell(/^Monday, 16 November/).querySelector(".cal-logged")).toBeTruthy();
    expect(cell(/^Tuesday, 17 November/).querySelector(".cal-logged")).toBeNull();
  });
});
