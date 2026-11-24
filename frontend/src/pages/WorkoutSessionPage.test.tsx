// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import WorkoutSessionPage from "./WorkoutSessionPage";
import { ToastProvider } from "../components/ui/Toast";
import { ApiError } from "../services/apiError";
import { exerciseService, masterDataService } from "../services/exerciseService";
import { planningMasterData } from "../services/plannerService";
import { settingsService } from "../services/settingsService";
import { workoutService } from "../services/workoutService";
import type { Settings } from "../types/settings";
import type { WorkoutSession } from "../types/workout";
import { installFakeServer, makeCardio, makeExercise, makeSession, makeSet } from "../features/workout/testData";

vi.mock("../services/workoutService", () => ({
  workoutService: {
    get: vi.fn(), start: vi.fn(), list: vi.fn(), current: vi.fn(), complete: vi.fn(), cancel: vi.fn(), addExercise: vi.fn(), updateExercise: vi.fn(),
    removeExercise: vi.fn(), reorderExercises: vi.fn(), addSet: vi.fn(), updateSet: vi.fn(), removeSet: vi.fn(), addCardio: vi.fn(), updateCardio: vi.fn(), removeCardio: vi.fn(),
  },
}));
vi.mock("../services/settingsService", () => ({ settingsService: { get: vi.fn() } }));
vi.mock("../services/exerciseService", () => ({ exerciseService: { list: vi.fn() }, masterDataService: { muscleGroups: vi.fn() } }));
vi.mock("../services/plannerService", () => ({ planningMasterData: { cardioActivities: vi.fn() }, plannerService: {}, cycleService: {} }));

const svc = vi.mocked(workoutService) as unknown as Parameters<typeof installFakeServer>[0] & typeof workoutService;
const mocked = vi.mocked(workoutService);
const SETTINGS: Settings = {
  display_name: null, rest_between_sets_seconds: 75, rest_between_exercises_seconds: 120, target_workout_minutes: 60,
  weight_unit: "kg", distance_unit: "km", week_start: "monday", date_format: "DD MMM YYYY", updated_at: "2026-11-19T10:00:00Z",
};
let server: ReturnType<typeof installFakeServer>;
const SLOW = { timeout: 4000 };

function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname}</div>; }

async function open(session: WorkoutSession = makeSession(), settings: Partial<Settings> = {}) {
  server = installFakeServer(svc, session);
  vi.mocked(settingsService.get).mockResolvedValue({ ...SETTINGS, ...settings });
  const view = render(
    <MemoryRouter initialEntries={[`/workout/${session.id}`]}>
      <ToastProvider>
        <Routes>
          <Route path="/workout/:id" element={<WorkoutSessionPage />} />
          <Route path="/workout" element={<div>Workout list</div>} />
        </Routes>
      </ToastProvider>
      <Where />
    </MemoryRouter>);
  await screen.findByRole("article", { name: "Barbell Bench Press" });
  await waitFor(() => expect(vi.mocked(settingsService.get)).toHaveBeenCalled());
  return view;
}
const card = (name: string) => screen.getByRole("article", { name });
const setRow = (id: number) => screen.getByTestId(`set-${id}`);
const field = (row: HTMLElement, label: string | RegExp) => within(row).getByLabelText(label) as HTMLInputElement;
const status = () => screen.getByTestId("save-status").textContent;
const sum = (k: string) => screen.getByTestId(`sum-${k}`).textContent;
const waitSaved = () => waitFor(() => expect(status()).toBe("All changes saved"), SLOW);

beforeEach(() => {
  window.scrollTo = vi.fn();
  vi.useFakeTimers({ toFake: ["Date"] });                    // only the clock: real timers keep the debounce honest
  vi.setSystemTime(new Date("2026-11-19T05:10:00Z"));
  vi.mocked(exerciseService.list).mockResolvedValue({ items: [
    { id: 41, name: "Lat Pulldown", muscle_group: { id: 2, name: "Back" }, workout_type: { id: 4, name: "Cable" } },
    { id: 42, name: "Plank", muscle_group: { id: 3, name: "Abs / Core" }, workout_type: null },
  ], total: 2, page: 1, page_size: 30 } as never);
  vi.mocked(masterDataService.muscleGroups).mockResolvedValue([{ id: 2, name: "Back", sort_order: 1, target_areas: [] }] as never);
  vi.mocked(planningMasterData.cardioActivities).mockResolvedValue([{ id: 1, name: "Walking" }, { id: 2, name: "Running" }]);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

// ============================================================================================
describe("opening and resuming", () => {
  it("shows a loading state, then the header: date in your format, status, start time and elapsed time", async () => {
    server = installFakeServer(svc, makeSession());
    vi.mocked(settingsService.get).mockResolvedValue({ ...SETTINGS, date_format: "DD/MM/YYYY" });
    render(<MemoryRouter initialEntries={["/workout/7"]}><ToastProvider><Routes><Route path="/workout/:id" element={<WorkoutSessionPage />} /></Routes></ToastProvider></MemoryRouter>);
    expect(screen.getByRole("status", { name: "Loading workout" })).toBeTruthy();
    await screen.findByRole("heading", { level: 1, name: "Push day" });
    await waitFor(() => expect(screen.getByTestId("session-date").textContent).toBe("Thu, 19/11/2026"));
    expect(screen.getByTestId("session-status").textContent).toBe("In progress");
    expect(screen.getByTestId("session-started").textContent).toBe("10:30 am");               // 05:00 UTC = 10:30 in India
    expect(screen.getByTestId("session-elapsed").textContent).toBe("10:00");                  // the server's 600 s
    expect(screen.getByText("Winter Block · Week 1")).toBeTruthy();
  });

  it("restores exactly what the server holds after a refresh", async () => {
    const s = makeSession();
    s.exercises[0].sets[0] = makeSet({ id: 11, set_number: 1, status: "completed", actual_reps: 8, actual_weight_kg: 82.5 });
    s.exercises[0].notes = "Left shoulder tight";
    await open(s);
    expect(field(setRow(11), "Set 1 reps").value).toBe("8");
    expect(field(setRow(11), /Set 1 weight/).value).toBe("82.5");
    expect(within(setRow(11)).getByRole("button", { name: "Undo done for set 1" })).toBeTruthy();
    expect((within(card("Barbell Bench Press")).getByLabelText("Exercise notes") as HTMLTextAreaElement).value).toBe("Left shoulder tight");
    expect(sum("sets")).toBe("1");
  });

  it("derives elapsed time from stored timestamps, so a sleeping tab catches up at once", async () => {
    await open();
    expect(screen.getByTestId("session-elapsed").textContent).toBe("10:00");
    act(() => { vi.setSystemTime(new Date("2026-11-19T05:12:05Z")); });                       // 2 min 5 s pass without any timer running
    await waitFor(() => expect(screen.getByTestId("session-elapsed").textContent).toBe("12:05"), { timeout: 2500 });
  });

  it("shows a clear error with a working retry when the workout cannot be loaded", async () => {
    server = installFakeServer(svc, makeSession());
    mocked.get.mockRejectedValueOnce(new ApiError({ kind: "network", message: "Can't reach the server." }));
    vi.mocked(settingsService.get).mockResolvedValue(SETTINGS);
    render(<MemoryRouter initialEntries={["/workout/7"]}><ToastProvider><Routes><Route path="/workout/:id" element={<WorkoutSessionPage />} /></Routes></ToastProvider></MemoryRouter>);
    expect(await screen.findByText("Couldn't open this workout")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("article", { name: "Barbell Bench Press" })).toBeTruthy();
  });

  it("reports a missing workout", async () => {
    server = installFakeServer(svc, makeSession());
    mocked.get.mockRejectedValue(new ApiError({ kind: "client", status: 404, code: "workout_session_not_found", message: "Workout session not found." }));
    vi.mocked(settingsService.get).mockResolvedValue(SETTINGS);
    render(<MemoryRouter initialEntries={["/workout/99"]}><ToastProvider><Routes><Route path="/workout/:id" element={<WorkoutSessionPage />} /></Routes></ToastProvider></MemoryRouter>);
    expect(await screen.findByText("Workout session not found.")).toBeTruthy();
  });

  it("rejects a malformed link", () => {
    render(<MemoryRouter initialEntries={["/workout/abc"]}><ToastProvider><Routes><Route path="/workout/:id" element={<WorkoutSessionPage />} /></Routes></ToastProvider></MemoryRouter>);
    expect(screen.getByText("That isn't a valid workout link.")).toBeTruthy();
    expect(mocked.get).not.toHaveBeenCalled();
  });
});

// ============================================================================================
describe("planned targets stay separate from actual values", () => {
  it("shows the plan as text and leaves the actual inputs empty", async () => {
    await open();
    const bench = card("Barbell Bench Press");
    expect(within(bench).getByText("Planned: 3 × 6-8 @ 80 kg")).toBeTruthy();
    expect(within(bench).getByText("Chest · Barbell")).toBeTruthy();
    const row = setRow(11);
    expect(within(row).getByText("Target 6-8 reps × 80 kg")).toBeTruthy();
    expect(field(row, "Set 1 reps").value).toBe("");
    expect(field(row, /Set 1 weight/).value).toBe("");
    expect(field(row, /Set 1 weight/).placeholder).toBe("80");
    expect(field(row, /Set 1 rest/).placeholder).toBe("120");                                  // the exercise's planned rest
    expect(field(setRow(21), /Set 1 rest/).placeholder).toBe("75");                            // else the default from Settings
    expect(within(card("Cable Fly")).getByText("Planned: 2 × 12")).toBeTruthy();
    expect(within(setRow(21)).getByText("Target 12 reps")).toBeTruthy();
  });

  it("summary counts only logged work, never the plan", async () => {
    await open();
    expect(["exercises", "done", "skipped", "sets", "cardio"].map(sum)).toEqual(["2", "0", "0", "0", "0"]);
    expect(screen.getByText("Sets done of 5")).toBeTruthy();
    expect(within(screen.getByTestId("cardio-1")).getByText("Planned: 30 min · 5 km")).toBeTruthy();
  });

  it("editing actuals never sends anything about targets", async () => {
    await open();
    await userEvent.type(field(setRow(11), "Set 1 reps"), "9");
    await userEvent.type(field(setRow(11), /Set 1 weight/), "82.5");
    await userEvent.tab();
    await waitFor(() => expect(mocked.updateSet).toHaveBeenCalled(), SLOW);
    for (const [, , patch] of mocked.updateSet.mock.calls) {
      expect(Object.keys(patch as object).every((k) => ["actual_reps", "actual_weight_kg", "rest_seconds", "status", "notes"].includes(k))).toBe(true);
    }
    await waitSaved();
    expect(server.session.exercises[0].sets[0]).toMatchObject({ target_reps: "6-8", target_weight_kg: 80, actual_reps: 9, actual_weight_kg: 82.5 });
  });
});

// ============================================================================================
describe("recording sets", () => {
  it("saves typed reps once, after a pause, not on every keystroke", async () => {
    await open();
    await userEvent.type(field(setRow(11), "Set 1 reps"), "12");
    expect(mocked.updateSet).not.toHaveBeenCalled();
    expect(status()).toBe("Saving…");
    await waitFor(() => expect(mocked.updateSet).toHaveBeenCalledTimes(1), SLOW);
    expect(mocked.updateSet).toHaveBeenCalledWith(7, 11, { actual_reps: 12 });
    await waitSaved();
    expect(mocked.updateSet).toHaveBeenCalledTimes(1);
  });

  it("saves immediately when you leave the field", async () => {
    await open();
    await userEvent.type(field(setRow(11), "Set 1 reps"), "10");
    await userEvent.tab();
    await waitFor(() => expect(mocked.updateSet).toHaveBeenCalledTimes(1), { timeout: 300 });
    expect(mocked.updateSet).toHaveBeenCalledWith(7, 11, { actual_reps: 10 });
  });

  it("records different reps and weights on each set, including decimals", async () => {
    await open();
    const plan = [[11, "12", "20"], [12, "10", "22.5"], [13, "8", "22.5"]] as const;
    for (const [id, reps, kg] of plan) {
      await userEvent.type(field(setRow(id), /reps/), reps);
      await userEvent.type(field(setRow(id), /weight/), kg);
      await userEvent.tab();
    }
    await waitSaved();
    expect(server.session.exercises[0].sets.map((s) => [s.actual_reps, s.actual_weight_kg])).toEqual([[12, 20], [10, 22.5], [8, 22.5]]);
    expect(server.session.exercises[0].sets.every((s) => s.target_weight_kg === 80)).toBe(true);
    expect(field(setRow(12), /weight/).value).toBe("22.5");
  });

  it("accepts a comma as the decimal separator", async () => {
    await open();
    await userEvent.type(field(setRow(11), /weight/), "7,5");
    await userEvent.tab();
    await waitFor(() => expect(mocked.updateSet).toHaveBeenCalledWith(7, 11, { actual_weight_kg: 7.5 }), SLOW);
  });

  it("clearing a value saves null (a bodyweight set has no weight)", async () => {
    const s = makeSession();
    s.exercises[0].sets[0] = makeSet({ id: 11, set_number: 1, actual_reps: 8, actual_weight_kg: 20 });
    await open(s);
    await userEvent.clear(field(setRow(11), /weight/));
    await userEvent.tab();
    await waitFor(() => expect(mocked.updateSet).toHaveBeenCalledWith(7, 11, { actual_weight_kg: null }), SLOW);
  });

  it("rests, notes and per-set notes are saved too", async () => {
    await open();
    await userEvent.type(field(setRow(11), /rest/), "90");
    await userEvent.click(within(setRow(11)).getByRole("button", { name: "Note for set 1" }));
    await userEvent.type(within(setRow(11)).getByLabelText("Set 1 note"), "felt easy");
    await waitFor(() => expect(mocked.updateSet).toHaveBeenCalledWith(7, 11, { rest_seconds: 90 }), SLOW);
    await waitFor(() => expect(mocked.updateSet).toHaveBeenCalledWith(7, 11, { notes: "felt easy" }), SLOW);
  });

  it("marks a set done and undoes it, updating the summary at once", async () => {
    await open();
    await userEvent.click(within(setRow(11)).getByRole("button", { name: "Mark set 1 done" }));
    expect(sum("sets")).toBe("1");
    expect(within(setRow(11)).getByText("Done", { selector: ".log-chip" })).toBeTruthy();
    await waitFor(() => expect(mocked.updateSet).toHaveBeenCalledWith(7, 11, { status: "completed" }));
    await userEvent.click(within(setRow(11)).getByRole("button", { name: "Undo done for set 1" }));
    expect(sum("sets")).toBe("0");
    await waitFor(() => expect(mocked.updateSet).toHaveBeenLastCalledWith(7, 11, { status: "pending" }));
  });

  it("skips a set", async () => {
    await open();
    await userEvent.click(within(setRow(12)).getByRole("button", { name: "Skip set 2" }));
    await waitFor(() => expect(mocked.updateSet).toHaveBeenCalledWith(7, 12, { status: "skipped" }));
    await waitFor(() => expect(within(setRow(12)).getByRole("button", { name: "Unskip set 2" }).getAttribute("aria-pressed")).toBe("true"));
    expect(sum("sets")).toBe("0");                                                               // skipped is not completed
  });

  it("adds a set (exercises may have different counts) and renders the server's numbering", async () => {
    await open();
    await userEvent.click(within(card("Cable Fly")).getByRole("button", { name: "Add set" }));
    await waitFor(() => expect(within(card("Cable Fly")).getAllByRole("listitem")).toHaveLength(3));
    expect(within(card("Cable Fly")).getByText("Set 3")).toBeTruthy();
    expect(within(card("Barbell Bench Press")).getAllByRole("listitem")).toHaveLength(3);
    expect(sum("sets")).toBe("0");
    expect(screen.getByText("Sets done of 6")).toBeTruthy();
  });

  it("removes an empty set without asking, and renumbers", async () => {
    await open();
    await userEvent.click(within(setRow(12)).getByRole("button", { name: "Remove set 2" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => expect(within(card("Barbell Bench Press")).getAllByRole("listitem")).toHaveLength(2));
    expect(within(card("Barbell Bench Press")).queryByText("Set 3")).toBeNull();
  });

  it("asks before removing a set that has data, and keeps it if you decline", async () => {
    const s = makeSession();
    s.exercises[0].sets[1] = makeSet({ id: 12, set_number: 2, actual_reps: 10, actual_weight_kg: 22.5, status: "completed" });
    await open(s);
    await userEvent.click(within(setRow(12)).getByRole("button", { name: "Remove set 2" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/reps, weight and status you entered/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(mocked.removeSet).not.toHaveBeenCalled();
    await userEvent.click(within(setRow(12)).getByRole("button", { name: "Remove set 2" }));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(mocked.removeSet).toHaveBeenCalledWith(7, 12));
  });
});

// ============================================================================================
describe("validation of typed values", () => {
  it.each([
    ["Set 1 reps", "abc", /whole number/],
    ["Set 1 reps", "9.5", /whole number/],
    ["Set 1 reps", "-3", /whole number/],
    ["Set 1 reps", "1001", /1000 or less/],
    [/Set 1 weight/, "abc", /Enter a number/],
    [/Set 1 weight/, "22.5555", /at most 3 decimals/],
    [/Set 1 weight/, "-5", /Enter a number/],
    [/Set 1 weight/, "1001", /1000 kg or less/],
    [/Set 1 rest/, "7201", /7200 or less/],
  ])("%s = %j shows an error and sends nothing", async (label, value, message) => {
    await open();
    const input = field(setRow(11), label);
    await userEvent.type(input, value);
    expect(await within(setRow(11)).findByRole("alert")).toBeTruthy();
    expect(within(setRow(11)).getByRole("alert").textContent).toMatch(message);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    await userEvent.tab();
    await new Promise((r) => setTimeout(r, 800));
    expect(mocked.updateSet).not.toHaveBeenCalled();
    expect(server.session.exercises[0].sets[0].actual_reps).toBeNull();
  });
});

// ============================================================================================
describe("exercises", () => {
  it("completes and skips an exercise; the summary follows", async () => {
    await open();
    await userEvent.click(within(card("Barbell Bench Press")).getByRole("button", { name: "Complete exercise" }));
    await userEvent.click(within(card("Cable Fly")).getByRole("button", { name: "Skip exercise" }));
    expect(["done", "skipped"].map(sum)).toEqual(["1", "1"]);
    await waitFor(() => expect(mocked.updateExercise).toHaveBeenCalledWith(7, 1, { status: "completed" }));
    expect(mocked.updateExercise).toHaveBeenCalledWith(7, 2, { status: "skipped" });
    await userEvent.click(within(card("Cable Fly")).getByRole("button", { name: "Unskip exercise" }));
    expect(sum("skipped")).toBe("0");
  });

  it("saves exercise notes", async () => {
    await open();
    await userEvent.click(within(card("Barbell Bench Press")).getByRole("button", { name: "Note for Barbell Bench Press" }));
    await userEvent.type(within(card("Barbell Bench Press")).getByLabelText("Exercise notes"), "Bar path was off");
    await waitFor(() => expect(mocked.updateExercise).toHaveBeenCalledWith(7, 1, { notes: "Bar path was off" }), SLOW);
  });

  it("moves exercises up and down (end buttons disabled)", async () => {
    await open();
    expect(within(card("Barbell Bench Press")).getByRole("button", { name: "Move Barbell Bench Press up" }).hasAttribute("disabled")).toBe(true);
    expect(within(card("Cable Fly")).getByRole("button", { name: "Move Cable Fly down" }).hasAttribute("disabled")).toBe(true);
    await userEvent.click(within(card("Cable Fly")).getByRole("button", { name: "Move Cable Fly up" }));
    await waitFor(() => expect(mocked.reorderExercises).toHaveBeenCalledWith(7, [2, 1]));
    await waitFor(() => expect(screen.getAllByRole("article").map((a) => a.getAttribute("aria-label")).slice(0, 2)).toEqual(["Cable Fly", "Barbell Bench Press"]));
  });

  it("removes an exercise only after confirmation", async () => {
    await open();
    await userEvent.click(within(card("Cable Fly")).getByRole("button", { name: "Remove Cable Fly" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/Its 2 sets and notes will be deleted from this workout. The Exercise Library is not affected./)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(mocked.removeExercise).not.toHaveBeenCalled();
    await userEvent.click(within(card("Cable Fly")).getByRole("button", { name: "Remove Cable Fly" }));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(mocked.removeExercise).toHaveBeenCalledWith(7, 2));
    await waitFor(() => expect(screen.queryByRole("article", { name: "Cable Fly" })).toBeNull());
  });

  it("adds an exercise from the library, marked as not planned", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Add exercise" }));
    const dialog = await screen.findByRole("dialog", { name: "Add an exercise" });
    expect(await within(dialog).findByRole("button", { name: "Add Lat Pulldown" })).toBeTruthy();
    await userEvent.type(within(dialog).getByLabelText("Search the exercise library"), "lat");
    await waitFor(() => expect(vi.mocked(exerciseService.list)).toHaveBeenLastCalledWith(expect.objectContaining({ search: "lat", is_active: true }), expect.anything()), SLOW);
    await userEvent.click(within(dialog).getByRole("button", { name: "Add Lat Pulldown" }));
    await waitFor(() => expect(mocked.addExercise).toHaveBeenCalledWith(7, 41));
    expect(screen.queryByRole("dialog", { name: "Add an exercise" })).toBeNull();
    const added = await screen.findByRole("article", { name: "Lat Pulldown" });
    expect(within(added).getByText("Added during this workout")).toBeTruthy();
    expect(within(added).getAllByRole("listitem")).toHaveLength(1);
  });

  it("only offers active library exercises", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Add exercise" }));
    await screen.findByRole("dialog", { name: "Add an exercise" });
    await waitFor(() => expect(vi.mocked(exerciseService.list)).toHaveBeenCalledWith(expect.objectContaining({ is_active: true }), expect.anything()));
  });

  it("marks an exercise whose library entry was deleted, but keeps showing its name", async () => {
    const s = makeSession();
    s.exercises[0] = makeExercise({ id: 1, position: 1, exercise_id: null, exercise_name: "Old Cable Row" });
    await open(s).catch(() => undefined);
    expect(await screen.findByRole("article", { name: "Old Cable Row" })).toBeTruthy();
    expect(screen.getByText("Removed from library")).toBeTruthy();
  });
});

// ============================================================================================
describe("cardio", () => {
  it("logs duration, distance, optional calories, speed, resistance and notes", async () => {
    await open();
    const run = screen.getByTestId("cardio-1");
    await userEvent.type(field(run, /duration/), "28");
    await userEvent.type(field(run, /distance/), "4.75");
    await userEvent.type(field(run, /calories/), "310");
    await userEvent.type(field(run, /speed/), "10.2");
    await userEvent.type(within(run).getByLabelText(/resistance/), "Incline 2");
    await userEvent.click(within(run).getByRole("button", { name: "Note for Running" }));
    await userEvent.type(within(run).getByLabelText(/notes/i), "Felt good");
    await userEvent.click(within(run).getByRole("button", { name: "Complete cardio" }));
    await waitFor(() => expect(mocked.updateCardio).toHaveBeenCalled(), SLOW);
    await waitSaved();
    expect(server.session.cardio[0]).toMatchObject({ duration_minutes: 28, distance_km: 4.75, calories: 310, speed_kmh: 10.2, resistance: "Incline 2", notes: "Felt good", status: "completed",
      target_duration_minutes: 30, target_distance_km: 5 });
    expect(sum("cardio")).toBe("28");
  });

  it("calories are only what you type: nothing is calculated", async () => {
    await open();
    await userEvent.click(within(screen.getByTestId("cardio-1")).getByRole("button", { name: "Complete cardio" }));
    await waitSaved();
    expect(server.session.cardio[0].calories).toBeNull();
    expect(field(screen.getByTestId("cardio-1"), /calories/).value).toBe("");
  });

  it("adds extra cardio from the master list, skips and removes cardio", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Add cardio" }));
    await userEvent.click(await screen.findByRole("button", { name: "Add Walking" }));
    await waitFor(() => expect(mocked.addCardio).toHaveBeenCalledWith(7, 1));
    const walk = await screen.findByRole("article", { name: "Walking cardio" });
    expect(within(walk).getByText("Added during this workout")).toBeTruthy();
    await userEvent.click(within(walk).getByRole("button", { name: "Skip cardio" }));
    await waitFor(() => expect(mocked.updateCardio).toHaveBeenCalledWith(7, expect.any(Number), { status: "skipped" }));
    await userEvent.click(within(walk).getByRole("button", { name: "Remove Walking" }));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.queryByRole("article", { name: "Walking cardio" })).toBeNull());
  });

  it("a cardio-only workout has no exercise cards but a working cardio section", async () => {
    const s = makeSession({ source: "blank", title: null, cycle_name: null, week_number: null, exercises: [] });
    server = installFakeServer(svc, s);
    vi.mocked(settingsService.get).mockResolvedValue(SETTINGS);
    render(<MemoryRouter initialEntries={["/workout/7"]}><ToastProvider><Routes><Route path="/workout/:id" element={<WorkoutSessionPage />} /></Routes></ToastProvider></MemoryRouter>);
    expect(await screen.findByRole("heading", { level: 1, name: "Blank workout" })).toBeTruthy();
    expect(screen.getByRole("article", { name: "Running cardio" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add exercise" })).toBeTruthy();
  });
});

// ============================================================================================
describe("units from Settings", () => {
  it("shows stored kilograms in pounds and converts what you type back to kilograms", async () => {
    const s = makeSession();
    s.exercises[0].sets[0] = makeSet({ id: 11, set_number: 1, actual_reps: 8, actual_weight_kg: 22.68, status: "completed" });
    await open(s, { weight_unit: "lbs" });
    const row = setRow(11);
    expect(within(card("Barbell Bench Press")).getByText("Planned: 3 × 6-8 @ 176.37 lbs")).toBeTruthy();
    expect(within(row).getByText("Target 6-8 reps × 176.37 lbs")).toBeTruthy();
    expect(field(row, /Set 1 weight \(lbs\)/).value).toBe("50");
    await userEvent.type(field(setRow(12), /weight \(lbs\)/), "100");
    await userEvent.tab();
    await waitFor(() => expect(mocked.updateSet).toHaveBeenCalledWith(7, 12, { actual_weight_kg: 45.359 }), SLOW);
    await waitSaved();
    expect(field(setRow(12), /weight/).value).toBe("100");                                       // shown back exactly as typed
  });

  it("never rewrites a stored weight you did not edit, however it is displayed", async () => {
    const s = makeSession();
    s.exercises[0].sets[0] = makeSet({ id: 11, set_number: 1, actual_reps: 8, actual_weight_kg: 10.093 });   // 10.093 kg shows as 22.25 lb
    await open(s, { weight_unit: "lbs" });
    const input = field(setRow(11), /weight/);
    expect(input.value).toBe("22.25");
    await userEvent.click(input);
    await userEvent.tab();                                                                             // visit, change nothing
    await userEvent.click(input);
    await userEvent.type(input, "5");
    await userEvent.type(input, "{Backspace}");                                                        // edit, then restore the same text
    await userEvent.tab();
    await new Promise((r) => setTimeout(r, 900));
    expect(server.session.exercises[0].sets[0].actual_weight_kg).toBe(10.093);
    expect(mocked.updateSet.mock.calls.every(([, , p]) => !("actual_weight_kg" in (p as object)) || (p as { actual_weight_kg: number }).actual_weight_kg === 10.093)).toBe(true);
    expect(input.value).toBe("22.25");
  });

  it("shows distance and speed in miles and converts input back to kilometres", async () => {
    const s = makeSession();
    s.cardio[0] = makeCardio({ id: 1, distance_km: 4.989, duration_minutes: 30 });
    await open(s, { distance_unit: "miles" });
    const run = screen.getByTestId("cardio-1");
    expect(within(run).getByText("Planned: 30 min · 3.11 miles")).toBeTruthy();
    expect(field(run, /distance \(miles\)/).value).toBe("3.1");
    expect(within(run).getByLabelText(/speed \(mph\)/)).toBeTruthy();
    await userEvent.type(field(run, /speed/), "6");
    await userEvent.tab();
    await waitFor(() => expect(mocked.updateCardio).toHaveBeenCalledWith(7, 1, { speed_kmh: 9.66 }), SLOW);
  });
});

// ============================================================================================
describe("saving: order, indicators and failures", () => {
  it("shows Saving… then All changes saved only after the server confirms", async () => {
    let finish!: (s: WorkoutSession) => void;
    await open();
    const real = mocked.updateSet.getMockImplementation()!;
    mocked.updateSet.mockImplementationOnce(() => new Promise<WorkoutSession>((res) => { finish = res; }));
    await userEvent.type(field(setRow(11), "Set 1 reps"), "8");
    await userEvent.tab();
    await waitFor(() => expect(mocked.updateSet).toHaveBeenCalled());
    expect(status()).toBe("Saving…");
    expect(screen.queryByText("All changes saved")).toBeNull();
    await act(async () => finish(await real(7, 11, { actual_reps: 8 })));
    expect(status()).toBe("All changes saved");
  });

  it("sends edits strictly one after another, in the order they were made", async () => {
    await open();
    const real = mocked.updateSet.getMockImplementation() as (...a: unknown[]) => Promise<WorkoutSession>;
    let release!: () => void;
    mocked.updateSet.mockImplementationOnce(async (...args: unknown[]) => {
      await new Promise<void>((res) => { release = res; });
      return real(...args);
    });
    await userEvent.type(field(setRow(11), "Set 1 reps"), "8");
    await userEvent.tab();
    await waitFor(() => expect(mocked.updateSet).toHaveBeenCalledTimes(1));
    await userEvent.type(field(setRow(12), "Set 2 reps"), "6");
    await userEvent.tab();
    await new Promise((r) => setTimeout(r, 900));
    expect(mocked.updateSet).toHaveBeenCalledTimes(1);                                                // the second waits for the first
    await act(async () => release());
    await waitFor(() => expect(mocked.updateSet).toHaveBeenCalledTimes(2));
    expect(mocked.updateSet.mock.calls.map((c) => [c[1], c[2]])).toEqual([[11, { actual_reps: 8 }], [12, { actual_reps: 6 }]]);
    await waitSaved();
  });

  it("keeps what you typed visible while it is still being saved", async () => {
    await open();
    let release!: () => void;
    const real = mocked.updateSet.getMockImplementation() as (...a: unknown[]) => Promise<WorkoutSession>;
    mocked.updateSet.mockImplementationOnce(async (...args: unknown[]) => { await new Promise<void>((res) => { release = res; }); return real(...args); });
    await userEvent.type(field(setRow(11), "Set 1 reps"), "11");
    await userEvent.tab();
    await waitFor(() => expect(mocked.updateSet).toHaveBeenCalled());
    expect(field(setRow(11), "Set 1 reps").value).toBe("11");
    await act(async () => release());
    await waitSaved();
    expect(field(setRow(11), "Set 1 reps").value).toBe("11");
  });

  it("pending edits are sent before a structural change", async () => {
    await open();
    await userEvent.type(field(setRow(11), "Set 1 reps"), "5");
    await userEvent.click(within(card("Cable Fly")).getByRole("button", { name: "Add set" }));
    await waitFor(() => expect(mocked.addSet).toHaveBeenCalled(), SLOW);
    expect(mocked.updateSet.mock.invocationCallOrder[0]).toBeLessThan(mocked.addSet.mock.invocationCallOrder[0]);
  });

  it("retries a network hiccup once, quietly", async () => {
    await open();
    const real = mocked.updateSet.getMockImplementation()!;
    mocked.updateSet.mockRejectedValueOnce(new ApiError({ kind: "network", message: "Can't reach the server." }));
    await userEvent.type(field(setRow(11), "Set 1 reps"), "9");
    await userEvent.tab();
    await waitFor(() => expect(mocked.updateSet).toHaveBeenCalledTimes(2), SLOW);
    await waitSaved();
    expect(real).toBeTruthy();
    expect(server.session.exercises[0].sets[0].actual_reps).toBe(9);
    expect(screen.queryByText(/Save failed/)).toBeNull();
  });

  it("when saving keeps failing it says so, keeps your entry, and retries on demand", async () => {
    await open();
    const real = mocked.updateSet.getMockImplementation()!;
    mocked.updateSet.mockRejectedValue(new ApiError({ kind: "network", message: "Can't reach the server. Check your connection." }));
    await userEvent.type(field(setRow(11), "Set 1 reps"), "9");
    await userEvent.tab();
    await waitFor(() => expect(status()).toMatch(/^Save failed/), { timeout: 5000 });
    expect(screen.getByRole("alert").textContent).toContain("Can't reach the server");
    expect(screen.queryByText("All changes saved")).toBeNull();                                      // never claims success
    expect(field(setRow(11), "Set 1 reps").value).toBe("9");                                          // the entry is still on screen
    expect(server.session.exercises[0].sets[0].actual_reps).toBeNull();
    mocked.updateSet.mockImplementation(real);
    await userEvent.click(screen.getByRole("button", { name: /Retry/ }));
    await waitSaved();
    expect(server.session.exercises[0].sets[0].actual_reps).toBe(9);
  }, 15000);

  it("a value the server refuses is dropped, explained, and the screen shows the stored value again", async () => {
    await open();
    mocked.updateSet.mockRejectedValueOnce(new ApiError({ kind: "validation", status: 422, code: "validation_error", message: "Some of the submitted values are invalid." }));
    await userEvent.type(field(setRow(11), "Set 1 reps"), "9");
    await userEvent.tab();
    expect(await screen.findByText("Some of the submitted values are invalid.")).toBeTruthy();
    await waitFor(() => expect(field(setRow(11), "Set 1 reps").value).toBe(""));
    expect(mocked.get).toHaveBeenCalledTimes(2);                                                       // re-read from the server
  });

  it("warns before the tab is closed while changes are unsaved, not afterwards", async () => {
    await open();
    await userEvent.type(field(setRow(11), "Set 1 reps"), "9");
    const during = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(during);
    expect(during.defaultPrevented).toBe(true);
    await waitSaved();
    const after = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it("sends pending edits when the tab is hidden", async () => {
    await open();
    await userEvent.type(field(setRow(11), "Set 1 reps"), "9");
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(mocked.updateSet).toHaveBeenCalledWith(7, 11, { actual_reps: 9 }), { timeout: 400 });
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });
});

// ============================================================================================
describe("completing and cancelling", () => {
  async function logSomething() {
    await userEvent.click(within(setRow(11)).getByRole("button", { name: "Mark set 1 done" }));
  }

  it("asks for confirmation with a summary and an optional note, then makes the workout read-only", async () => {
    await open();
    await logSomething();
    await userEvent.click(screen.getByRole("button", { name: "Complete workout" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Complete this workout?")).toBeTruthy();
    expect(dialog.textContent).toContain("0 of 2 exercises done");
    expect(dialog.textContent).toContain("1 sets completed");
    expect(mocked.complete).not.toHaveBeenCalled();
    await userEvent.type(within(dialog).getByLabelText("Overall note (optional)"), "  Strong session  ");
    await userEvent.click(within(dialog).getByRole("button", { name: "Complete workout" }));
    await waitFor(() => expect(mocked.complete).toHaveBeenCalledWith(7, "Strong session"));
    expect(await screen.findByText("Workout completed.")).toBeTruthy();
    expect(screen.getByTestId("session-status").textContent).toBe("Completed");
    expect(screen.queryByRole("group", { name: "Workout actions" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add set" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add exercise" })).toBeNull();
    expect(field(setRow(11), "Set 1 reps").disabled).toBe(true);
    expect(screen.getByText("Strong session")).toBeTruthy();
    expect(screen.getByTestId("session-elapsed").textContent).toBe("1 h 15 min");                    // the stored duration, no longer running
  });

  it("can be dismissed with Keep logging", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Complete workout" }));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Keep logging" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(mocked.complete).not.toHaveBeenCalled();
  });

  it("warns when nothing has been marked done", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Complete workout" }));
    expect((await screen.findByRole("alertdialog")).textContent).toContain("Nothing is marked done yet");
  });

  it("does not warn when something was logged", async () => {
    await open();
    await logSomething();
    await userEvent.click(screen.getByRole("button", { name: "Complete workout" }));
    expect((await screen.findByRole("alertdialog")).textContent).not.toContain("Nothing is marked done yet");
  });

  it("completes only once however many times Confirm is tapped", async () => {
    await open();
    await logSomething();
    await userEvent.click(screen.getByRole("button", { name: "Complete workout" }));
    const confirm = within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Complete workout" });
    fireEvent.click(confirm); fireEvent.click(confirm); fireEvent.click(confirm);
    await waitFor(() => expect(screen.getByTestId("session-status").textContent).toBe("Completed"));
    expect(mocked.complete).toHaveBeenCalledTimes(1);
  });

  it("saves what you just typed before completing", async () => {
    await open();
    await userEvent.type(field(setRow(11), "Set 1 reps"), "9");                                      // still inside the typing pause
    await userEvent.click(screen.getByRole("button", { name: "Complete workout" }));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Complete workout" }));
    await waitFor(() => expect(mocked.complete).toHaveBeenCalled(), SLOW);
    expect(mocked.updateSet.mock.invocationCallOrder[0]).toBeLessThan(mocked.complete.mock.invocationCallOrder[0]);
    expect(server.session.exercises[0].sets[0].actual_reps).toBe(9);
  });

  it("refuses to finish while changes cannot be saved, and tells you why", async () => {
    await open();
    mocked.updateSet.mockRejectedValue(new ApiError({ kind: "network", message: "Can't reach the server." }));
    await userEvent.type(field(setRow(11), "Set 1 reps"), "9");
    await userEvent.tab();
    await waitFor(() => expect(status()).toMatch(/^Save failed/), { timeout: 5000 });
    await userEvent.click(screen.getByRole("button", { name: "Complete workout" }));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Complete workout" }));
    expect(await within(screen.getByRole("alertdialog")).findByText(/haven't been saved yet/)).toBeTruthy();
    expect(mocked.complete).not.toHaveBeenCalled();
    expect(screen.getByTestId("session-status").textContent).toBe("In progress");
  }, 15000);

  it("shows a server error inside the dialog and stays in progress", async () => {
    await open();
    mocked.complete.mockRejectedValueOnce(new ApiError({ kind: "server", status: 500, message: "Something went wrong on the server." }));
    await userEvent.click(screen.getByRole("button", { name: "Complete workout" }));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Complete workout" }));
    expect(await within(screen.getByRole("alertdialog")).findByText("Something went wrong on the server.")).toBeTruthy();
    expect(screen.getByTestId("session-status").textContent).toBe("In progress");
  });

  it("cancels with a reason after confirmation", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Cancel workout" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Cancel this workout?")).toBeTruthy();
    expect(mocked.cancel).not.toHaveBeenCalled();
    await userEvent.type(within(dialog).getByLabelText("Reason (optional)"), "Felt unwell");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel workout" }));
    await waitFor(() => expect(mocked.cancel).toHaveBeenCalledWith(7, "Felt unwell"));
    expect(await screen.findByText("Workout cancelled.")).toBeTruthy();
    expect(screen.getByTestId("session-status").textContent).toBe("Cancelled");
    expect(screen.getByText("Reason for cancelling")).toBeTruthy();
    expect(screen.getByText("Felt unwell")).toBeTruthy();
  });

  it("an empty reason is sent as null", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Cancel workout" }));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel workout" }));
    await waitFor(() => expect(mocked.cancel).toHaveBeenCalledWith(7, null));
  });
});

// ============================================================================================
describe("read-only sessions", () => {
  it("a completed session cannot be edited: no actions, disabled inputs, stored duration", async () => {
    const s = makeSession({ status: "completed", ended_at: "2026-11-19T06:15:00Z", duration_seconds: 4500, notes: "Great" });
    s.exercises[0].sets[0] = makeSet({ id: 11, set_number: 1, status: "completed", actual_reps: 8, actual_weight_kg: 80 });
    await open(s);
    expect(screen.getByTestId("session-status").textContent).toBe("Completed");
    expect(screen.getByText("WORKOUT LOG")).toBeTruthy();
    expect(screen.getByTestId("session-elapsed").textContent).toBe("1 h 15 min");
    expect(screen.queryByTestId("save-status")).toBeNull();
    for (const name of [/Add set/, /Add exercise/, /Add cardio/, /Complete workout/, /Cancel workout/, /Mark set/, /Remove/, /Move .* (up|down)/, /Skip/, /Complete exercise/]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    for (const input of screen.getAllByRole("textbox")) expect((input as HTMLInputElement).disabled).toBe(true);
    expect(field(setRow(11), "Set 1 reps").value).toBe("8");
    expect(screen.getByText("Great")).toBeTruthy();
    expect(mocked.updateSet).not.toHaveBeenCalled();
  });

  it("a cancelled session shows its reason and is read-only too", async () => {
    await open(makeSession({ status: "cancelled", ended_at: "2026-11-19T05:20:00Z", duration_seconds: 1200, cancel_reason: "Gym closed" }));
    expect(screen.getByTestId("session-status").textContent).toBe("Cancelled");
    expect(screen.getByText("Gym closed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add set" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Workout actions" })).toBeNull();
  });

  it("if the server says the workout was already finished (another tab), the screen becomes read-only", async () => {
    await open();
    server.session.status = "completed";
    server.session.ended_at = "2026-11-19T06:15:00Z";
    server.session.duration_seconds = 4500;
    await userEvent.type(field(setRow(11), "Set 1 reps"), "9");
    await userEvent.tab();
    expect(await screen.findByText(/can no longer be changed/)).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("session-status").textContent).toBe("Completed"));
    expect(screen.queryByRole("group", { name: "Workout actions" })).toBeNull();
  });
});

// ============================================================================================
describe("mobile and accessibility", () => {
  it("number fields ask for numeric keyboards and switch off autofill and autocorrect", async () => {
    await open();
    const reps = field(setRow(11), "Set 1 reps"), weight = field(setRow(11), /weight/), rest = field(setRow(11), /rest/);
    expect(reps.getAttribute("inputmode")).toBe("numeric");
    expect(weight.getAttribute("inputmode")).toBe("decimal");
    expect(rest.getAttribute("inputmode")).toBe("numeric");
    for (const el of [reps, weight, rest]) {
      expect(el.getAttribute("autocomplete")).toBe("off");
      expect(el.getAttribute("autocorrect")).toBe("off");
      expect(el.getAttribute("enterkeyhint")).toBe("done");
      expect(el.type).toBe("text");
    }
    const run = screen.getByTestId("cardio-1");
    expect(field(run, /duration/).getAttribute("inputmode")).toBe("numeric");
    expect(field(run, /distance/).getAttribute("inputmode")).toBe("decimal");
  });

  it("every control has an accessible name and toggles expose their state", async () => {
    await open();
    const done = within(setRow(11)).getByRole("button", { name: "Mark set 1 done" });
    expect(done.getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(done);
    expect(within(setRow(11)).getByRole("button", { name: "Undo done for set 1" }).getAttribute("aria-pressed")).toBe("true");
    for (const b of screen.getAllByRole("button")) expect((b.textContent || b.getAttribute("aria-label") || "").trim().length).toBeGreaterThan(0);
    expect(screen.getByRole("group", { name: "Workout actions" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Workout summary" })).toBeTruthy();
  });

  it("the Complete and Cancel actions stay available in a persistent bar", async () => {
    await open();
    const bar = screen.getByRole("group", { name: "Workout actions" });
    expect(within(bar).getByRole("button", { name: "Complete workout" })).toBeTruthy();
    expect(within(bar).getByRole("button", { name: "Cancel workout" })).toBeTruthy();
  });

  it("the back link returns to the workout list", async () => {
    await open();
    await userEvent.click(screen.getByRole("link", { name: /Workouts/ }));
    expect(await screen.findByText("Workout list")).toBeTruthy();
  });
});
