// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import WorkoutPage from "./WorkoutPage";
import { ToastProvider } from "../components/ui/Toast";
import { ApiError } from "../services/apiError";
import { catalogueService } from "../services/catalogueService";
import { dashboardService } from "../services/dashboardService";
import { exerciseMasterService } from "../services/exerciseMasterService";
import { exerciseService } from "../services/exerciseService";
import { exerciseSetService } from "../services/exerciseSetService";
import { resetCatalogueStore } from "../features/exercises/catalogueStore";
import { cycleService, plannerService } from "../services/plannerService";
import { settingsService } from "../services/settingsService";
import { workoutService } from "../services/workoutService";
import type { DayDetail } from "../types/planner";
import type { Settings } from "../types/settings";
import { makeExercise, makeList } from "../features/exercises/testData";
import { MON_PLAN, THURSDAY_PLAN, TUE_PLAN, WED_PLAN, makeDashboard } from "../features/home/testData";
import { makeDay, plannedExercise } from "../features/planner/testData";

vi.mock("../services/dashboardService", () => ({ dashboardService: { get: vi.fn() } }));
vi.mock("../services/settingsService", () => ({ settingsService: { get: vi.fn() } }));
vi.mock("../services/workoutService", () => ({ workoutService: { list: vi.fn(), start: vi.fn() } }));
vi.mock("../services/exerciseService", () => ({ exerciseService: { list: vi.fn() }, masterDataService: {} }));
vi.mock("../services/catalogueService", () => ({ catalogueService: { list: vi.fn(), add: vi.fn() } }));
vi.mock("../services/exerciseSetService", () => ({ exerciseSetService: { list: vi.fn() } }));
vi.mock("../services/exerciseMasterService", () => ({ exerciseMasterService: { list: vi.fn() } }));
vi.mock("../services/plannerService", () => ({
  plannerService: {
    getDay: vi.fn(), putDay: vi.fn(), clearDay: vi.fn(), addMuscleGroup: vi.fn(), addExercise: vi.fn(), removeExercise: vi.fn(),
    updateExercise: vi.fn(), reorderExercises: vi.fn(), copyDay: vi.fn(), removeCardio: vi.fn(), addCardio: vi.fn(),
  },
  cycleService: { create: vi.fn(), activate: vi.fn() },
}));
const dash = vi.mocked(dashboardService);
const workouts = vi.mocked(workoutService);
const planner = vi.mocked(plannerService);
const cycles = vi.mocked(cycleService);
const exercises = vi.mocked(exerciseService);
const catalogue = vi.mocked(catalogueService);
const pickMuscle = async (dialog: HTMLElement, name: string) => { await userEvent.click(await within(dialog).findByRole("button", { name })); };

const SETTINGS: Settings = {
  display_name: null, rest_between_sets_seconds: 90, rest_between_exercises_seconds: 120, target_workout_minutes: 60,
  weight_unit: "kg", distance_unit: "km", week_start: "monday", date_format: "DD MMM YYYY", updated_at: "2026-11-19T10:00:00Z",
};

/** What the server would return for each day of this week (Thursday = today). */
let DAYS: Record<number, DayDetail>;
const freshDays = () => ({ 0: structuredClone(MON_PLAN), 1: structuredClone(TUE_PLAN), 2: structuredClone(WED_PLAN), 3: structuredClone(THURSDAY_PLAN),
  4: makeDay({ day_of_week: 4, date: "2026-11-20" }), 5: makeDay({ day_of_week: 5, date: "2026-11-21" }), 6: makeDay({ day_of_week: 6, date: "2026-11-22" }) });

function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname + l.search}</div>; }
async function renderPage(dashboard = makeDashboard(), url = "/workout") {
  dash.get.mockResolvedValue(dashboard);
  render(<MemoryRouter initialEntries={[url]}><ToastProvider><WorkoutPage /></ToastProvider><Where /></MemoryRouter>);
  await screen.findByTestId("week-3");
  await screen.findByTestId("ex-11");
}
const panel = () => screen.getByTestId("day-panel");
const toastRegion = () => document.querySelector(".toast-region") as HTMLElement;

beforeEach(() => {
  window.scrollTo = vi.fn();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-19T06:00:00Z"));
  DAYS = freshDays();
  vi.mocked(settingsService.get).mockResolvedValue(SETTINGS);
  vi.mocked(exerciseMasterService.list).mockResolvedValue({ items: [], motions: {} });
  planner.getDay.mockImplementation(async (_c, _w, d) => structuredClone(DAYS[d]));
  planner.putDay.mockImplementation(async (_c, _w, d, input) => ({ ...DAYS[d], status: input.status } as DayDetail));
  planner.clearDay.mockResolvedValue(undefined as never);
  planner.addMuscleGroup.mockImplementation(async (_c, _w, d) => DAYS[d]);
  planner.addExercise.mockImplementation(async (_c, _w, d) => DAYS[d]);
  planner.removeExercise.mockImplementation(async () => DAYS[3]);
  planner.updateExercise.mockImplementation(async () => DAYS[3]);
  planner.reorderExercises.mockImplementation(async () => DAYS[3]);
  planner.copyDay.mockImplementation(async (_c, _w, _d, _tw, td) => DAYS[td]);
  exercises.list.mockResolvedValue(makeList([
    makeExercise({ id: 1, name: "Barbell Bench Press" }),
    makeExercise({ id: 7, name: "Hammer Curl", muscle_group: { id: 4, name: "Biceps" }, target_area: null, workout_type: { id: 2, name: "Dumbbell" } }),
  ]));
  catalogue.list.mockResolvedValue({
    items: [
      { key: "cable-row", name: "Seated Cable Row", muscle_group: "Back", target_area: "Middle Back", equipment: "Cable", icon_motion: "row", in_library: false, exercise_id: null },
      { key: "bench", name: "Barbell Bench Press", muscle_group: "Chest", target_area: null, equipment: "Barbell", icon_motion: "press", in_library: true, exercise_id: 1 },
      { key: "bench-111", name: "Barbell Bench Press (day)", muscle_group: "Chest", target_area: null, equipment: "Barbell", icon_motion: "press", in_library: true, exercise_id: 111 },
      { key: "hammer", name: "Hammer Curl", muscle_group: "Biceps", target_area: null, equipment: "Dumbbell", icon_motion: "curl", in_library: true, exercise_id: 7 },
    ],
    muscle_groups: ["Back", "Biceps", "Chest"], motions: {},
  });
  vi.mocked(exerciseSetService.list).mockResolvedValue([
    { id: 5, name: "Biceps A", muscle_group: "Biceps", created_at: "2026-11-23T00:00:00Z", exercises: [{ key: "hammer", name: "Hammer Curl", equipment: "Dumbbell", icon_motion: "curl" }] },
  ]);
});
afterEach(() => { resetCatalogueStore(); cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

describe("today and this week", () => {
  it("shows today's plan first, with its exercises and a Start button", async () => {
    await renderPage();
    expect(within(panel()).getByText("TODAY")).toBeTruthy();
    expect(within(panel()).getByRole("heading", { name: "Push day" })).toBeTruthy();
    expect(within(panel()).getByText("Barbell Bench Press")).toBeTruthy();
    expect(within(panel()).getByText(/4 × 6-8 · 80 kg/)).toBeTruthy();
    expect(within(panel()).getByText("Cable Fly")).toBeTruthy();
    expect(planner.getDay).toHaveBeenCalledWith(1, 1, 3, expect.anything());
  });

  it("has Share and Paste icons for workout plans, and they open their dialogs", async () => {
    await renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Share workout plan" }));
    expect(await screen.findByRole("dialog", { name: "Share workout plan" })).toBeTruthy();
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getByRole("button", { name: "Paste a plan code" }));
    expect(await screen.findByRole("dialog", { name: "Paste a plan code" })).toBeTruthy();
  });

  it("starts today's planned workout, and a blank one only on request", async () => {
    workouts.start.mockResolvedValue({ id: 41 } as never);
    await renderPage();
    await userEvent.click(screen.getByTestId("start-plan"));
    expect(workouts.start).toHaveBeenCalledWith({ source: "plan", cycle_id: 1, week_number: 1, day_of_week: 3 });
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/workout/41"));
  });

  it("starts only once however often it is tapped", async () => {
    let done!: (v: never) => void;
    workouts.start.mockReturnValue(new Promise((r) => { done = r as never; }));
    await renderPage();
    const b = screen.getByTestId("start-plan");
    fireEvent.click(b); fireEvent.click(b); fireEvent.click(screen.getByTestId("start-blank"));
    expect(workouts.start).toHaveBeenCalledTimes(1);
    await act(async () => done({ id: 1 } as never));
  });

  it("offers Resume instead of Start when a workout is unfinished", async () => {
    await renderPage(makeDashboard({ in_progress_session: { id: 9, status: "in_progress", workout_date: "2026-11-18", title: "Pull day" } }));
    expect(screen.getByTestId("resume-link").getAttribute("href")).toBe("/workout/9");
    expect(screen.queryByTestId("start-plan")).toBeNull();
  });

  it("opening the page starts nothing and changes nothing", async () => {
    await renderPage();
    expect(workouts.start).not.toHaveBeenCalled();
    for (const fn of [planner.putDay, planner.addExercise, planner.removeExercise, planner.copyDay, planner.clearDay]) expect(fn).not.toHaveBeenCalled();
  });

  it("shows the week Monday to Sunday with today marked, and switches day with one tap", async () => {
    await renderPage();
    const days = screen.getAllByTestId(/^week-\d$/);
    expect(days).toHaveLength(7);
    expect(screen.getByTestId("week-3").getAttribute("aria-current")).toBe("date");
    expect(screen.getByTestId("week-3").getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(screen.getByTestId("week-0"));
    await waitFor(() => expect(planner.getDay).toHaveBeenCalledWith(1, 1, 0, expect.anything()));
    expect(await within(panel()).findByText("MONDAY")).toBeTruthy();
    expect(screen.queryByTestId("start-plan")).toBeNull();     // only today can be started
  });

  it("a rest day says so and offers a workout instead", async () => {
    await renderPage();
    await userEvent.click(screen.getByTestId("week-1"));
    expect(await screen.findByTestId("day-rest")).toBeTruthy();
    expect(within(panel()).getByRole("button", { name: /Add a workout instead/ })).toBeTruthy();
  });

  it("an unplanned day offers add, copy and rest", async () => {
    await renderPage();
    await userEvent.click(screen.getByTestId("week-4"));
    const empty = await screen.findByTestId("day-empty");
    expect(within(empty).getByRole("button", { name: /Add exercise/ })).toBeTruthy();
    expect(within(empty).getByRole("button", { name: /Copy another day/ })).toBeTruthy();
    expect(within(empty).getByRole("button", { name: /Rest day/ })).toBeTruthy();
  });

  it("shows an error with retry when the plan cannot be read", async () => {
    dash.get.mockRejectedValueOnce(new ApiError({ kind: "network", message: "Can't reach the server." }));
    render(<MemoryRouter><ToastProvider><WorkoutPage /></ToastProvider></MemoryRouter>);
    expect(await screen.findByText("Couldn't load your workout plan")).toBeTruthy();
    dash.get.mockResolvedValue(makeDashboard());
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("ex-11")).toBeTruthy();
  });

  it("shows the full planner, cycles and calendar buttons in the header, not at the bottom", async () => {
    await renderPage();
    const nav = screen.getByRole("navigation", { name: "More planning tools" });
    expect(nav.closest(".plan-head")).toBeTruthy();                                       // inside the header row, above the week
    const hrefs = within(nav).getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/planner", "/cycles", "/calendar?view=week&date=2026-11-19"]);
    expect(within(panel()).getByRole("link", { name: /Full editor/ }).getAttribute("href")).toBe("/planner?cycle=1&week=1&day=3");
  });
});

describe("quick actions", () => {
  it("adds an exercise already in your library in one tap, with sensible defaults", async () => {
    await renderPage();
    await userEvent.click(within(panel()).getByRole("button", { name: /Add exercise/ }));
    const dialog = await screen.findByRole("dialog");
    await pickMuscle(dialog, "Biceps");
    await userEvent.click(await within(dialog).findByTestId("pick-cat-hammer"));
    await waitFor(() => expect(planner.addExercise).toHaveBeenCalledTimes(1));
    // Biceps is not in today's plan yet, so its section is created first
    expect(planner.addMuscleGroup).toHaveBeenCalledWith(1, 1, 3, 4);
    expect(planner.addExercise).toHaveBeenCalledWith(1, 1, 3, 4, { target_sets: 3, target_reps: "10", target_weight_kg: null, rest_seconds: null, notes: null, exercise_id: 7 });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(toastRegion().textContent).toContain("Added Hammer Curl to today.");
  });

  it("shows an uploaded picture on a day's exercise and opens its details when tapped", async () => {
    catalogue.list.mockResolvedValue({
      items: [{ key: "bench", name: "Barbell Bench Press", muscle_group: "Chest", target_area: null, equipment: "Barbell", icon_motion: "press",
        in_library: true, exercise_id: 1, media: [{ id: 7, kind: "image", content_type: "image/png", url: "/m/7" }] }],
      muscle_groups: ["Chest"], motions: {},
    });
    await renderPage();
    const row = screen.getByTestId("ex-11");                                           // Barbell Bench Press in Thursday's plan
    await waitFor(() => expect(row.querySelector('img[src="/m/7"]')).toBeTruthy());
    await userEvent.click(within(row).getByRole("button", { name: "Show Barbell Bench Press" }));
    const dialog = await screen.findByRole("dialog", { name: "Barbell Bench Press" });
    expect(dialog.querySelector('img[src="/m/7"]')).toBeTruthy();
  });

  it("asks for a muscle first, then adds a whole saved set in one tap", async () => {
    await renderPage();
    await userEvent.click(within(panel()).getByRole("button", { name: /Add exercise/ }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/Choose a muscle/)).toBeTruthy();           // nothing to pick until a muscle is chosen
    expect(within(dialog).queryByTestId("pick-set-5")).toBeNull();
    await pickMuscle(dialog, "Biceps");
    expect(within(dialog).getByText("Hammer Curl", { selector: "small", exact: false })).toBeTruthy();
    await userEvent.click(await within(dialog).findByTestId("pick-set-5"));
    await waitFor(() => expect(planner.addExercise).toHaveBeenCalledWith(1, 1, 3, 4, expect.objectContaining({ exercise_id: 7 })));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(toastRegion().textContent).toContain("Added Biceps A (1 exercise) to today.");
  });

  it("only shows the sets of the chosen muscle", async () => {
    await renderPage();
    await userEvent.click(within(panel()).getByRole("button", { name: /Add exercise/ }));
    const dialog = await screen.findByRole("dialog");
    await pickMuscle(dialog, "Back");
    expect(within(dialog).queryByTestId("pick-set-5")).toBeNull();
    expect(within(dialog).getByText(/No saved back sets yet/)).toBeTruthy();
  });

  it("hides exercises that are already in the day", async () => {
    exercises.list.mockResolvedValue(makeList([
      makeExercise({ id: 111, name: "Barbell Bench Press" }),          // already in Thursday's plan (planned exercise id 111)
      makeExercise({ id: 7, name: "Hammer Curl", muscle_group: { id: 4, name: "Biceps" } }),
    ]));
    await renderPage();
    await userEvent.click(within(panel()).getByRole("button", { name: /Add exercise/ }));
    const dialog = await screen.findByRole("dialog");
    await pickMuscle(dialog, "Chest");
    await within(dialog).findByTestId("pick-cat-bench");
    expect(within(dialog).queryByTestId("pick-cat-bench-111")).toBeNull();
  });

  it("adds a catalogue exercise to your library and to the day in one step", async () => {
    catalogue.add.mockResolvedValue(makeExercise({ id: 55, name: "Seated Cable Row", muscle_group: { id: 2, name: "Back" } }));
    await renderPage();
    await userEvent.click(within(panel()).getByRole("button", { name: /Add exercise/ }));
    const dialog = await screen.findByRole("dialog");
    await pickMuscle(dialog, "Back");
    await userEvent.click(await within(dialog).findByTestId("pick-cat-cable-row"));
    await waitFor(() => expect(catalogue.add).toHaveBeenCalledWith("cable-row"));
    await waitFor(() => expect(planner.addExercise).toHaveBeenCalledWith(1, 1, 3, 2, expect.objectContaining({ exercise_id: 55 })));
  });

  it("shows a failure inside the dialog and keeps it open", async () => {
    planner.addExercise.mockRejectedValue(new ApiError({ kind: "client", status: 409, message: "This exercise is already in this muscle group for the day." }));
    await renderPage();
    await userEvent.click(within(panel()).getByRole("button", { name: /Add exercise/ }));
    const dialog = await screen.findByRole("dialog");
    await pickMuscle(dialog, "Biceps");
    await userEvent.click(await within(dialog).findByTestId("pick-cat-hammer"));
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(/already in this muscle group/);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("removes an exercise with one tap and can undo it", async () => {
    await renderPage();
    await userEvent.click(within(screen.getByTestId("ex-12")).getByRole("button", { name: "Remove Cable Fly" }));
    await waitFor(() => expect(planner.removeExercise).toHaveBeenCalledWith(12));
    const undo = await within(toastRegion()).findByRole("button", { name: "Undo" });
    expect(toastRegion().textContent).toContain("Removed Cable Fly.");
    await userEvent.click(undo);
    // the day is put back exactly as it was: cleared, re-planned, section and both exercises (in order) re-added
    await waitFor(() => expect(planner.addExercise).toHaveBeenCalledTimes(2));
    expect(planner.clearDay).toHaveBeenCalledWith(1, 1, 3);
    expect(planner.putDay).toHaveBeenCalledWith(1, 1, 3, expect.objectContaining({ status: "planned", title: "Push day" }));
    expect(planner.addExercise.mock.calls.map((c) => c[4].exercise_id)).toEqual([111, 112]);
    expect(planner.addExercise.mock.calls[0][4]).toMatchObject({ target_sets: 4, target_reps: "6-8", target_weight_kg: 80, rest_seconds: 120 });
    expect(await within(toastRegion()).findByText("Undone.")).toBeTruthy();
  });

  it("replaces an exercise keeping its sets, reps and weight", async () => {
    await renderPage();
    await userEvent.click(within(screen.getByTestId("ex-11")).getByRole("button", { name: "Replace Barbell Bench Press" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Replace Barbell Bench Press" })).toBeTruthy();
    await userEvent.click(await within(dialog).findByTestId("pick-cat-bench"));
    await waitFor(() => expect(planner.removeExercise).toHaveBeenCalledWith(11));
    expect(planner.addExercise).toHaveBeenCalledWith(1, 1, 3, 1, expect.objectContaining({ exercise_id: 1, target_sets: 4, target_reps: "6-8", target_weight_kg: 80, rest_seconds: 120 }));
    // added before removed, so a failed add never loses the old exercise
    expect(planner.addExercise.mock.invocationCallOrder[0]).toBeLessThan(planner.removeExercise.mock.invocationCallOrder[0]);
  });

  it("reorders with the up and down buttons", async () => {
    await renderPage();
    expect((within(screen.getByTestId("ex-11")).getByRole("button", { name: "Move Barbell Bench Press up" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(within(screen.getByTestId("ex-11")).getByRole("button", { name: "Move Barbell Bench Press down" }));
    await waitFor(() => expect(planner.reorderExercises).toHaveBeenCalledWith(1, 1, 3, 1, [12, 11]));
  });

  it("edits sets, reps and weight inline and validates them", async () => {
    await renderPage();
    await userEvent.click(within(screen.getByTestId("ex-12")).getByRole("button", { name: "Edit sets and reps of Cable Fly" }));
    const form = screen.getByRole("form", { name: "Edit Cable Fly" });
    const [sets, reps, weight] = within(form).getAllByRole("textbox") as HTMLInputElement[];
    await userEvent.clear(reps); await userEvent.type(reps, "abc");
    await userEvent.click(within(form).getByRole("button", { name: /Save/ }));
    expect(within(form).getByRole("alert").textContent).toMatch(/Reps/);
    expect(planner.updateExercise).not.toHaveBeenCalled();
    await userEvent.clear(sets); await userEvent.type(sets, "4");
    await userEvent.clear(reps); await userEvent.type(reps, "8-12");
    await userEvent.type(weight, "22.5");
    await userEvent.click(within(form).getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(planner.updateExercise).toHaveBeenCalledWith(12, expect.objectContaining({ exercise_id: 112, target_sets: 4, target_reps: "8-12", target_weight_kg: 22.5 })));
  });

  it("marks a day as a rest day (confirming nothing is lost, with Undo) and clears a day", async () => {
    await renderPage();
    await userEvent.click(within(panel()).getByRole("button", { name: "Day actions" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Mark as rest day" }));
    await waitFor(() => expect(planner.putDay).toHaveBeenCalledWith(1, 1, 3, { status: "rest", title: null, notes: null, clear_workout: true }));
    expect(await within(toastRegion()).findByRole("button", { name: "Undo" })).toBeTruthy();
    await userEvent.click(within(panel()).getByRole("button", { name: "Day actions" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Clear the day" }));
    await waitFor(() => expect(planner.clearDay).toHaveBeenCalledWith(1, 1, 3));
  });

  it("copies a day to an empty day in two taps", async () => {
    await renderPage();
    await userEvent.click(within(panel()).getByRole("button", { name: "Day actions" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Copy to another day" }));
    const dialog = await screen.findByRole("dialog", { name: "Copy Thursday to…" });
    expect(within(dialog).getByTestId("day-4").textContent).toContain("Nothing planned");
    await userEvent.click(within(dialog).getByTestId("day-4"));
    await waitFor(() => expect(planner.copyDay).toHaveBeenCalledWith(1, 1, 3, 1, 4, false));
    expect(toastRegion().textContent).toContain("Copied Thursday to Friday.");
  });

  it("asks before copying over an existing plan, then replaces it", async () => {
    await renderPage();
    await userEvent.click(within(panel()).getByRole("button", { name: "Day actions" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Copy to another day" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByTestId("day-0"));        // Monday already has a plan
    expect(planner.copyDay).not.toHaveBeenCalled();
    expect(within(dialog).getByTestId("day-0").textContent).toMatch(/Replaces what is on Monday. Tap again to confirm/);
    await userEvent.click(within(dialog).getByTestId("day-0"));
    await waitFor(() => expect(planner.copyDay).toHaveBeenCalledWith(1, 1, 3, 1, 0, true));
  });

  it("can copy to the same day next week", async () => {
    await renderPage();
    await userEvent.click(within(panel()).getByRole("button", { name: "Day actions" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Copy to another day" }));
    await userEvent.click(await screen.findByTestId("next-week"));
    await waitFor(() => expect(planner.copyDay).toHaveBeenCalledWith(1, 1, 3, 2, 3, false));
  });

  it("moves a workout to another day: copy, then empty the original", async () => {
    await renderPage();
    await userEvent.click(within(panel()).getByRole("button", { name: "Day actions" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Move to another day" }));
    await userEvent.click(await screen.findByTestId("day-5"));
    await waitFor(() => expect(planner.clearDay).toHaveBeenCalledWith(1, 1, 3));
    expect(planner.copyDay).toHaveBeenCalledWith(1, 1, 3, 1, 5, false);
    expect(planner.copyDay.mock.invocationCallOrder[0]).toBeLessThan(planner.clearDay.mock.invocationCallOrder[0]);
    expect(toastRegion().textContent).toContain("Moved Thursday to Saturday.");
    await waitFor(() => expect(screen.getByTestId("week-5").getAttribute("aria-pressed")).toBe("true"));
  });

  it("fills an empty day from another day", async () => {
    await renderPage();
    await userEvent.click(screen.getByTestId("week-4"));
    await userEvent.click(await within(await screen.findByTestId("day-empty")).findByRole("button", { name: /Copy another day/ }));
    const dialog = await screen.findByRole("dialog", { name: "Fill Friday from…" });
    await userEvent.click(within(dialog).getByTestId("day-0"));
    await waitFor(() => expect(planner.copyDay).toHaveBeenCalledWith(1, 1, 0, 1, 4, false));
  });

  it("opens the add dialog straight from Home's shortcut (?add=1)", async () => {
    await renderPage(makeDashboard(), "/workout?add=1");
    expect(await screen.findByRole("dialog", { name: "Add exercise to today" })).toBeTruthy();
    expect(screen.getByTestId("where").textContent).toBe("/workout");
  });

  it("a failed action shows an error and changes nothing on screen", async () => {
    planner.removeExercise.mockRejectedValue(new ApiError({ kind: "server", status: 500, message: "Something went wrong on the server." }));
    await renderPage();
    await userEvent.click(within(screen.getByTestId("ex-12")).getByRole("button", { name: "Remove Cable Fly" }));
    await waitFor(() => expect(toastRegion().textContent).toContain("Something went wrong"));
    expect(screen.getByTestId("ex-12")).toBeTruthy();
    expect(within(toastRegion()).queryByRole("button", { name: "Undo" })).toBeNull();
  });
});

describe("no plan for the week", () => {
  const noCycle = () => {
    const d = makeDashboard();
    return makeDashboard({
      active_cycle: null, today: { ...d.today, cycle: null, week_number: null, plan: null },
      week: { ...d.week, days: d.week.days.map((x) => ({ ...x, cycle: null, week_number: null, plan: null })) },
    });
  };
  async function renderEmpty(dashboard = noCycle()) {
    dash.get.mockResolvedValue(dashboard);
    render(<MemoryRouter><ToastProvider><WorkoutPage /></ToastProvider></MemoryRouter>);
    await screen.findByTestId("no-plan");
  }

  it("still shows Share and Paste to a user with no plan: Share is off, Paste leads to starting a plan", async () => {
    await renderEmpty();
    expect((screen.getByRole("button", { name: "Share workout plan" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Paste a plan code" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Start a plan first" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Start a plan" }));
    expect(await screen.findByRole("dialog", { name: "Start a plan" })).toBeTruthy();
  });

  it("starts a plan in one step: this Monday, 4 weeks, switched on", async () => {
    cycles.create.mockResolvedValue({ id: 9 } as never);
    cycles.activate.mockResolvedValue({ id: 9 } as never);
    await renderEmpty();
    expect(screen.getByTestId("start-blank")).toBeTruthy();        // a blank workout is still possible
    await userEvent.click(screen.getByRole("button", { name: "Start a plan" }));
    const dialog = await screen.findByRole("dialog", { name: "Start a plan" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Create plan" }));
    await waitFor(() => expect(cycles.activate).toHaveBeenCalledWith(9));
    expect(cycles.create).toHaveBeenCalledWith({ name: "My plan", description: null, start_date: "2026-11-16", total_weeks: 4 });
  });

  it("shows a server error in the dialog", async () => {
    cycles.create.mockRejectedValue(new ApiError({ kind: "client", status: 409, message: "Another cycle already covers these dates." }));
    await renderEmpty();
    await userEvent.click(screen.getByRole("button", { name: "Start a plan" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create plan" }));
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(/already covers/);
  });

  it("offers to activate a plan that covers today but is switched off", async () => {
    const d = noCycle();
    cycles.activate.mockResolvedValue({ id: 3 } as never);
    await renderEmpty({ ...d, today: { ...d.today, covered_by_inactive: { id: 3, name: "Spring", status: "draft", start_date: "2026-11-16", end_date: "2026-12-13", total_weeks: 4 } } });
    expect(screen.getByText(/“Spring” covers this day but isn't active/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Activate plan" }));
    await waitFor(() => expect(cycles.activate).toHaveBeenCalledWith(3));
  });
});

it("test data sanity: the fixtures use the ids these tests rely on", () => {
  expect(plannedExercise(11, 1, "x").exercise.id).toBe(111);
});
