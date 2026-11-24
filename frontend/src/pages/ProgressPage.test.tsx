// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import ProgressPage from "./ProgressPage";
import { ApiError } from "../services/apiError";
import { progressService } from "../services/progressService";
import { settingsService } from "../services/settingsService";
import { workoutService } from "../services/workoutService";
import { dashboardService } from "../services/dashboardService";
import { makeDashboard } from "../features/home/testData";
import type { Settings } from "../types/settings";
import type { SessionListItem } from "../types/workout";
import {
  CONSISTENCY, EMPTY_OVERVIEW, MUSCLES, OPTIONS, OVERVIEW, RECORDS, VOLUME, cardio, exerciseProgress,
} from "../features/progress/testData";

vi.mock("../services/progressService", () => ({
  progressService: { overview: vi.fn(), consistency: vi.fn(), exercises: vi.fn(), exercise: vi.fn(), volume: vi.fn(), records: vi.fn(), muscleGroups: vi.fn(), cardio: vi.fn() },
}));
vi.mock("../services/dashboardService", () => ({ dashboardService: { get: vi.fn() } }));
vi.mock("../services/settingsService", () => ({ settingsService: { get: vi.fn() } }));
vi.mock("../services/workoutService", () => ({ workoutService: { list: vi.fn() } }));
const api = vi.mocked(progressService);

const SETTINGS: Settings = {
  display_name: null, rest_between_sets_seconds: 90, rest_between_exercises_seconds: 120, target_workout_minutes: 60,
  weight_unit: "kg", distance_unit: "km", week_start: "monday", date_format: "DD MMM YYYY", updated_at: "2026-11-19T10:00:00Z",
};
const SESSION = (over: Partial<SessionListItem> = {}): SessionListItem => ({
  id: 11, workout_date: "2026-11-16", status: "completed", source: "plan", title: "Push day", cycle_name: "Winter", started_at: "x", ended_at: "y",
  duration_seconds: 3725, exercise_count: 5, completed_exercise_count: 4, completed_sets: 14, cardio_minutes: 15, exercise_names: ["Barbell Bench Press"], ...over,
});

function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname + l.search}</div>; }
async function open(url = "/progress", settings: Partial<Settings> = {}) {
  vi.mocked(settingsService.get).mockResolvedValue({ ...SETTINGS, ...settings });
  render(<MemoryRouter initialEntries={[url]}><ProgressPage /><Where /></MemoryRouter>);
  await screen.findByTestId("overview", {}, { timeout: 3000 }).catch(() => undefined);
}
const where = () => screen.getByTestId("where").textContent;
const last = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls[fn.mock.calls.length - 1];
const tab = (name: RegExp | string) => screen.getByRole("tab", { name });
const panel = () => screen.getByRole("tabpanel");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-19T06:00:00Z"));           // 11:30 Thursday 19 Nov 2026 in India
  window.scrollTo = vi.fn();
  api.overview.mockResolvedValue(OVERVIEW);
  api.consistency.mockResolvedValue(CONSISTENCY);
  api.exercises.mockResolvedValue(OPTIONS);
  api.exercise.mockImplementation(async (key) => exerciseProgress({ key, name: OPTIONS.exercises.find((x) => x.key === key)?.name ?? "x" }));
  api.volume.mockResolvedValue(VOLUME);
  api.records.mockResolvedValue(RECORDS);
  api.muscleGroups.mockResolvedValue(MUSCLES);
  api.cardio.mockResolvedValue(cardio());
  vi.mocked(workoutService.list).mockResolvedValue({ items: [SESSION()], total: 1, page: 1, page_size: 5 });
  vi.mocked(settingsService.get).mockResolvedValue(SETTINGS);
  vi.mocked(dashboardService.get).mockResolvedValue(makeDashboard());
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth; });

// ============================================================================================
describe("current plan", () => {
  it("shows the plan you are following right now, above the date range", async () => {
    await open();
    const card = await screen.findByTestId("current-plan");
    expect(card.textContent).toContain("CURRENT PLAN");
    expect(within(card).getByRole("progressbar", { name: "Plan progress" })).toBeTruthy();
    expect(within(card).getByTestId("plan-this-week").textContent).toContain("3 workout days planned");
    expect(within(card).getByRole("link", { name: /Open Workout/ }).getAttribute("href")).toBe("/workout");
  });

  it("is not shown when there is no active plan, and a failure never breaks the page", async () => {
    vi.mocked(dashboardService.get).mockResolvedValue(makeDashboard({ active_cycle: null }));
    await open();
    await screen.findByTestId("range-select");
    expect(screen.queryByTestId("current-plan")).toBeNull();
    cleanup();
    vi.mocked(dashboardService.get).mockRejectedValue(new Error("down"));
    await open();
    expect(await screen.findByTestId("range-select")).toBeTruthy();
    expect(screen.queryByTestId("current-plan")).toBeNull();
  });
});

describe("date range", () => {
  it("defaults to the last 30 days (today in Asia/Kolkata included) and asks every card for it", async () => {
    await open();
    expect(last(api.overview)[0]).toEqual({ start: "2026-10-21", end: "2026-11-19" });
    await waitFor(() => expect(api.consistency).toHaveBeenCalled());
    expect(last(api.consistency)[0]).toEqual({ start: "2026-10-21", end: "2026-11-19" });
    expect(vi.mocked(workoutService.list)).toHaveBeenCalledWith({ status: "completed", start: "2026-10-21", end: "2026-11-19", page: 1, page_size: 5 }, expect.anything());
    expect((screen.getByTestId("range-select") as HTMLSelectElement).value).toBe("30d");
    expect(screen.getByTestId("range-summary").textContent).toBe("21 Oct 2026 – 19 Nov 2026");
  });

  it.each([
    ["7d", { start: "2026-11-13", end: "2026-11-19" }], ["90d", { start: "2026-08-22", end: "2026-11-19" }],
    ["6m", { start: "2026-05-20", end: "2026-11-19" }], ["12m", { start: "2025-11-20", end: "2026-11-19" }], ["all", {}],
  ])("choosing %s updates the overview, every tab and the history", async (value, query) => {
    await open();
    await userEvent.selectOptions(screen.getByTestId("range-select"), value);
    await waitFor(() => expect(last(api.overview)[0]).toEqual(query));
    await waitFor(() => expect(last(api.consistency)[0]).toEqual(query));
    expect(where()).toContain(`range=${value}`);
    await userEvent.click(tab("Volume"));
    await waitFor(() => expect(last(api.volume)[0]).toEqual(query));
  });

  it("'all time' sends no dates so the server uses the first workout", async () => {
    await open("/progress?range=all");
    expect(last(api.overview)[0]).toEqual({});
  });

  it("a custom range takes two dates, validates them, and queries only when valid", async () => {
    await open();
    await userEvent.selectOptions(screen.getByTestId("range-select"), "custom");
    expect(screen.getByRole("alert").textContent).toMatch(/both a start and an end date/);
    expect(screen.getByTestId("range-needed").textContent).toMatch(/Choose a valid date range above/);
    const calls = api.overview.mock.calls.length;
    fireEvent.change(screen.getByTestId("range-from"), { target: { value: "2026-11-10" } });
    fireEvent.change(screen.getByTestId("range-to"), { target: { value: "2026-11-01" } });
    expect(screen.getByRole("alert").textContent).toMatch(/on or after/);
    expect(api.overview.mock.calls.length).toBe(calls);                                       // nothing is requested for an invalid range
    fireEvent.change(screen.getByTestId("range-to"), { target: { value: "2026-11-15" } });
    await waitFor(() => expect(last(api.overview)[0]).toEqual({ start: "2026-11-10", end: "2026-11-15" }));
    expect(where()).toContain("range=custom");
    expect(where()).toContain("from=2026-11-10");
    expect(where()).toContain("to=2026-11-15");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("restores the range from the URL (refresh, back button, shared link)", async () => {
    await open("/progress?range=custom&from=2026-09-01&to=2026-09-30&tab=volume");
    expect((screen.getByTestId("range-select") as HTMLSelectElement).value).toBe("custom");
    expect((screen.getByTestId("range-from") as HTMLInputElement).value).toBe("2026-09-01");
    expect(last(api.overview)[0]).toEqual({ start: "2026-09-01", end: "2026-09-30" });
    await waitFor(() => expect(last(api.volume)[0]).toEqual({ start: "2026-09-01", end: "2026-09-30" }));
    expect(tab("Volume").getAttribute("aria-selected")).toBe("true");
  });

  it("the date inputs cannot pick a future day", async () => {
    await open("/progress?range=custom&from=2026-11-01&to=2026-11-10");
    expect(screen.getByTestId("range-to").getAttribute("max")).toBe("2026-11-19");
  });
});

// ============================================================================================
describe("overview cards", () => {
  it("show each metric with its own one-line definition", async () => {
    await open();
    const ov = within(screen.getByTestId("overview"));
    expect(screen.getByTestId("ov-workouts").textContent).toContain("6");
    expect(screen.getByTestId("ov-sets").textContent).toContain("54");
    expect(screen.getByTestId("ov-volume").textContent).toContain("12,346 kg");
    expect(screen.getByTestId("ov-duration").textContent).toContain("6 h");
    expect(screen.getByTestId("ov-average").textContent).toContain("1 h");
    expect(screen.getByTestId("ov-tdpw").textContent).toContain("1.4");
    expect(screen.getByTestId("ov-tdpw").textContent).toContain("6 training days ÷ 4.3 weeks");
    expect(ov.getByText("Weight × reps, completed loaded sets")).toBeTruthy();
    expect(ov.getByText("Finished workouts in the range")).toBeTruthy();
  });

  it("explains how everything is calculated", async () => {
    await open();
    const defs = screen.getByText("How these numbers are calculated").closest("details")!;
    expect(defs.textContent).toMatch(/Cancelled and unfinished workouts/);
    expect(defs.textContent).toMatch(/not a measure of muscle growth/);
    expect(defs.textContent).toMatch(/at least 7 days/);
  });

  it("uses dashes, not made-up averages, when there is nothing to average", async () => {
    api.overview.mockResolvedValue({ ...EMPTY_OVERVIEW });
    await open();
    expect(screen.getByTestId("overview-empty").textContent).toMatch(/No completed workouts in this range/);
    for (const id of ["ov-volume", "ov-duration", "ov-average", "ov-tdpw"]) expect(screen.getByTestId(id).textContent).toContain("—");
    expect(screen.getByTestId("ov-workouts").textContent).toContain("0");
    expect(screen.getByRole("link", { name: "Go to Workout" }).getAttribute("href")).toBe("/workout");
  });

  it("an empty range shows a dash for the weekly rate even though the server computes 0", async () => {
    api.overview.mockResolvedValue({ ...EMPTY_OVERVIEW, training_days_per_week: 0, workouts_per_week: 0 });
    await open();
    expect(screen.getByTestId("ov-tdpw").textContent).toContain("—");
    expect(screen.getByTestId("ov-tdpw").textContent).toContain("Needs completed workouts");
    expect(screen.getByTestId("ov-tdpw").textContent).not.toMatch(/0/);
  });

  it("does not show a per-week figure for a range under a week", async () => {
    api.overview.mockResolvedValue({ ...OVERVIEW, training_days_per_week: null, workouts_per_week: null });
    await open("/progress?range=7d");
    expect(screen.getByTestId("ov-tdpw").textContent).toContain("—");
    expect(screen.getByTestId("ov-tdpw").textContent).toContain("Needs a range of at least 7 days");
  });

  it("converts volume to the preferred unit and keeps stored values untouched", async () => {
    await open("/progress", { weight_unit: "lbs" });
    await waitFor(() => expect(screen.getByTestId("ov-volume").textContent).toContain("27,217 lbs"));
    expect(screen.getByTestId("ov-volume").textContent).not.toContain(" kg");
  });

  it("an all-time range with no history says so", async () => {
    api.overview.mockResolvedValue({ ...EMPTY_OVERVIEW, range: { start: null, end: "2026-11-19", days: 0, all_time: true, end_clamped: false } });
    await open("/progress?range=all");
    expect(screen.getByTestId("overview-empty").textContent).toMatch(/not finished a workout yet/);
    expect(screen.getByTestId("range-summary").textContent).toBe("No completed workouts yet");
  });

  it("shows an error with retry, and a loading state first", async () => {
    api.overview.mockRejectedValueOnce(new ApiError({ kind: "network", message: "Can't reach the server." }));
    vi.mocked(settingsService.get).mockResolvedValue(SETTINGS);
    render(<MemoryRouter><ProgressPage /></MemoryRouter>);
    expect(screen.getByRole("status", { name: "Loading your overview" })).toBeTruthy();
    expect(await screen.findByText("Couldn't load your overview")).toBeTruthy();
    api.overview.mockResolvedValue(OVERVIEW);
    await userEvent.click(screen.getAllByRole("button", { name: "Try again" })[0]);
    expect(await screen.findByTestId("overview")).toBeTruthy();
  });
});

// ============================================================================================
describe("consistency", () => {
  it("shows the weekly chart with zero weeks included, plus the three headline figures", async () => {
    await open();
    const group = await screen.findByRole("group", { name: "Completed workouts by week" });
    expect(within(group).getAllByRole("img")).toHaveLength(5);
    expect(within(group).getByRole("img", { name: /Week of 26 Oct 2026: 0 workouts on 0 training days/ })).toBeTruthy();
    expect(within(group).getByRole("img", { name: /Week of 02 Nov 2026: 3 workouts on 2 training days/ })).toBeTruthy();
    expect(within(group).getByRole("img", { name: /Week of 19 Oct 2026: 1 workout on 1 training day \(partial week\)/ })).toBeTruthy();
    expect(screen.getByTestId("cons-days").textContent).toContain("5");
    expect(screen.getByTestId("cons-days").textContent).toContain("Two workouts on one day count once");
    expect(screen.getByTestId("cons-wpw").textContent).toContain("1.4");
    expect(screen.getByTestId("cons-dpw").textContent).toContain("1.17");
    expect(screen.getByText(/Weeks run Monday to Sunday/)).toBeTruthy();
  });

  it("switches to months", async () => {
    await open();
    await screen.findByRole("group", { name: "Completed workouts by week" });
    await userEvent.click(screen.getByRole("button", { name: "Months" }));
    const group = screen.getByRole("group", { name: "Completed workouts by month" });
    expect(within(group).getAllByRole("img")).toHaveLength(2);
    expect(within(group).getByRole("img", { name: /Nov 2026: 4 workouts on 3 training days \(partial month\)/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Months" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("shows how often you trained in full weeks only", async () => {
    await open();
    await screen.findByRole("group", { name: "Completed workouts by week" });
    const list = screen.getByRole("list", { name: "Weeks by number of training days" });
    expect(within(list).getByText("0 training days").closest("li")!.textContent).toContain("1 week");
    expect(within(list).getByText("2 training days").closest("li")!.textContent).toContain("1 week");
    expect(screen.getByText(/Full weeks only/)).toBeTruthy();
  });

  it("follows the date-format setting", async () => {
    await open("/progress", { date_format: "DD/MM/YYYY" });
    const group = await screen.findByRole("group", { name: "Completed workouts by week" });
    expect(within(group).getByRole("img", { name: /Week of 02\/11\/2026/ })).toBeTruthy();
    expect(Array.from(group.querySelectorAll(".chart-label")).map((l) => l.textContent)).toContain("02/11");
  });

  it("an empty range is an honest empty state, not a flat chart", async () => {
    api.consistency.mockResolvedValue({ ...CONSISTENCY, workouts: 0, training_days: 0, weeks: CONSISTENCY.weeks.map((w) => ({ ...w, workouts: 0, training_days: 0 })) });
    await open();
    expect((await screen.findByTestId("progress-empty")).textContent).toMatch(/No completed workouts in this range/);
    expect(screen.queryByRole("group", { name: /Completed workouts by/ })).toBeNull();
  });

  it("no per-week averages when the range is under a week", async () => {
    api.consistency.mockResolvedValue({ ...CONSISTENCY, average_workouts_per_week: null, average_training_days_per_week: null });
    await open();
    expect((await screen.findByTestId("cons-wpw")).textContent).toContain("—");
    expect(screen.getByTestId("cons-wpw").textContent).toContain("Needs a range of at least 7 days");
  });

  it("shows an error with retry", async () => {
    api.consistency.mockRejectedValueOnce(new ApiError({ kind: "server", status: 500, message: "Something went wrong on the server." }));
    await open();
    expect(await screen.findByText("Couldn't load your consistency")).toBeTruthy();
    await userEvent.click(within(panel()).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("group", { name: "Completed workouts by week" })).toBeTruthy();
  });
});

// ============================================================================================
describe("exercise strength progression", () => {
  const strength = async (url = "/progress?tab=strength", settings: Partial<Settings> = {}) => { await open(url, settings); await screen.findByTestId("exercise-select"); };

  it("lists exercises with completed sets and opens the one with the most sets", async () => {
    await strength();
    const select = screen.getByTestId("exercise-select") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["Barbell Bench Press (20 sets)", "Barbell Squat (12 sets)", "Pull Up (9 sets)"]);
    await waitFor(() => expect(last(api.exercise)[0]).toBe("id:2"));
    expect(select.value).toBe("id:2");
  });

  it("asks for the chosen exercise and the chosen range, and keeps the choice in the URL", async () => {
    await strength();
    await userEvent.selectOptions(screen.getByTestId("exercise-select"), "id:3");
    await waitFor(() => expect(last(api.exercise)).toEqual(["id:3", { start: "2026-10-21", end: "2026-11-19" }, expect.anything()]));
    expect(where()).toContain("exercise=id%3A3");
    await screen.findByRole("group", { name: "Barbell Squat heaviest completed weight by date" });
  });

  it("restores the selected exercise from the URL", async () => {
    await strength("/progress?tab=strength&exercise=id%3A3");
    expect((screen.getByTestId("exercise-select") as HTMLSelectElement).value).toBe("id:3");
    await waitFor(() => expect(last(api.exercise)[0]).toBe("id:3"));
  });

  it("falls back to a valid exercise when the URL names one with no data in this range", async () => {
    await strength("/progress?tab=strength&exercise=id%3A999");
    expect((screen.getByTestId("exercise-select") as HTMLSelectElement).value).toBe("id:2");
  });

  it("shows best weight, best reps, set counts, frequency and volume with dates in your format", async () => {
    await strength("/progress?tab=strength", { date_format: "DD/MM/YYYY" });
    await screen.findByTestId("ex-best-weight");
    expect(screen.getByTestId("ex-best-weight").textContent).toContain("80 kg");
    expect(screen.getByTestId("ex-best-weight").textContent).toContain("First reached 16/11/2026");
    expect(screen.getByTestId("ex-best-reps").textContent).toContain("12");
    expect(screen.getByTestId("ex-sets").textContent).toContain("20");
    expect(screen.getByTestId("ex-sets").textContent).toContain("5 workouts · 5 training days");
    expect(screen.getByTestId("ex-freq").textContent).toContain("1.17");
    expect(screen.getByTestId("ex-volume").textContent).toContain("6,401 kg");
  });

  it("draws the weight line chart in the preferred unit with exact tooltips", async () => {
    await strength("/progress?tab=strength", { weight_unit: "lbs" });
    const chart = await screen.findByRole("group", { name: "Barbell Bench Press heaviest completed weight by date" });
    expect(within(chart).getAllByRole("img")).toHaveLength(3);
    expect(within(chart).getByRole("img", { name: "22 Oct 2026: 137.8 lbs × 8 reps · 4 completed sets" })).toBeTruthy();
    expect(within(chart).getByRole("img", { name: "16 Nov 2026: 176.4 lbs × 4 reps · 4 completed sets" })).toBeTruthy();
    expect(within(chart).getByText("lbs", { selector: "text" })).toBeTruthy();
    expect(screen.getByTestId("ex-best-weight").textContent).toContain("176.4 lbs");
    expect(panel().textContent).not.toMatch(/\bkg\b/);
  });

  it("draws a separate reps chart", async () => {
    await strength();
    const chart = await screen.findByRole("group", { name: "Barbell Bench Press best reps by date" });
    expect(within(chart).getByRole("img", { name: "22 Oct 2026: 12 reps in your best set · 36 reps in total" })).toBeTruthy();
    expect(within(chart).getByText("Reps", { selector: "text" })).toBeTruthy();
  });

  it("reports an improvement only when the server says there is a valid comparison", async () => {
    await strength();
    expect((await screen.findByTestId("improvement")).textContent).toMatch(/\+17.5 kg \(\+28%\) in best weight, from 62.5 kg on 22 Oct 2026 to 80 kg on 16 Nov 2026/);
    api.exercise.mockResolvedValue(exerciseProgress({ improvement: null, improvement_note: "Needs at least 3 training dates with a logged weight, spread over 14 days or more, before a change is shown." }));
    await userEvent.selectOptions(screen.getByTestId("exercise-select"), "id:3");
    await waitFor(() => expect(screen.getByTestId("improvement").textContent).toMatch(/Needs at least 3 training dates/));
    expect(screen.getByTestId("improvement").textContent).not.toMatch(/%/);
  });

  it("a negative change is shown as a decrease, honestly", async () => {
    api.exercise.mockResolvedValue(exerciseProgress({ improvement: { from_date: "2026-10-22", to_date: "2026-11-16", from_weight_kg: 80, to_weight_kg: 70, change_kg: -10, change_percent: -12.5 } }));
    await strength();
    expect((await screen.findByTestId("improvement")).textContent).toMatch(/−10 kg \(-12.5%\)/);
  });

  it("lists the best reps at each weight", async () => {
    await strength();
    const table = await screen.findByTestId("reps-at-weight");
    const rows = within(table).getAllByRole("row").slice(1).map((r) => Array.from(r.children).map((c) => c.textContent));
    expect(rows).toEqual([["80 kg", "4", "16 Nov 2026"], ["62.5 kg", "8", "22 Oct 2026"]]);
  });

  it("a bodyweight exercise has no weight chart but still shows its reps", async () => {
    api.exercise.mockResolvedValue(exerciseProgress({
      key: "id:4", name: "Pull Up", best_weight: null, total_volume_kg: 0, reps_at_weight: [], improvement: null, improvement_note: "No external weight was logged for this exercise in this range.",
      series: [{ date: "2026-11-02", sets: 3, best_weight_kg: null, reps_at_best_weight: null, max_reps: 10, total_reps: 26, volume_kg: 0 }, { date: "2026-11-12", sets: 3, best_weight_kg: null, reps_at_best_weight: null, max_reps: 12, total_reps: 30, volume_kg: 0 }] }));
    await strength("/progress?tab=strength&exercise=id%3A4");
    expect(await screen.findByText("No external weight logged")).toBeTruthy();
    expect(screen.queryByRole("group", { name: /heaviest completed weight/ })).toBeNull();
    expect(screen.getByTestId("ex-best-weight").textContent).toContain("—");
    expect(await screen.findByRole("group", { name: "Pull Up best reps by date" })).toBeTruthy();
    expect(screen.getByTestId("ex-volume").textContent).toContain("0 kg");
  });

  it("one training day gives a dot and an honest note instead of a line", async () => {
    api.exercise.mockResolvedValue(exerciseProgress({ series: [exerciseProgress().series[0]], improvement: null, improvement_note: "Needs more." }));
    await strength();
    expect(await screen.findAllByText(/Only one training date so far/)).toHaveLength(2);
  });

  it("empty range: says there are no completed sets and offers no selector", async () => {
    api.exercises.mockResolvedValue({ ...OPTIONS, exercises: [] });
    await open("/progress?tab=strength");
    expect((await screen.findByTestId("progress-empty")).textContent).toMatch(/No completed sets in this range/);
    expect(screen.queryByTestId("exercise-select")).toBeNull();
    expect(api.exercise).not.toHaveBeenCalled();
  });

  it("exposes the numbers behind the chart as a table", async () => {
    await strength();
    await screen.findByTestId("ex-best-weight");
    expect(within(panel()).getAllByText("View as a table").length).toBeGreaterThan(0);
  });

  it("shows an error with retry for the exercise", async () => {
    api.exercise.mockRejectedValueOnce(new ApiError({ kind: "server", status: 500, message: "Something went wrong on the server." }));
    await strength();
    expect(await screen.findByText("Couldn't load this exercise")).toBeTruthy();
    expect(screen.getByTestId("exercise-select")).toBeTruthy();                                      // the selector stays usable
  });
});

// ============================================================================================
describe("training volume", () => {
  it("shows the total, which sets count and which do not, and the muscle-group split", async () => {
    await open("/progress?tab=volume");
    await screen.findByTestId("vol-total");
    expect(screen.getByTestId("vol-total").textContent).toContain("12,346 kg");
    expect(screen.getByTestId("vol-counted").textContent).toContain("40");
    expect(screen.getByTestId("vol-excluded").textContent).toContain("14");
    expect(screen.getByTestId("vol-excluded").textContent).toMatch(/no volume is invented/);
    expect(screen.getByRole("group", { name: "Training volume by week" })).toBeTruthy();
    const ex = screen.getByRole("list", { name: "Volume by exercise" });
    expect(within(ex).getAllByRole("listitem").map((l) => l.querySelector("b")!.textContent)).toEqual(["Barbell Squat", "Barbell Bench Press"]);
    expect(within(ex).getByText("7,000 kg")).toBeTruthy();
    const groups = screen.getByRole("list", { name: "Volume by muscle group" });
    expect(within(groups).getByText("Quadriceps")).toBeTruthy();
    expect(within(groups).getByText("Unassigned").closest("li")!.className).toContain("is-muted");
    expect(within(groups).getByText("Logged without a muscle group, so not guessed")).toBeTruthy();
  });

  it("is labelled as logged volume and says cardio is excluded", async () => {
    await open("/progress?tab=volume");
    expect((await screen.findByText(/logged training volume \(weight × reps\)/)).textContent).toMatch(/not a measurement of muscle growth, and cardio is never included/);
  });

  it("switches between weeks and months", async () => {
    await open("/progress?tab=volume");
    await screen.findByTestId("vol-total");
    await userEvent.click(screen.getByRole("button", { name: "Months" }));
    const chart = screen.getByRole("group", { name: "Training volume by month" });
    expect(within(chart).getByRole("img", { name: "Nov 2026: 11,346 kg (partial month)" })).toBeTruthy();
  });

  it("converts everything to pounds, axis title included", async () => {
    await open("/progress?tab=volume", { weight_unit: "lbs" });
    await screen.findByTestId("vol-total");
    expect(screen.getByTestId("vol-total").textContent).toContain("27,217 lbs");
    const chart = screen.getByRole("group", { name: "Training volume by week" });
    expect(within(chart).getByText("lbs", { selector: "text" })).toBeTruthy();
    expect(within(chart).getByRole("img", { name: /Week of 02 Nov 2026: 15,434 lbs/ })).toBeTruthy();
    expect(panel().textContent).not.toMatch(/\bkg\b/);
  });

  it("with nothing counted it explains why instead of showing zeros", async () => {
    api.volume.mockResolvedValue({ ...VOLUME, total_volume_kg: 0, counted_sets: 0, excluded_sets: 9, weeks: [], months: [], by_exercise: [], by_muscle_group: [], unassigned_kg: 0 });
    await open("/progress?tab=volume");
    expect((await screen.findByTestId("progress-empty")).textContent).toMatch(/9 completed sets had no external weight or no reps/);
    expect(screen.queryByTestId("vol-total")).toBeNull();
  });

  it("shows only the top 10 exercises and says so", async () => {
    api.volume.mockResolvedValue({ ...VOLUME, by_exercise: Array.from({ length: 14 }, (_, i) => ({ name: `Exercise ${i}`, key: `id:${i}`, volume_kg: 1000 - i, completed_sets: 3 })) });
    await open("/progress?tab=volume");
    const list = await screen.findByRole("list", { name: "Volume by exercise" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(10);
    expect(screen.getByText("Showing the top 10 of 14 exercises.")).toBeTruthy();
  });
});

// ============================================================================================
describe("personal records", () => {
  const records = async (settings: Partial<Settings> = {}) => { await open("/progress?tab=records", settings); await screen.findByTestId("pr-summary"); };

  it("lists records per exercise with the date, a link to the workout, and what is new", async () => {
    await records();
    expect(screen.getByTestId("pr-summary").textContent).toMatch(/2 records first reached in this range/);
    const bench = within(screen.getByTestId("pr-id:2"));
    expect(bench.getByText("80 kg × 4")).toBeTruthy();
    expect(bench.getByText("750 kg")).toBeTruthy();
    expect(bench.getByText(/62.5 kg × 12 · 22 Oct 2026/)).toBeTruthy();
    expect(bench.getAllByText("New in range").length).toBe(2);
    expect(bench.getAllByRole("link", { name: "Open workout" })[0].getAttribute("href")).toBe("/workout/11");
    const reps = bench.getByText("Best reps at a weight").nextElementSibling!;
    expect(reps.textContent).toContain("80 kg × 4");
    expect(reps.textContent).toContain("62.5 kg × 12");
  });

  it("keeps bodyweight records separate: no weight record, a reps record", async () => {
    await records();
    const pull = within(screen.getByTestId("pr-id:4"));
    expect(pull.queryByText("Heaviest weight")).toBeNull();
    expect(pull.queryByText("Highest set volume")).toBeNull();
    expect(pull.getByText("12 reps")).toBeTruthy();
    expect(pull.queryByText("New in range")).toBeNull();                                               // an older record is not new
  });

  it("converts weights and volumes to the preferred unit", async () => {
    await records({ weight_unit: "lbs" });
    const bench = within(screen.getByTestId("pr-id:2"));
    expect(bench.getByText("176.4 lbs × 4")).toBeTruthy();
    expect(bench.getByText("1,653.5 lbs")).toBeTruthy();                                               // 750 kg
    expect(screen.getByTestId("pr-id:2").textContent).not.toMatch(/\bkg\b/);
  });

  it("filters by exercise name", async () => {
    await records();
    await userEvent.type(screen.getByLabelText("Filter records by exercise"), "pull");
    expect(screen.queryByTestId("pr-id:2")).toBeNull();
    expect(screen.getByTestId("pr-id:4")).toBeTruthy();
    await userEvent.clear(screen.getByLabelText("Filter records by exercise"));
    await userEvent.type(screen.getByLabelText("Filter records by exercise"), "zzz");
    expect(screen.getByText("No exercise matches “zzz”.")).toBeTruthy();
  });

  it("states the rules: completed sets only, earliest date wins ties, no bodyweight in weight records", async () => {
    await records();
    expect(screen.getByText(/the earliest date is the record/)).toBeTruthy();
    expect(screen.getByText(/Only completed sets in completed workouts count/)).toBeTruthy();
  });

  it("says when nothing is new in the range", async () => {
    api.records.mockResolvedValue({ ...RECORDS, new_in_range: 0 });
    await records();
    expect(screen.getByTestId("pr-summary").textContent).toMatch(/No new records in this range/);
  });

  it("no history means no records, and no invented ones", async () => {
    api.records.mockResolvedValue({ ...RECORDS, records: [], new_in_range: 0 });
    await open("/progress?tab=records");
    expect((await screen.findByTestId("progress-empty")).textContent).toMatch(/No personal records yet/);
  });
});

// ============================================================================================
describe("muscle groups", () => {
  it("shows completed sets, share, workouts and frequency, with Unassigned kept apart", async () => {
    await open("/progress?tab=muscles");
    const list = await screen.findByRole("list", { name: "Completed sets by muscle group" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((r) => r.querySelector("b")!.textContent)).toEqual(["Chest", "Back", "Unassigned"]);
    expect(within(rows[0]).getByText("20 · 50%")).toBeTruthy();
    expect(within(rows[0]).getByText("5 workouts · 2 exercises · 1.17/week")).toBeTruthy();
    expect(within(rows[1]).getByText("15 · 37.5%")).toBeTruthy();
    expect(rows[2].className).toContain("is-muted");
    expect(screen.getByText(/secondary muscles are not added/)).toBeTruthy();
    expect(screen.getByText(/Unassigned instead of being guessed/)).toBeTruthy();
  });

  it("empty range", async () => {
    api.muscleGroups.mockResolvedValue({ ...MUSCLES, total_sets: 0, groups: [] });
    await open("/progress?tab=muscles");
    expect((await screen.findByTestId("progress-empty")).textContent).toMatch(/No completed sets in this range/);
  });
});

// ============================================================================================
describe("cardio", () => {
  it("shows time, distance and entries from completed cardio only, and per-activity totals", async () => {
    await open("/progress?tab=cardio");
    await screen.findByTestId("cardio-minutes");
    expect(screen.getByTestId("cardio-minutes").textContent).toContain("2 h 15 min");
    expect(screen.getByTestId("cardio-distance").textContent).toContain("16.1 km");
    expect(screen.getByTestId("cardio-distance").textContent).toContain("4 entries with a distance");
    expect(screen.getByTestId("cardio-entries").textContent).toContain("5");
    const rows = within(screen.getByTestId("cardio-activities")).getAllByRole("row").slice(1).map((r) => Array.from(r.children).map((c) => c.textContent));
    expect(rows).toEqual([["Running", "3", "1 h 30 min", "16.1 km", "16 Nov 2026"], ["Walking", "2", "45 min", "—", "10 Nov 2026"]]);
  });

  it("shows calories only when you typed some, labelled as yours", async () => {
    await open("/progress?tab=cardio");
    await screen.findByTestId("cardio-minutes");
    expect(screen.queryByTestId("cardio-calories")).toBeNull();
    cleanup();
    api.cardio.mockResolvedValue(cardio({ calories_logged: 610, calories_entries: 2 }));
    await open("/progress?tab=cardio");
    expect((await screen.findByTestId("cardio-calories")).textContent).toContain("610");
    expect(screen.getByTestId("cardio-calories").textContent).toMatch(/where you typed them; never estimated/);
  });

  it("charts distance over time for one activity and lets you switch", async () => {
    await open("/progress?tab=cardio");
    const chart = await screen.findByRole("group", { name: "Running distance by date" });
    expect(within(chart).getByRole("img", { name: "22 Oct 2026: 5 km in 30 min" })).toBeTruthy();
    expect((screen.getByTestId("cardio-select") as HTMLSelectElement).value).toBe("Running");
    expect(Array.from((screen.getByTestId("cardio-select") as HTMLSelectElement).options).map((o) => o.value)).toEqual(["Running"]);   // Walking has no distances
    expect(last(api.cardio)[1]).toBe("Running");
  });

  it("converts distance to miles in the chart, table and totals", async () => {
    await open("/progress?tab=cardio", { distance_unit: "miles" });
    const chart = await screen.findByRole("group", { name: "Running distance by date" });
    expect(within(chart).getByRole("img", { name: "22 Oct 2026: 3.11 miles in 30 min" })).toBeTruthy();
    expect(screen.getByTestId("cardio-distance").textContent).toContain("10 miles");
    expect(panel().textContent).not.toMatch(/\bkm\b/);
    expect(within(chart).getByText("miles", { selector: "text" })).toBeTruthy();
  });

  it("explains that different activities are not compared", async () => {
    await open("/progress?tab=cardio");
    expect((await screen.findByText(/Different activities are not compared/)).textContent).toMatch(/not the same effort/);
  });

  it("fewer than two distance days: a note, no trend line", async () => {
    api.cardio.mockResolvedValue(cardio({ series: [{ date: "2026-11-16", distance_km: 5.6, minutes: 28 }] }));
    await open("/progress?tab=cardio");
    expect((await screen.findByTestId("cardio-few")).textContent).toMatch(/Only one day with a distance/);
    expect(screen.queryByRole("group", { name: /distance by date/ })).toBeNull();
  });

  it("no completed cardio: an honest empty state", async () => {
    api.cardio.mockResolvedValue(cardio({ entries: 0, sessions: 0, total_minutes: 0, total_distance_km: 0, entries_with_distance: 0, activities: [], activity: null, series: [] }));
    await open("/progress?tab=cardio");
    expect((await screen.findByTestId("progress-empty")).textContent).toMatch(/No completed cardio in this range/);
  });
});

// ============================================================================================
describe("workout history integration", () => {
  it("lists recent completed workouts in the range, each opening the existing workout page", async () => {
    await open();
    const box = await screen.findByTestId("recent-workouts");
    const row = await within(box).findByTestId("history-11");
    expect(row.textContent).toContain("Push day");
    expect(row.textContent).toContain("1 h 2 min · 4 of 5 exercises done · 14 sets · 15 min cardio");
    expect(row.getAttribute("href")).toBe("/workout/11");
    await userEvent.click(row);
    expect(where()).toBe("/workout/11");
  });

  it("links to the full history for the same dates", async () => {
    await open();
    expect((await screen.findByRole("link", { name: "View all history" })).getAttribute("href")).toBe("/progress?tab=history&from=2026-10-21&to=2026-11-19");
    cleanup();
    await open("/progress?range=all");
    expect((await screen.findByRole("link", { name: "View all history" })).getAttribute("href")).toBe("/progress?tab=history");
  });

  it("an empty range says so", async () => {
    vi.mocked(workoutService.list).mockResolvedValue({ items: [], total: 0, page: 1, page_size: 5 });
    await open();
    expect((await screen.findByText("No completed workouts in this range.")).textContent).toBeTruthy();
  });

  it("an error loading it can be retried", async () => {
    vi.mocked(workoutService.list).mockRejectedValueOnce(new ApiError({ kind: "server", status: 500, message: "Something went wrong on the server." }));
    await open();
    expect(await screen.findByText("Couldn't load workouts")).toBeTruthy();
    await userEvent.click(within(screen.getByTestId("recent-workouts")).getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("history-11")).toBeTruthy();
  });
});

// ============================================================================================
describe("tabs, settings and read-only behaviour", () => {
  it("has accessible tabs that move with the arrow keys and keep the choice in the URL", async () => {
    await open();
    expect(tab("Consistency").getAttribute("aria-selected")).toBe("true");
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Consistency", "Strength", "Volume", "Records", "Muscle groups", "Cardio", "History"]);
    await userEvent.click(tab("Records"));
    expect(where()).toContain("tab=records");
    expect(panel().getAttribute("aria-labelledby")).toBe("tab-records");
    fireEvent.keyDown(tab("Records"), { key: "ArrowRight" });
    await waitFor(() => expect(tab("Muscle groups").getAttribute("aria-selected")).toBe("true"));
    fireEvent.keyDown(tab("Muscle groups"), { key: "ArrowLeft" });
    await waitFor(() => expect(tab("Records").getAttribute("aria-selected")).toBe("true"));
    await userEvent.click(tab("Consistency"));
    expect(where()).not.toContain("tab=");
  });

  it("only the open tab loads its data", async () => {
    await open();
    await screen.findByRole("group", { name: "Completed workouts by week" });
    expect(api.volume).not.toHaveBeenCalled();
    expect(api.records).not.toHaveBeenCalled();
    expect(api.cardio).not.toHaveBeenCalled();
    expect(api.muscleGroups).not.toHaveBeenCalled();
  });

  it("changing the date range re-reads the open tab and dims it while loading, not blank", async () => {
    await open();
    await screen.findByRole("group", { name: "Completed workouts by week" });
    let finish!: (v: typeof CONSISTENCY) => void;
    api.consistency.mockReturnValueOnce(new Promise((r) => { finish = r; }));
    await userEvent.selectOptions(screen.getByTestId("range-select"), "7d");
    await waitFor(() => expect(panel().querySelector(".is-refreshing")).toBeTruthy());
    expect(screen.getByRole("group", { name: "Completed workouts by week" })).toBeTruthy();       // the previous chart stays visible
    finish({ ...CONSISTENCY, workouts: 1 });
    await waitFor(() => expect(panel().querySelector(".is-refreshing")).toBeNull());
  });

  it("uses the Settings date format everywhere and never writes anything", async () => {
    await open("/progress?tab=records", { date_format: "YYYY-MM-DD" });
    await screen.findByTestId("pr-summary");
    expect(screen.getByTestId("range-summary").textContent).toBe("2026-10-21 – 2026-11-19");
    expect(screen.getByTestId("pr-id:2").textContent).toContain("2026-11-16");
    const reads = [api.overview, api.records, vi.mocked(settingsService.get), vi.mocked(workoutService.list)];
    expect(reads.every((m) => m.mock.calls.length > 0)).toBe(true);
  });

  it("falls back to kilograms, kilometres and the default date format if Settings cannot load", async () => {
    vi.mocked(settingsService.get).mockRejectedValue(new ApiError({ kind: "network", message: "down" }));
    render(<MemoryRouter initialEntries={["/progress"]}><ProgressPage /></MemoryRouter>);
    await screen.findByTestId("overview");
    expect(screen.getByTestId("ov-volume").textContent).toContain("kg");
    expect(screen.getByTestId("range-summary").textContent).toBe("21 Oct 2026 – 19 Nov 2026");
  });
});

describe("mobile layout", () => {
  it("charts size to a phone-width container and keep every bar and point", async () => {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 340 });
    await open("/progress?tab=strength");
    const weight = await screen.findByRole("group", { name: "Barbell Bench Press heaviest completed weight by date" });
    expect(weight.getAttribute("viewBox")!.split(" ")[2]).toBe("340");
    expect(within(weight).getAllByRole("img")).toHaveLength(3);
    await userEvent.click(tab("Consistency"));
    const bars = await screen.findByRole("group", { name: "Completed workouts by week" });
    expect(bars.getAttribute("viewBox")!.split(" ")[2]).toBe("340");
    expect(within(bars).getAllByRole("img")).toHaveLength(5);
  });

  it("tables sit in a scroll container so they never widen the page", async () => {
    await open("/progress?tab=cardio");
    await screen.findByTestId("cardio-activities");
    expect(screen.getByTestId("cardio-activities").closest(".table-scroll")).toBeTruthy();
  });
});
