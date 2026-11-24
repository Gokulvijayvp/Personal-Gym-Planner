// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { ToastProvider } from "../components/ui/Toast";
import HomePage from "./HomePage";
import { ApiError } from "../services/apiError";
import { dashboardService } from "../services/dashboardService";
import { settingsService } from "../services/settingsService";
import { workoutService } from "../services/workoutService";
import type { Dashboard } from "../types/dashboard";
import type { Settings } from "../types/settings";
import { chestDay, makeDay, plannedExercise } from "../features/planner/testData";
import {
  WINTER, activeCard, checklist, makeDashboard, summaryOf, weekOf,
} from "../features/home/testData";

vi.mock("../services/dashboardService", () => ({ dashboardService: { get: vi.fn() } }));
vi.mock("../services/settingsService", () => ({ settingsService: { get: vi.fn() } }));
vi.mock("../services/workoutService", () => ({ workoutService: { start: vi.fn() } }));
const dash = vi.mocked(dashboardService);
const sett = vi.mocked(settingsService);
const workouts = vi.mocked(workoutService);

const SETTINGS: Settings = {
  display_name: "Gokul", rest_between_sets_seconds: 90, rest_between_exercises_seconds: 120, target_workout_minutes: 60,
  weight_unit: "kg", distance_unit: "km", week_start: "monday", date_format: "DD MMM YYYY", updated_at: "2026-11-19T10:00:00Z",
};

function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname + l.search}</div>; }
async function renderHome(data: Dashboard = makeDashboard(), settings: Partial<Settings> | "fail" = {}) {
  dash.get.mockResolvedValue(data);
  if (settings === "fail") sett.get.mockRejectedValue(new ApiError({ kind: "network", message: "down" }));
  else sett.get.mockResolvedValue({ ...SETTINGS, ...settings });
  const view = render(<MemoryRouter initialEntries={["/"]}><ToastProvider><HomePage /></ToastProvider><Where /></MemoryRouter>);
  await waitFor(() => expect(screen.queryByRole("status", { name: "Loading your overview" })).toBeNull());
  return view;
}
const today = () => screen.getByTestId("today-card");
const cycleCard = () => screen.getByTestId("active-cycle");
const week = () => screen.getByTestId("week-schedule");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-19T06:00:00Z"));      // 11:30 in India, Thursday 19 Nov 2026
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

describe("greeting and date", () => {
  it("greets by name using the India clock", async () => {
    await renderHome();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Good morning, Gokul");
  });
  it.each([
    ["2026-11-19T08:00:00Z", "Good afternoon"],      // 13:30 IST
    ["2026-11-19T12:00:00Z", "Good evening"],        // 17:30 IST (still afternoon in UTC: proves the app zone is used)
    ["2026-11-19T23:30:00Z", "Good morning"],        // 05:00 IST the next day
  ])("at %s: %s", async (instant, text) => {
    vi.setSystemTime(new Date(instant));
    await renderHome();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(`${text}, Gokul`);
  });
  it("uses a friendly generic greeting when no name is set", async () => {
    await renderHome(makeDashboard(), { display_name: null });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Good morning");
  });
  it.each([
    ["DD MMM YYYY", "Thursday, 19 Nov 2026"],
    ["DD/MM/YYYY", "Thursday, 19/11/2026"],
    ["YYYY-MM-DD", "Thursday, 2026-11-19"],
  ] as const)("shows the date as %s", async (date_format, text) => {
    await renderHome(makeDashboard(), { date_format });
    expect(screen.getByTestId("home-date").textContent).toBe(text);
  });
  it("applies the same format to every date on the page", async () => {
    await renderHome(makeDashboard(), { date_format: "DD/MM/YYYY" });
    expect(within(cycleCard()).getByText("16/11/2026")).toBeTruthy();
    expect(within(cycleCard()).getByText("10/01/2027")).toBeTruthy();
    expect(within(week()).getByRole("heading").textContent).toBe("16/11/2026 – 22/11/2026");
    expect(within(today()).getByRole("heading", { level: 2 }).textContent).toBe("Thursday, 19/11/2026");
    expect(document.body.textContent).not.toMatch(/\bNov\b/);
  });
  it("uses the date from the API (Asia/Kolkata), not the browser clock", async () => {
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    await renderHome();
    expect(screen.getByTestId("home-date").textContent).toBe("Thursday, 19 Nov 2026");
  });
});

describe("loading and errors", () => {
  it("shows a loading state first", () => {
    dash.get.mockReturnValue(new Promise(() => {}));
    sett.get.mockReturnValue(new Promise(() => {}));
    render(<MemoryRouter><ToastProvider><HomePage /></ToastProvider></MemoryRouter>);
    expect(screen.getByRole("status", { name: "Loading your overview" })).toBeTruthy();
  });
  it("shows an error with a working retry when the dashboard cannot load", async () => {
    dash.get.mockRejectedValueOnce(new ApiError({ kind: "network", message: "Can't reach the server." }));
    sett.get.mockResolvedValue(SETTINGS);
    render(<MemoryRouter><ToastProvider><HomePage /></ToastProvider></MemoryRouter>);
    expect(await screen.findByText("Couldn't load your overview")).toBeTruthy();
    expect(screen.getByText("Can't reach the server.")).toBeTruthy();
    dash.get.mockResolvedValue(makeDashboard());
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("today-card")).toBeTruthy();
    expect(dash.get).toHaveBeenCalledTimes(2);
  });
  it("falls back to safe defaults, with a note, when Settings cannot load", async () => {
    await renderHome(makeDashboard(), "fail");
    expect(screen.getByTestId("settings-fallback")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Good morning");
    expect(screen.getByTestId("home-date").textContent).toBe("Thursday, 19 Nov 2026");
    expect(within(today()).getByText(/80 kg/)).toBeTruthy();                         // default unit
    expect(screen.getByTestId("active-cycle")).toBeTruthy();                         // the rest of the page is intact
  });
  it("does not show the fallback note when Settings loaded", async () => {
    await renderHome();
    expect(screen.queryByTestId("settings-fallback")).toBeNull();
  });
});

describe("active cycle card", () => {
  it("shows name, week, progress, dates and length", async () => {
    await renderHome(makeDashboard({ active_cycle: activeCard({ current_week: 3, completed_days: 14, progress_percent: 25, days_remaining: 42 }) }));
    const c = cycleCard();
    expect(within(c).getByRole("heading", { level: 2 }).textContent).toBe("Winter Block");
    expect(within(c).getByText("Active")).toBeTruthy();
    expect(screen.getByTestId("cycle-week").textContent).toBe("Week 3 of 8");
    expect(screen.getByTestId("cycle-progress").textContent).toContain("Progress: 25%");
    expect(screen.getByTestId("cycle-progress").textContent).toContain("42 days left");
    const bar = within(c).getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("25");
    expect((bar.firstElementChild as HTMLElement).style.width).toBe("25%");
    expect(within(c).getByText("16 Nov 2026")).toBeTruthy();
    expect(within(c).getByText("10 Jan 2027")).toBeTruthy();
    expect(within(c).getByText("8 weeks")).toBeTruthy();
    expect(within(c).getByRole("link", { name: /View Workout Cycles/ }).getAttribute("href")).toBe("/cycles");
  });
  it("handles a cycle that has not started", async () => {
    await renderHome(makeDashboard({ active_cycle: activeCard({ state: "upcoming", current_week: null, completed_days: 0, progress_percent: 0, days_until_start: 6, days_remaining: null }) }));
    expect(screen.getByTestId("cycle-week").textContent).toBe("Starts in 6 days");
    expect(screen.getByTestId("cycle-progress").textContent).toBe("Progress: 0%");
  });
  it("handles a cycle whose dates are over", async () => {
    await renderHome(makeDashboard({ active_cycle: activeCard({ state: "ended", current_week: null, completed_days: 56, progress_percent: 100, days_remaining: null }) }));
    expect(screen.getByTestId("cycle-week").textContent).toBe("Ended on 10 Jan 2027");
    expect(within(cycleCard()).getByRole("note").textContent).toMatch(/dates are over/);
  });
  it.each([
    [null, { draft: 0, active: 0, completed: 0, archived: 0 }, "No workout cycle yet", /Create your first cycle/],
    [{ ...WINTER, name: "Idea", status: "draft" as const }, { draft: 1, active: 0, completed: 0, archived: 0 }, "No active cycle", /"Idea" is still a draft/],
    [{ ...WINTER, name: "Done", status: "completed" as const }, { draft: 0, active: 0, completed: 1, archived: 0 }, "No active cycle", /"Done", is completed/],
    [{ ...WINTER, name: "Old", status: "archived" as const }, { draft: 0, active: 0, completed: 0, archived: 1 }, "No active cycle", /Only archived cycles/],
  ])("never presents an inactive cycle as active (%#)", async (other, counts, title, text) => {
    await renderHome(makeDashboard({
      active_cycle: null, other_cycle: other, cycle_counts: counts,
      today: { date: "2026-11-19", day_of_week: 3, cycle: null, week_number: null, plan: null, covered_by_inactive: null },
      week: { start: "2026-11-16", end: "2026-11-22", days: weekOf("2026-11-16", "2026-11-19", null, {}) },
      stats: { ...makeDashboard().stats, active_cycles: 0 },
    }));
    const c = cycleCard();
    expect(within(c).getByRole("heading", { level: 2 }).textContent).toBe(title);
    expect(within(c).getByText(text)).toBeTruthy();
    expect(within(c).queryByText("Active")).toBeNull();
    expect(within(c).queryByRole("progressbar")).toBeNull();
    expect(within(c).getByRole("link").getAttribute("href")).toBe("/cycles");
  });
});

describe("today's workout", () => {
  it("lists muscle groups, exercises, cardio and notes", async () => {
    await renderHome();
    const t = today();
    expect(within(t).getByRole("heading", { level: 2 }).textContent).toBe("Thursday, 19 Nov 2026");
    expect(within(t).getByText("Winter Block · Week 1")).toBeTruthy();
    expect(within(t).getByText("Push day")).toBeTruthy();
    expect(within(t).getByRole("heading", { level: 3, name: "Chest" })).toBeTruthy();
    expect(within(t).getByText("Barbell Bench Press")).toBeTruthy();
    expect(within(t).getByText("4 × 6-8 · 80 kg")).toBeTruthy();
    expect(within(t).getByText("Cable Fly")).toBeTruthy();
    expect(within(t).getByText("3 × 10")).toBeTruthy();                              // no target weight -> no weight shown
    expect(within(t).getByText("Running")).toBeTruthy();
    expect(within(t).getByText("40 min · 5 km")).toBeTruthy();
    expect(within(t).getByText("Pause on the chest.")).toBeTruthy();
  });
  it("opens today in the Workout tab", async () => {
    await renderHome();
    const link = within(today()).getByRole("link", { name: /Open today's workout/ });
    expect(link.getAttribute("href")).toBe("/workout");
    await userEvent.click(link);
    expect(screen.getByTestId("where").textContent).toBe("/workout");
  });
  it("converts weight and distance to the preferred units", async () => {
    await renderHome(makeDashboard(), { weight_unit: "lbs", distance_unit: "miles" });
    const t = today();
    expect(within(t).getByText("4 × 6-8 · 176.4 lbs")).toBeTruthy();
    expect(within(t).getByText("40 min · 3.1 miles")).toBeTruthy();
    expect(t.textContent).not.toMatch(/\bkg\b|\bkm\b/);
  });
  it("shows no weight or distance when none is planned", async () => {
    const plan = chestDay({ day_of_week: 3, date: "2026-11-19", strength: [{ id: 21, muscle_group: { id: 1, name: "Chest" }, notes: null, exercises: [plannedExercise(1, 1, "Push Up")] }], exercise_count: 1 });
    await renderHome(makeDashboard({ today: { ...makeDashboard().today, plan } }), { weight_unit: "lbs" });
    expect(within(today()).getByText("3 × 10")).toBeTruthy();
    expect(today().textContent).not.toMatch(/lbs|kg|miles|km/);
  });
  it("shows Rest Day clearly", async () => {
    const plan = makeDay({ day_of_week: 3, date: "2026-11-19", status: "rest", kind: "rest", display_title: "Rest day", notes: "Stretch." });
    await renderHome(makeDashboard({ today: { ...makeDashboard().today, plan } }));
    expect(within(today()).getByText("Rest Day")).toBeTruthy();
    expect(within(today()).getByText("Stretch.")).toBeTruthy();
    expect(within(today()).queryByText("No workout scheduled today")).toBeNull();
  });
  it("shows a friendly empty state for an unplanned day, with a way to plan it", async () => {
    const plan = makeDay({ day_of_week: 3, date: "2026-11-19" });
    await renderHome(makeDashboard({ today: { ...makeDashboard().today, plan } }));
    expect(within(today()).getByText("No workout scheduled today")).toBeTruthy();
    expect(within(today()).getByRole("link", { name: /Plan today/ }).getAttribute("href")).toBe("/workout");
  });
  it("explains when a draft covers today but is not active", async () => {
    await renderHome(makeDashboard({
      today: { date: "2026-11-19", day_of_week: 3, cycle: null, week_number: null, plan: null, covered_by_inactive: { ...WINTER, name: "Idea", status: "draft" } },
    }));
    expect(within(today()).getByText("No workout scheduled today")).toBeTruthy();
    expect(within(today()).getByText(/"Idea" covers today but is draft/)).toBeTruthy();
  });
  it("explains when no cycle is active at all", async () => {
    await renderHome(makeDashboard({
      active_cycle: null, today: { date: "2026-11-19", day_of_week: 3, cycle: null, week_number: null, plan: null, covered_by_inactive: null },
    }));
    expect(within(today()).getByText("There is no active workout cycle.")).toBeTruthy();
    expect(within(today()).getByRole("link", { name: "Open Workout Cycles" }).getAttribute("href")).toBe("/cycles");
  });
  it("lists only the first eight exercises and points to the planner for the rest", async () => {
    const many = Array.from({ length: 11 }, (_, i) => plannedExercise(i + 1, i + 1, `Exercise ${i + 1}`));
    const plan = chestDay({ day_of_week: 3, date: "2026-11-19", exercise_count: 11, strength: [{ id: 21, muscle_group: { id: 1, name: "Chest" }, notes: null, exercises: many }] });
    await renderHome(makeDashboard({ today: { ...makeDashboard().today, plan } }));
    expect(within(today()).getAllByRole("listitem")).toHaveLength(8);
    expect(within(today()).getByText("+ 3 more exercises in Workout")).toBeTruthy();
  });
});

describe("this week", () => {
  it("shows Monday to Sunday in order, with today highlighted", async () => {
    await renderHome();
    const rows = within(week()).getAllByRole("listitem");
    expect(rows).toHaveLength(7);
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual(
      ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"].map((d) => `home-day-${d}`));
    expect(rows.map((r) => within(r).getByText(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/).textContent)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    const current = week().querySelectorAll("[aria-current=date]");
    expect(current).toHaveLength(1);
    expect(within(current[0] as HTMLElement).getByText("Today")).toBeTruthy();
    expect(current[0].closest("li")!.getAttribute("data-testid")).toBe("home-day-2026-11-19");
  });
  it("summarises each day: groups, counts, cardio, rest, not planned", async () => {
    await renderHome();
    const mon = screen.getByTestId("home-day-2026-11-16");
    expect(within(mon).getByText("Strength")).toBeTruthy();
    expect(within(mon).getByText("Chest")).toBeTruthy();
    expect(within(mon).getByText("2 exercises")).toBeTruthy();
    expect(within(screen.getByTestId("home-day-2026-11-17")).getByText("Rest day")).toBeTruthy();
    const wed = screen.getByTestId("home-day-2026-11-18");
    expect(within(wed).getByText("Cardio")).toBeTruthy();
    expect(within(wed).getByText("1 cardio")).toBeTruthy();
    const thu = screen.getByTestId("home-day-2026-11-19");
    expect(within(thu).getByText("Strength + cardio")).toBeTruthy();
    expect(within(thu).getByText("2 exercises · 1 cardio")).toBeTruthy();
    expect(within(screen.getByTestId("home-day-2026-11-20")).getByText("Not planned")).toBeTruthy();
  });
  it("links each day to that day in the Workout tab", async () => {
    await renderHome();
    const link = within(screen.getByTestId("home-day-2026-11-16")).getByRole("link");
    expect(link.getAttribute("href")).toBe("/workout?date=2026-11-16");
    expect(within(screen.getByTestId("home-day-2026-11-22")).getByRole("link").getAttribute("href")).toBe("/workout?date=2026-11-22");
    await userEvent.click(link);
    expect(screen.getByTestId("where").textContent).toBe("/workout?date=2026-11-16");
  });
  it("gives each row a descriptive accessible name", async () => {
    await renderHome();
    expect(within(screen.getByTestId("home-day-2026-11-19")).getByRole("link").getAttribute("aria-label"))
      .toBe("Thursday 19 Nov 2026 (today): Strength + cardio, Chest, Triceps, 2 exercises. Open in Workout");
  });
  it("caps muscle-group tags", async () => {
    const plan = chestDay({ muscle_groups: ["Chest", "Back", "Legs", "Core", "Arms"].map((n, i) => ({ id: i + 1, name: n })) });
    const days = makeDashboard().week.days.map((d, i) => (i === 0 ? { ...d, plan: summaryOf(plan) } : d));
    await renderHome(makeDashboard({ week: { start: "2026-11-16", end: "2026-11-22", days } }));
    const mon = screen.getByTestId("home-day-2026-11-16");
    expect(within(mon).getByText("+2")).toBeTruthy();
    expect(within(mon).queryByText("Arms")).toBeNull();
  });
  it("says so when the week has a cycle but nothing planned, without counting anything as done", async () => {
    await renderHome(makeDashboard({ week: { start: "2026-11-16", end: "2026-11-22", days: weekOf("2026-11-16", "2026-11-19", WINTER, {}) },
      stats: { ...makeDashboard().stats, planned_days_this_week: 0, rest_days_this_week: 0, planned_exercises_this_week: 0 } }));
    expect(screen.getByTestId("week-empty").textContent).toMatch(/Nothing is planned this week yet/);
    expect(within(week()).getAllByText("Not planned")).toHaveLength(7);
    expect(week().textContent).not.toMatch(/complete|done/i);
  });
  it("shows an empty state, and no day links, when no active cycle covers the week", async () => {
    await renderHome(makeDashboard({ active_cycle: null, week: { start: "2026-11-16", end: "2026-11-22", days: weekOf("2026-11-16", "2026-11-19", null, {}) } }));
    expect(within(week()).getByText("No active cycle this week")).toBeTruthy();
    expect(within(week()).queryAllByRole("listitem")).toHaveLength(0);
  });
  it("renders days outside the cycle as plain, non-link rows", async () => {
    const days = weekOf("2026-11-16", "2026-11-19", WINTER, { 0: chestDay() }).map((d, i) => (i >= 5 ? { ...d, cycle: null, week_number: null, plan: null } : d));
    await renderHome(makeDashboard({ week: { start: "2026-11-16", end: "2026-11-22", days } }));
    const sat = screen.getByTestId("home-day-2026-11-21");
    expect(within(sat).getByText("No active cycle")).toBeTruthy();
    expect(within(sat).queryByRole("link")).toBeNull();
  });
  it("the Calendar shortcut opens the current week", async () => {
    await renderHome();
    expect(within(week()).getByRole("link", { name: "Calendar" }).getAttribute("href")).toBe("/calendar?view=week&date=2026-11-19");
  });
});

describe("overview statistics (planned values only)", () => {
  it("shows exact counts and labels planned values as planned", async () => {
    await renderHome();
    expect(within(screen.getByTestId("stat-sets")).getByText("2")).toBeTruthy();
    expect(within(screen.getByTestId("stat-sets")).getByText("sets saved, like Chest A")).toBeTruthy();
    expect(within(screen.getByTestId("stat-cycles")).getByText("1")).toBeTruthy();
    const planned = screen.getByTestId("stat-planned");
    expect(within(planned).getByText("Planned workout days this week")).toBeTruthy();
    expect(within(planned).getByText("3")).toBeTruthy();
    expect(planned.textContent).toContain("planned, not completed");
    expect(planned.textContent).toContain("1 rest day");
  });
  it("never shows statistics that need workout logging", async () => {
    await renderHome();
    expect(document.body.textContent).not.toMatch(/streak|calories|kcal|personal record|consistency|lifted|volume/i);
  });
});

describe("setup checklist", () => {
  const partial = () => makeDashboard({
    setup: { items: checklist({ exercises: { status: "done", count: 12 }, cycle: { status: "pending", count: 0 }, week_plan: { status: "not_applicable", count: 0, reason: "No active cycle covers this week yet." } }),
      completed: 1, applicable: 2, all_done: false },
  });
  it("shows done, pending and not-applicable steps from the API, each linking to its module", async () => {
    await renderHome(partial());
    const box = screen.getByTestId("setup-checklist");
    expect(screen.getByTestId("setup-count").textContent).toBe("1 of 2 steps done");
    const items = within(box).getAllByRole("listitem");
    expect(items.map((i) => i.getAttribute("data-status"))).toEqual(["done", "pending", "not_applicable"]);
    expect(within(items[0]).getByText("12 sets saved")).toBeTruthy();
    expect(within(items[0]).getByText("Done")).toBeTruthy();
    expect(within(items[0]).getByRole("link").getAttribute("href")).toBe("/exercises?view=mine");
    expect(within(items[1]).getByText("To do")).toBeTruthy();
    expect(within(items[1]).getByRole("link").getAttribute("href")).toBe("/cycles");
    expect(within(items[2]).getByText("No active cycle covers this week yet.")).toBeTruthy();
    expect(within(items[2]).getByText("Not applicable")).toBeTruthy();
    expect(within(items[2]).queryByRole("link")).toBeNull();
  });
  it("links the planning step to the active cycle's current week", async () => {
    const data = makeDashboard({
      active_cycle: activeCard({ current_week: 3 }),
      setup: { items: checklist({ week_plan: { status: "pending", count: 0 } }), completed: 2, applicable: 3, all_done: false },
    });
    await renderHome(data);
    expect(within(screen.getByTestId("setup-checklist")).getByRole("link", { name: /Plan workouts for this week/ }).getAttribute("href")).toBe("/planner?cycle=1&week=3");
  });
  it("collapses to a single line when everything is done", async () => {
    await renderHome();
    const box = screen.getByTestId("setup-checklist");
    expect(within(box).getByRole("heading", { level: 2 }).textContent).toBe("Setup complete");
    expect(within(box).queryAllByRole("listitem")).toHaveLength(0);
    expect(within(box).getByText(/All 3 setup steps are done/)).toBeTruthy();
  });
  it("keeps a not-applicable step visible, with its reason, even when everything else is done", async () => {
    await renderHome(makeDashboard({
      setup: { items: checklist({ week_plan: { status: "not_applicable", count: 0, reason: "No active cycle covers this week yet." } }),
        completed: 2, applicable: 2, all_done: true },
    }));
    const box = screen.getByTestId("setup-checklist");
    expect(within(box).getByRole("heading", { level: 2 }).textContent).toBe("Setup complete");
    const items = within(box).getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(items[0].getAttribute("data-status")).toBe("not_applicable");
    expect(within(items[0]).getByText("No active cycle covers this week yet.")).toBeTruthy();
  });
  it("reports nothing as done on a brand-new install", async () => {
    await renderHome(makeDashboard({
      setup: { items: checklist({ exercises: { status: "pending", count: 0 }, cycle: { status: "pending", count: 0 }, week_plan: { status: "not_applicable", count: 0, reason: "No active cycle covers this week yet." } }),
        completed: 0, applicable: 2, all_done: false },
    }));
    expect(screen.getByTestId("setup-count").textContent).toBe("0 of 2 steps done");
    expect(within(screen.getByTestId("setup-checklist")).queryByText("Done", { selector: ".sr-only" })).toBeNull();
  });
});

describe("starting and resuming a workout", () => {
  const REF = (over = {}) => ({ id: 9, status: "in_progress" as const, workout_date: "2026-11-19", title: "Push day", ...over });
  const startButton = () => within(today()).queryByRole("button", { name: /Start workout/ });

  it("offers Start workout on a planned day and opens the new session", async () => {
    workouts.start.mockResolvedValue({ id: 31 } as never);
    await renderHome();
    await userEvent.click(startButton()!);
    expect(workouts.start).toHaveBeenCalledWith({ source: "plan", cycle_id: 1, week_number: 1, day_of_week: 3 });
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/workout/31"));
  });
  it("ignores repeated taps while the start is in flight", async () => {
    let done!: (v: never) => void;
    workouts.start.mockReturnValue(new Promise((res) => { done = res as never; }));
    await renderHome();
    const button = startButton()!;
    fireEvent.click(button); fireEvent.click(button); fireEvent.click(button);
    expect(workouts.start).toHaveBeenCalledTimes(1);
    expect(within(today()).getByRole("button", { name: /Starting/ }).hasAttribute("disabled")).toBe(true);
    await act(async () => done({ id: 5 } as never));
  });
  it("opens the existing workout when one is already in progress for that day", async () => {
    workouts.start.mockRejectedValue(new ApiError({ kind: "client", status: 409, code: "session_in_progress", message: "A workout is already in progress",
      details: [{ field: "session_id", message: "77", type: "existing_session" }] }));
    await renderHome();
    await userEvent.click(startButton()!);
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/workout/77"));
  });
  it("shows an error and stays put if starting fails", async () => {
    workouts.start.mockRejectedValue(new ApiError({ kind: "network", message: "Can't reach the server." }));
    await renderHome();
    await userEvent.click(startButton()!);
    expect(await screen.findByText("Can't reach the server.")).toBeTruthy();
    expect(screen.getByTestId("where").textContent).toBe("/");
    expect(startButton()!.hasAttribute("disabled")).toBe(false);
  });
  it("shows Resume workout, not Start, when today's workout is unfinished", async () => {
    await renderHome(makeDashboard({ today_workout: REF(), in_progress_session: REF() }));
    expect(startButton()).toBeNull();
    const link = within(today()).getByRole("link", { name: /Resume workout/ });
    expect(link.getAttribute("href")).toBe("/workout/9");
    expect(workouts.start).not.toHaveBeenCalled();
  });
  it("offers to resume an unfinished workout from an earlier day, and still allows starting today's", async () => {
    await renderHome(makeDashboard({ in_progress_session: REF({ id: 4, workout_date: "2026-11-17" }) }));
    expect(within(today()).getByRole("link", { name: "Resume workout (17 Nov 2026)" }).getAttribute("href")).toBe("/workout/4");
    expect(startButton()).toBeTruthy();
  });
  it("shows that today's workout is logged, with a link to it, and no second Start", async () => {
    await renderHome(makeDashboard({ today_workout: REF({ status: "completed" }) }));
    expect(startButton()).toBeNull();
    expect(within(today()).getByText("Workout logged")).toBeTruthy();
    expect(within(today()).getByRole("link", { name: "View workout" }).getAttribute("href")).toBe("/workout/9");
  });
  it("never offers Start on a rest day, an empty day or without an active cycle; blank logging is a deliberate link", async () => {
    const rest = makeDay({ day_of_week: 3, date: "2026-11-19", status: "rest", kind: "rest", display_title: "Rest day" });
    await renderHome(makeDashboard({ today: { ...makeDashboard().today, plan: rest } }));
    expect(startButton()).toBeNull();
    expect(within(today()).getByRole("link", { name: "Log a workout anyway" }).getAttribute("href")).toBe("/workout");
    cleanup();
    await renderHome(makeDashboard({ today: { ...makeDashboard().today, plan: makeDay({ day_of_week: 3, date: "2026-11-19" }) } }));
    expect(startButton()).toBeNull();
    expect(within(today()).getByRole("link", { name: "Log a workout anyway" })).toBeTruthy();
    cleanup();
    await renderHome(makeDashboard({ active_cycle: null, today: { date: "2026-11-19", day_of_week: 3, cycle: null, week_number: null, plan: null, covered_by_inactive: null } }));
    expect(startButton()).toBeNull();
  });
});

describe("recent activity", () => {
  it("is an honest empty state when nothing has been completed", async () => {
    await renderHome();
    const box = screen.getByTestId("recent-activity");
    expect(within(box).getByText("No workout history yet")).toBeTruthy();
    expect(within(box).getByText(/Finish a workout and it will show up here/)).toBeTruthy();
    expect(within(box).queryAllByRole("listitem")).toHaveLength(0);
    expect(box.textContent).not.toMatch(/\d/);                                       // no fake dates, weights or counts
  });
  it("lists real completed workouts, newest first, each opening its log", async () => {
    await renderHome(makeDashboard({ recent_activity: [
      { id: 12, workout_date: "2026-11-18", title: "Pull day", cycle_name: "Winter Block", ended_at: "2026-11-18T06:30:00Z", duration_seconds: 3725, completed_exercise_count: 4, completed_sets: 14, cardio_minutes: 15 },
      { id: 11, workout_date: "2026-11-16", title: null, cycle_name: null, ended_at: "2026-11-16T06:00:00Z", duration_seconds: 1800, completed_exercise_count: 1, completed_sets: 1, cardio_minutes: 0 },
    ] }), { date_format: "DD/MM/YYYY" });
    const box = screen.getByTestId("recent-activity");
    const rows = within(box).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("Pull day")).toBeTruthy();
    expect(within(rows[0]).getByText("Wed, 18/11/2026 · 1 h 2 min")).toBeTruthy();
    expect(within(rows[0]).getByText(/4 exercises · 14 sets · 15 min cardio/)).toBeTruthy();
    expect(within(rows[1]).getByText("Workout")).toBeTruthy();
    expect(within(rows[1]).getByText(/1 exercise · 1 set$/)).toBeTruthy();
    expect(within(rows[0]).getByRole("link").getAttribute("href")).toBe("/workout/12");
    expect(within(box).getByRole("link", { name: "All workouts" }).getAttribute("href")).toBe("/workout");
    await userEvent.click(within(rows[1]).getByRole("link"));
    expect(screen.getByTestId("where").textContent).toBe("/workout/11");
  });
});

describe("quick links", () => {
  it("offers four shortcuts, each inside one of the four tabs", async () => {
    await renderHome();
    const nav = screen.getByRole("navigation", { name: "Quick links" });
    const hrefs = Object.fromEntries(within(nav).getAllByRole("link").map((a) => [a.textContent!.trim(), a.getAttribute("href")]));
    expect(hrefs).toEqual({
      "Today's workout": "/workout", "Add an exercise": "/workout?add=1", "Quick setup": "/workout?setup=1", "See my progress": "/progress",
    });
  });
  it("navigates", async () => {
    await renderHome();
    await userEvent.click(screen.getByRole("link", { name: "Quick setup" }));
    expect(screen.getByTestId("where").textContent).toBe("/workout?setup=1");
  });
});

describe("read-only", () => {
  it("only reads on load: one dashboard call, one settings call, and merely opening Home starts no workout", async () => {
    await renderHome();
    expect(dash.get).toHaveBeenCalledTimes(1);
    expect(sett.get).toHaveBeenCalledTimes(1);
    expect(workouts.start).not.toHaveBeenCalled();
  });
});
