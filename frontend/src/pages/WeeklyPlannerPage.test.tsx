// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import WeeklyPlannerPage from "./WeeklyPlannerPage";
import { ToastProvider } from "../components/ui/Toast";
import { ApiError } from "../services/apiError";
import { exerciseService, masterDataService } from "../services/exerciseService";
import { cycleService, plannerService, planningMasterData } from "../services/plannerService";
import { workoutService } from "../services/workoutService";
import { MUSCLE_GROUPS, WORKOUT_TYPES, makeExercise, makeList } from "../features/exercises/testData";
import { CARDIO, cardioDay, chestDay, makeCycle, makeCycleDetail, makeDay, makeWeek, plannedExercise } from "../features/planner/testData";

vi.mock("../services/plannerService", () => ({
  cycleService: { list: vi.fn(), get: vi.fn() },
  plannerService: {
    getWeek: vi.fn(), getDay: vi.fn(), putDay: vi.fn(), clearDay: vi.fn(), clearWeek: vi.fn(), addMuscleGroup: vi.fn(),
    removeMuscleGroup: vi.fn(), addExercise: vi.fn(), updateExercise: vi.fn(), removeExercise: vi.fn(), reorderExercises: vi.fn(),
    addCardio: vi.fn(), updateCardio: vi.fn(), removeCardio: vi.fn(), copyDay: vi.fn(), copyWeek: vi.fn(),
  },
  planningMasterData: { cardioActivities: vi.fn() },
}));
vi.mock("../services/workoutService", () => ({ workoutService: { start: vi.fn(), list: vi.fn() } }));
vi.mock("../services/exerciseService", () => ({
  exerciseService: { list: vi.fn() },
  masterDataService: { muscleGroups: vi.fn(), workoutTypes: vi.fn() },
}));

const cycles = vi.mocked(cycleService);
const planner = vi.mocked(plannerService);
const ex = vi.mocked(exerciseService);

const ACTIVE = makeCycle({ id: 1, name: "Winter Block", status: "active" });
const DONE = makeCycle({ id: 2, name: "Autumn Base", status: "completed", start_date: "2026-08-03", end_date: "2026-09-13", total_weeks: 6 });

function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname + l.search}</div>; }
function renderPlanner(url = "/planner") {
  return render(<MemoryRouter initialEntries={[url]}><ToastProvider><WeeklyPlannerPage /><Where /></ToastProvider></MemoryRouter>);
}
const dayRow = (d: number) => within(screen.getByTestId(`day-${d}`));
async function openEditor(d = 0, label = /Plan day|Edit day|View/) {
  const user = userEvent.setup();
  renderPlanner();
  await screen.findByTestId(`day-${d}`);
  await user.click(dayRow(d).getByRole("button", { name: label }));
  const dialog = await screen.findByRole("dialog", { name: /week \d/ });
  return { user, dialog };
}

beforeEach(() => {
  window.scrollTo = vi.fn();
  cycles.list.mockResolvedValue([ACTIVE, DONE]);
  cycles.get.mockImplementation(async (id) => makeCycleDetail(id === 2 ? DONE : ACTIVE));
  planner.getWeek.mockImplementation(async (cid, w) => makeWeek(w, { 0: { kind: "strength", status: "planned", display_title: "Chest", muscle_groups: [{ id: 1, name: "Chest" }], exercise_count: 2 } }, cid === 2 ? DONE : ACTIVE));
  planner.getDay.mockResolvedValue(makeDay());
  vi.mocked(workoutService.list).mockResolvedValue({ items: [], total: 0, page: 1, page_size: 10 });
  (masterDataService.muscleGroups as ReturnType<typeof vi.fn>).mockResolvedValue(MUSCLE_GROUPS);
  (masterDataService.workoutTypes as ReturnType<typeof vi.fn>).mockResolvedValue(WORKOUT_TYPES);
  vi.mocked(planningMasterData.cardioActivities).mockResolvedValue(CARDIO);
  ex.list.mockResolvedValue(makeList([makeExercise({ id: 1, name: "Barbell Bench Press" }), makeExercise({ id: 2, name: "Cable Fly" })]));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("page and week selection", () => {
  it("opens the active cycle's week 1 with seven days Monday..Sunday and their dates", async () => {
    renderPlanner();
    await screen.findByTestId("day-6");
    expect(screen.getByRole("heading", { name: "Weekly Planner" })).toBeTruthy();
    expect((screen.getByLabelText("Select cycle") as HTMLSelectElement).value).toBe("1");
    expect(planner.getWeek).toHaveBeenCalledWith(1, 1, expect.anything());
    const days = screen.getAllByTestId(/^day-\d$/);
    expect(days).toHaveLength(7);
    const names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    days.forEach((d, i) => expect(within(d).getByText(names[i])).toBeTruthy());
    expect(within(days[0]).getByText("16 Nov")).toBeTruthy();
    expect(within(days[6]).getByText("22 Nov")).toBeTruthy();
    expect(screen.getByTestId("week-range").textContent).toMatch(/16 Nov – 22 Nov 2026/);
  });

  it("shows one chip per week of the cycle, however many there are", async () => {
    cycles.list.mockResolvedValue([makeCycle({ total_weeks: 13 })]);
    cycles.get.mockResolvedValue(makeCycleDetail({ total_weeks: 13 }));
    renderPlanner();
    await screen.findByTestId("day-0");
    expect(screen.getAllByRole("button", { name: /^Week \d+/ })).toHaveLength(13);
  });

  it("week chips switch weeks, update the URL and the dates", async () => {
    const user = userEvent.setup();
    renderPlanner();
    await screen.findByTestId("day-0");
    await user.click(screen.getByRole("button", { name: /^Week 3/ }));
    await waitFor(() => expect(planner.getWeek).toHaveBeenCalledWith(1, 3, expect.anything()));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Week 3" })).toBeTruthy());
    expect(screen.getByTestId("week-range").textContent).toMatch(/30 Nov – 6 Dec 2026/);
    expect(screen.getByTestId("where").textContent).toBe("/planner?week=3");
    await user.click(screen.getByRole("button", { name: "Next week" }));
    await waitFor(() => expect(planner.getWeek).toHaveBeenCalledWith(1, 4, expect.anything()));
    await user.click(screen.getByRole("button", { name: "Previous week" }));
    await waitFor(() => expect(planner.getWeek).toHaveBeenLastCalledWith(1, 3, expect.anything()));
  });

  it("prev/next are disabled at the ends", async () => {
    renderPlanner();
    await screen.findByTestId("day-0");
    expect((screen.getByRole("button", { name: "Previous week" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Next week" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("restores cycle and week from the URL and clamps nonsense", async () => {
    renderPlanner("/planner?cycle=1&week=5");
    await waitFor(() => expect(planner.getWeek).toHaveBeenCalledWith(1, 5, expect.anything()));
    cleanup(); vi.clearAllMocks();
    cycles.list.mockResolvedValue([ACTIVE]); cycles.get.mockResolvedValue(makeCycleDetail(ACTIVE));
    planner.getWeek.mockImplementation(async (_c, w) => makeWeek(w));
    (masterDataService.muscleGroups as ReturnType<typeof vi.fn>).mockResolvedValue(MUSCLE_GROUPS);
    (masterDataService.workoutTypes as ReturnType<typeof vi.fn>).mockResolvedValue(WORKOUT_TYPES);
    vi.mocked(planningMasterData.cardioActivities).mockResolvedValue(CARDIO);
    renderPlanner("/planner?cycle=999&week=99");
    await waitFor(() => expect(planner.getWeek).toHaveBeenCalledWith(1, 8, expect.anything())); // unknown cycle -> default; week clamped
  });

  it("switching cycle loads that cycle", async () => {
    const user = userEvent.setup();
    renderPlanner();
    await screen.findByTestId("day-0");
    await user.selectOptions(screen.getByLabelText("Select cycle"), "Autumn Base (Completed)");
    await waitFor(() => expect(planner.getWeek).toHaveBeenCalledWith(2, 1, expect.anything()));
    expect(await screen.findByTestId("locked-banner")).toBeTruthy();
  });

  it("each day summarises its plan: rest, cardio, strength and not-planned", async () => {
    planner.getWeek.mockResolvedValue(makeWeek(1, {
      0: { kind: "strength", status: "planned", title: "Push day", display_title: "Push day", muscle_groups: [{ id: 1, name: "Chest" }, { id: 5, name: "Triceps" }], exercise_count: 5, notes: "Heavy first" },
      2: { kind: "mixed", status: "planned", display_title: "Shoulders + Cardio", muscle_groups: [{ id: 3, name: "Shoulders" }], exercise_count: 2, cardio_count: 1 },
      5: { kind: "cardio", status: "planned", display_title: "Cardio", cardio_count: 1 },
      6: { kind: "rest", status: "rest", display_title: "Rest day" },
    }));
    renderPlanner();
    await screen.findByTestId("day-0");
    const mon = dayRow(0);
    expect(mon.getByText("Strength")).toBeTruthy(); expect(mon.getByText("Push day")).toBeTruthy();
    expect(mon.getByText("Chest")).toBeTruthy(); expect(mon.getByText("Triceps")).toBeTruthy();
    expect(mon.getByText("5 exercises")).toBeTruthy(); expect(mon.getByText("Heavy first")).toBeTruthy();
    expect(dayRow(2).getByText("Strength + cardio")).toBeTruthy();
    expect(dayRow(2).getByText("1 cardio")).toBeTruthy();
    expect(dayRow(5).getByText("Cardio", { selector: ".kind-badge" })).toBeTruthy();
    expect(dayRow(5).queryByText("exercises")).toBeNull();
    expect(dayRow(6).getByText("Rest day")).toBeTruthy();
    expect(dayRow(1).getByText("Not planned")).toBeTruthy();
    expect(dayRow(1).getByRole("button", { name: "Plan day Tuesday" })).toBeTruthy();
    expect(dayRow(0).getByRole("button", { name: "Edit day Monday" })).toBeTruthy();
  });

  it("empty app: asks to create a cycle first", async () => {
    cycles.list.mockResolvedValue([]);
    renderPlanner();
    await screen.findByText("No cycle to plan yet");
    expect(screen.getByRole("link", { name: /Go to Workout Cycles/ }).getAttribute("href")).toBe("/cycles");
  });

  it("error states with retry (cycles, week)", async () => {
    const user = userEvent.setup();
    cycles.list.mockRejectedValueOnce(new ApiError({ kind: "network", message: "Can't reach the server." }));
    renderPlanner();
    await screen.findByText("Couldn't load your cycles");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByTestId("day-0");
    planner.getWeek.mockRejectedValueOnce(new ApiError({ kind: "server", message: "Something went wrong on the server." }));
    await user.click(screen.getByRole("button", { name: /^Week 2/ }));
    await screen.findByText("Couldn't load this week");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByTestId("day-0");
  });

  it("a completed cycle is view-only: banner, 'View' buttons, no copy/clear", async () => {
    cycles.list.mockResolvedValue([DONE]);
    renderPlanner();
    expect((await screen.findByTestId("locked-banner")).textContent).toMatch(/completed.*view-only/);
    expect(screen.queryByRole("button", { name: /copy week/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /clear week/i })).toBeNull();
    expect(dayRow(0).getByRole("button", { name: "View Monday" })).toBeTruthy();
  });
});

describe("opened from the Calendar (?day=)", () => {
  it("opens that day's editor straight away and removes the parameter when closed", async () => {
    planner.getDay.mockResolvedValue(chestDay({ day_of_week: 2, date: "2026-11-18" }));
    const user = userEvent.setup();
    renderPlanner("/planner?cycle=1&week=2&day=2");
    const dialog = await screen.findByRole("dialog", { name: /Wednesday.*week 2/ });
    expect(planner.getDay).toHaveBeenCalledWith(1, 2, 2, expect.anything());
    expect(screen.getByTestId("where").textContent).toBe("/planner?cycle=1&week=2&day=2");
    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByTestId("where").textContent).toBe("/planner?cycle=1&week=2");     // a refresh won't reopen it
  });

  it("ignores an invalid day parameter", async () => {
    renderPlanner("/planner?cycle=1&day=9");
    await screen.findByTestId("day-0");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("day editor: structure", () => {
  it("loads the day and shows groups with exercises, order and details from the library", async () => {
    planner.getDay.mockResolvedValue(chestDay());
    const { dialog } = await openEditor(0);
    expect(planner.getDay).toHaveBeenCalledWith(1, 1, 0, expect.anything());
    expect(dialog.textContent).toMatch(/Monday · 16 Nov 2026 — week 1/);
    const group = within(await within(dialog).findByRole("article", { name: "Chest exercises" }));
    const rows = group.getAllByRole("listitem");
    expect(rows[0].textContent).toMatch(/Barbell Bench Press/);
    expect(rows[0].textContent).toMatch(/4 × 6-8 @ 80 kg · rest 120s/);
    expect(rows[0].textContent).toMatch(/Middle Chest/); expect(rows[0].textContent).toMatch(/Barbell/);
    expect(rows[1].textContent).toMatch(/Cable Fly/); expect(rows[1].textContent).toMatch(/3 × 10/);
  });

  it("adds muscle groups (only ones not already in the day)", async () => {
    planner.getDay.mockResolvedValue(chestDay());
    planner.addMuscleGroup.mockResolvedValue(chestDay({ strength: [...chestDay().strength, { id: 22, muscle_group: { id: 5, name: "Triceps" }, notes: null, exercises: [] }] }));
    const { user, dialog } = await openEditor(0);
    const select = (await within(dialog).findByLabelText("Muscle group to add")) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).not.toContain("Chest"); // already added
    await user.selectOptions(select, "Triceps");
    await user.click(within(dialog).getByRole("button", { name: /add muscle group/i }));
    await waitFor(() => expect(planner.addMuscleGroup).toHaveBeenCalledWith(1, 1, 0, 5));
    expect(await within(dialog).findByRole("article", { name: "Triceps exercises" })).toBeTruthy();
  });

  it("removing a muscle group asks first and names what goes with it", async () => {
    planner.getDay.mockResolvedValue(chestDay());
    planner.removeMuscleGroup.mockResolvedValue(makeDay());
    const { user, dialog } = await openEditor(0);
    await user.click(await within(dialog).findByRole("button", { name: "Remove Chest from this day" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(confirm.textContent).toMatch(/Chest and its 2 planned exercise/);
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(planner.removeMuscleGroup).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Remove Chest from this day" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(planner.removeMuscleGroup).toHaveBeenCalledWith(1, 1, 0, 1));
  });

  it("saves day title and notes", async () => {
    planner.getDay.mockResolvedValue(chestDay());
    planner.putDay.mockResolvedValue(chestDay({ title: "Push", notes: "Heavy" }));
    const { user, dialog } = await openEditor(0);
    expect(within(dialog).queryByRole("button", { name: /save title/i })).toBeNull();   // nothing changed yet
    await user.type(await within(dialog).findByLabelText(/Day title/), " Push ");
    await user.type(within(dialog).getByLabelText(/Day notes/), "Heavy");
    await user.click(within(dialog).getByRole("button", { name: /save title/i }));
    await waitFor(() => expect(planner.putDay).toHaveBeenCalledWith(1, 1, 0, { status: "planned", title: "Push", notes: "Heavy" }));
  });
});

describe("day editor: exercises", () => {
  async function openAddForm() {
    planner.getDay.mockResolvedValue(chestDay());
    const ctx = await openEditor(0);
    await ctx.user.click(await within(ctx.dialog).findByRole("button", { name: /Add exercise to Chest/ }));
    const form = within(await screen.findByRole("form", { name: "Add exercise" }));
    return { ...ctx, form };
  }

  it("the picker starts on the group's muscle and lists library exercises", async () => {
    const { form } = await openAddForm();
    await form.findByRole("button", { name: /Barbell Bench Press/ });
    expect(ex.list).toHaveBeenCalledWith(expect.objectContaining({ muscle_group_id: 1, is_active: true }), expect.anything());
    expect((form.getByLabelText("Filter by muscle group") as HTMLSelectElement).value).toBe("1");
  });

  it("filters the picker by search, muscle group and workout type", async () => {
    const { user, form } = await openAddForm();
    await form.findByRole("button", { name: /Cable Fly/ });
    await user.type(form.getByLabelText("Search exercises to add"), "fly");
    await waitFor(() => expect(ex.list).toHaveBeenLastCalledWith(expect.objectContaining({ search: "fly" }), expect.anything()));
    await user.selectOptions(form.getByLabelText("Filter by muscle group"), "All muscle groups");
    await waitFor(() => expect(ex.list).toHaveBeenLastCalledWith(expect.objectContaining({ muscle_group_id: undefined }), expect.anything()));
    await user.selectOptions(form.getByLabelText("Filter by workout type"), "Cable");
    await waitFor(() => expect(ex.list).toHaveBeenLastCalledWith(expect.objectContaining({ workout_type_id: 4 }), expect.anything()));
  });

  it("shows an empty hint when nothing matches", async () => {
    ex.list.mockResolvedValue(makeList([]));
    const { form } = await openAddForm();
    expect(await form.findByText(/No active exercises match/)).toBeTruthy();
    expect(form.getByRole("link", { name: /add one in the Exercise Library/ }).getAttribute("href")).toBe("/exercises");
  });

  it("validates before sending: exercise required, sets 1-20, reps format, weight, rest", async () => {
    const { user, form } = await openAddForm();
    await form.findByRole("button", { name: /Cable Fly/ });
    await user.click(form.getByRole("button", { name: "Add to day" }));
    expect(await form.findByText("Choose an exercise from your library.")).toBeTruthy();
    await user.click(form.getByRole("button", { name: /Cable Fly/ }));
    const sets = form.getByLabelText("Sets"), reps = form.getByLabelText("Target reps");
    await user.clear(sets); await user.type(sets, "25");
    await user.clear(reps); await user.type(reps, "abc");
    await user.type(form.getByLabelText("Weight (kg)"), "-4");
    await user.type(form.getByLabelText("Rest (seconds)"), "5000");
    await user.click(form.getByRole("button", { name: "Add to day" }));
    expect(await form.findByText(/1 to 20/)).toBeTruthy();
    expect(form.getByText(/Use a number, a range/)).toBeTruthy();
    expect(form.getByText(/between 0 and 1000 kg/)).toBeTruthy();
    expect(form.getByText(/up to 3600/)).toBeTruthy();
    expect(planner.addExercise).not.toHaveBeenCalled();
  });

  it("adds an exercise with the exact payload", async () => {
    planner.addExercise.mockResolvedValue(chestDay());
    const { user, form } = await openAddForm();
    await user.click(await form.findByRole("button", { name: /Barbell Bench Press/ }));
    expect(form.getByTestId("picked-exercise").textContent).toMatch(/Barbell Bench Press/);
    const sets = form.getByLabelText("Sets"), reps = form.getByLabelText("Target reps");
    await user.clear(sets); await user.type(sets, "5");
    await user.clear(reps); await user.type(reps, " 6 - 8 ");
    await user.type(form.getByLabelText("Weight (kg)"), "82.5");
    await user.type(form.getByLabelText("Rest (seconds)"), "120");
    await user.type(form.getByLabelText("Notes"), "Pause");
    await user.click(form.getByRole("button", { name: "Add to day" }));
    await waitFor(() => expect(planner.addExercise).toHaveBeenCalledWith(1, 1, 0, 1, {
      exercise_id: 1, target_sets: 5, target_reps: "6-8", target_weight_kg: 82.5, rest_seconds: 120, notes: "Pause" }));
    await waitFor(() => expect(screen.queryByRole("form", { name: "Add exercise" })).toBeNull());   // form closes on success
  });

  it("server errors land on the right field and the form stays open", async () => {
    planner.addExercise.mockRejectedValue(new ApiError({ kind: "client", status: 409, code: "exercise_already_added", message: "This exercise is already in this muscle group for the day.",
      details: [{ field: "exercise_id", message: "Already added to this muscle group." }] }));
    const { user, form } = await openAddForm();
    await user.click(await form.findByRole("button", { name: /Cable Fly/ }));
    await user.click(form.getByRole("button", { name: "Add to day" }));
    expect(await form.findByText("Already added to this muscle group.")).toBeTruthy();
    expect(screen.getByRole("form", { name: "Add exercise" })).toBeTruthy();
  });

  it("a network failure is shown inside the form", async () => {
    planner.addExercise.mockRejectedValue(new ApiError({ kind: "network", message: "Can't reach the server." }));
    const { user, form } = await openAddForm();
    await user.click(await form.findByRole("button", { name: /Cable Fly/ }));
    await user.click(form.getByRole("button", { name: "Add to day" }));
    expect((await form.findByRole("alert")).textContent).toBe("Can't reach the server.");
  });

  it("edits a planned exercise (pre-filled) via PUT on the plan row", async () => {
    planner.getDay.mockResolvedValue(chestDay());
    planner.updateExercise.mockResolvedValue(chestDay());
    const { user, dialog } = await openEditor(0);
    await user.click(await within(dialog).findByRole("button", { name: "Edit Barbell Bench Press" }));
    const form = within(await screen.findByRole("form", { name: "Edit planned exercise" }));
    expect((form.getByLabelText("Sets") as HTMLInputElement).value).toBe("4");
    expect((form.getByLabelText("Target reps") as HTMLInputElement).value).toBe("6-8");
    expect((form.getByLabelText("Weight (kg)") as HTMLInputElement).value).toBe("80");
    expect(form.getByTestId("picked-exercise").textContent).toMatch(/Barbell Bench Press/);
    const sets = form.getByLabelText("Sets");
    await user.clear(sets); await user.type(sets, "6");
    await user.click(form.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(planner.updateExercise).toHaveBeenCalledWith(11, expect.objectContaining({ exercise_id: 111, target_sets: 6, target_reps: "6-8", target_weight_kg: 80, rest_seconds: 120 })));
  });

  it("removes an exercise from the day only after confirmation", async () => {
    planner.getDay.mockResolvedValue(chestDay());
    planner.removeExercise.mockResolvedValue(chestDay());
    const { user, dialog } = await openEditor(0);
    await user.click(await within(dialog).findByRole("button", { name: "Remove Cable Fly" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Remove this exercise?" });
    expect(confirm.textContent).toMatch(/stays in your library/);
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(planner.removeExercise).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Remove Cable Fly" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(planner.removeExercise).toHaveBeenCalledWith(12));
  });

  it("reorders with up/down and sends the complete new order", async () => {
    planner.getDay.mockResolvedValue(chestDay());
    planner.reorderExercises.mockResolvedValue(chestDay());
    const { user, dialog } = await openEditor(0);
    expect((await within(dialog).findByRole("button", { name: "Move Barbell Bench Press up" }) as HTMLButtonElement).disabled).toBe(true);   // top row
    expect((within(dialog).getByRole("button", { name: "Move Cable Fly down" }) as HTMLButtonElement).disabled).toBe(true);                   // bottom row
    await user.click(within(dialog).getByRole("button", { name: "Move Cable Fly up" }));
    await waitFor(() => expect(planner.reorderExercises).toHaveBeenCalledWith(1, 1, 0, 1, [12, 11]));
    await user.click(within(dialog).getByRole("button", { name: "Move Barbell Bench Press down" }));
    await waitFor(() => expect(planner.reorderExercises).toHaveBeenLastCalledWith(1, 1, 0, 1, [12, 11]));
  });

  it("shows the server's version of the day after a change (order + renumbering)", async () => {
    const reordered = chestDay();
    reordered.strength[0].exercises = [plannedExercise(12, 1, "Cable Fly"), plannedExercise(11, 2, "Barbell Bench Press")];
    planner.getDay.mockResolvedValue(chestDay());
    planner.reorderExercises.mockResolvedValue(reordered);
    const { user, dialog } = await openEditor(0);
    await user.click(await within(dialog).findByRole("button", { name: "Move Cable Fly up" }));
    await waitFor(() => {
      const rows = within(dialog).getAllByRole("listitem").filter((li) => li.className === "" || li.querySelector(".ex-row"));
      expect(rows[0].textContent).toMatch(/1.*Cable Fly/);
    });
  });
});

describe("day editor: rest day and cardio", () => {
  it("an unplanned day can be made a rest day", async () => {
    planner.putDay.mockResolvedValue(makeDay({ status: "rest", kind: "rest", display_title: "Rest day" }));
    const { user, dialog } = await openEditor(6);
    await user.click(await within(dialog).findByRole("button", { name: "Rest day" }));
    await waitFor(() => expect(planner.putDay).toHaveBeenCalledWith(1, 1, 6, { status: "rest", title: null, notes: null }));
    expect(await within(dialog).findByTestId("rest-note")).toBeTruthy();
    expect(within(dialog).queryByLabelText("Muscle group to add")).toBeNull();      // workout controls hidden
  });

  it("turning a workout day into rest asks first and only then clears the workout", async () => {
    planner.getDay.mockResolvedValue(chestDay());
    planner.putDay.mockResolvedValue(makeDay({ status: "rest", kind: "rest" }));
    const { user, dialog } = await openEditor(0);
    await user.click(await within(dialog).findByRole("button", { name: "Rest day" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Make this a rest day?" });
    expect(confirm.textContent).toMatch(/removes the planned/);
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(planner.putDay).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Rest day" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Make rest day" }));
    await waitFor(() => expect(planner.putDay).toHaveBeenCalledWith(1, 1, 0, { status: "rest", title: null, notes: null, clear_workout: true }));
  });

  it("a rest day can be switched back to a workout day", async () => {
    planner.getDay.mockResolvedValue(makeDay({ status: "rest", kind: "rest" }));
    planner.putDay.mockResolvedValue(makeDay({ status: "unplanned", kind: "empty" }));
    const { user, dialog } = await openEditor(6);
    await user.click(await within(dialog).findByRole("button", { name: "Workout day" }));
    await waitFor(() => expect(planner.putDay).toHaveBeenCalledWith(1, 1, 6, { status: "planned", title: null, notes: null }));
  });

  it("adds a cardio-only workout", async () => {
    planner.getDay.mockResolvedValue(makeDay({ day_of_week: 5 }));
    planner.addCardio.mockResolvedValue(cardioDay());
    const { user, dialog } = await openEditor(5);
    await user.click(await within(dialog).findByRole("button", { name: /Add cardio/ }));
    const form = within(await screen.findByRole("form", { name: "Add cardio" }));
    await user.click(form.getByRole("button", { name: "Add cardio" }));                 // nothing chosen yet
    expect(await form.findByText("Choose a cardio activity.")).toBeTruthy();
    expect(planner.addCardio).not.toHaveBeenCalled();
    await user.selectOptions(form.getByLabelText("Activity"), "Running");
    const mins = form.getByLabelText("Duration (minutes)");
    await user.clear(mins); await user.type(mins, "0");
    await user.click(form.getByRole("button", { name: "Add cardio" }));
    expect(await form.findByText(/1 to 600/)).toBeTruthy();
    await user.clear(mins); await user.type(mins, "40");
    await user.type(form.getByLabelText("Distance (km)"), "5");
    await user.click(form.getByRole("button", { name: "Add cardio" }));
    await waitFor(() => expect(planner.addCardio).toHaveBeenCalledWith(1, 1, 5, { cardio_activity_id: 2, duration_minutes: 40, distance_km: 5, notes: null }));
    expect(await within(dialog).findByText(/40 min · 5 km/)).toBeTruthy();
  });

  it("edits and removes planned cardio", async () => {
    planner.getDay.mockResolvedValue(cardioDay());
    planner.updateCardio.mockResolvedValue(cardioDay());
    planner.removeCardio.mockResolvedValue(makeDay({ day_of_week: 5 }));
    const { user, dialog } = await openEditor(5);
    await user.click(await within(dialog).findByRole("button", { name: "Edit Running cardio" }));
    const form = within(await screen.findByRole("form", { name: "Edit cardio" }));
    expect((form.getByLabelText("Duration (minutes)") as HTMLInputElement).value).toBe("40");
    const mins = form.getByLabelText("Duration (minutes)");
    await user.clear(mins); await user.type(mins, "45");
    await user.click(form.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(planner.updateCardio).toHaveBeenCalledWith(31, expect.objectContaining({ cardio_activity_id: 2, duration_minutes: 45, distance_km: 5 })));
    await user.click(await within(dialog).findByRole("button", { name: "Remove Running cardio" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(planner.removeCardio).toHaveBeenCalledWith(31));
  });

  it("cardio and strength can share a day (mixed)", async () => {
    planner.getDay.mockResolvedValue(chestDay({ kind: "mixed", cardio_count: 1, cardio: cardioDay().cardio }));
    const { dialog } = await openEditor(0);
    expect(await within(dialog).findByRole("article", { name: "Chest exercises" })).toBeTruthy();
    expect(within(dialog).getByText("Running")).toBeTruthy();
  });
});

describe("day editor: states", () => {
  it("shows a loading state, then an error with retry", async () => {
    const user = userEvent.setup();
    planner.getDay.mockRejectedValueOnce(new ApiError({ kind: "server", message: "Something went wrong on the server." }));
    renderPlanner();
    await screen.findByTestId("day-0");
    await user.click(dayRow(0).getByRole("button", { name: /Plan day|Edit day/ }));
    expect(await screen.findByText("Couldn't load this day")).toBeTruthy();
    planner.getDay.mockResolvedValue(chestDay());
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("article", { name: "Chest exercises" })).toBeTruthy();
  });

  it("is read-only for a completed cycle: no controls, a notice instead", async () => {
    cycles.list.mockResolvedValue([DONE]);
    planner.getDay.mockResolvedValue(chestDay());
    const { dialog } = await openEditor(0, /View/);
    expect(await within(dialog).findByTestId("read-only")).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: /Add exercise to/ })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: /Move .* up/ })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Rest day" })).toBeNull();
    expect(within(dialog).queryByLabelText("Muscle group to add")).toBeNull();
    expect(within(dialog).getByText("Barbell Bench Press")).toBeTruthy();   // still readable
  });

  it("Escape closes only the confirm dialog on top, not the editor beneath", async () => {
    planner.getDay.mockResolvedValue(chestDay());
    const { user, dialog } = await openEditor(0);
    await user.click(await within(dialog).findByRole("button", { name: "Remove Cable Fly" }));
    await screen.findByRole("alertdialog");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("dialog", { name: /week 1/ })).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("copy and clear", () => {
  it("copies a day to another day (defaults to the next day)", async () => {
    planner.getDay.mockResolvedValue(chestDay());
    planner.copyDay.mockResolvedValue(makeDay({ day_of_week: 1, week_number: 1 }));
    const { user, dialog } = await openEditor(0);
    await user.click(await within(dialog).findByRole("button", { name: /Copy day/ }));
    const copy = within(await screen.findByRole("dialog", { name: "Copy day" }));
    expect((copy.getByLabelText("Day") as HTMLSelectElement).value).toBe("1");
    expect((copy.getByLabelText("Week") as HTMLSelectElement).value).toBe("1");
    expect(Array.from((copy.getByLabelText("Week") as HTMLSelectElement).options)).toHaveLength(8);
    await user.selectOptions(copy.getByLabelText("Week"), "Week 3");
    await user.selectOptions(copy.getByLabelText("Day"), "Thursday");
    await user.click(copy.getByRole("button", { name: "Copy day" }));
    await waitFor(() => expect(planner.copyDay).toHaveBeenCalledWith(1, 1, 0, 3, 3, false));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Copy day" })).toBeNull());
  });

  it("copying onto a planned day explains and offers Replace", async () => {
    planner.getDay.mockResolvedValue(chestDay());
    planner.copyDay.mockRejectedValueOnce(new ApiError({ kind: "client", status: 409, code: "target_not_empty", message: "Tuesday of week 1 already has a plan. Replace it?" }));
    planner.copyDay.mockResolvedValueOnce(makeDay({ day_of_week: 1 }));
    const { user, dialog } = await openEditor(0);
    await user.click(await within(dialog).findByRole("button", { name: /Copy day/ }));
    const copy = within(await screen.findByRole("dialog", { name: "Copy day" }));
    await user.click(copy.getByRole("button", { name: "Copy day" }));
    expect((await copy.findByRole("alert")).textContent).toMatch(/already has a plan/);
    await user.click(copy.getByRole("button", { name: "Replace it" }));
    await waitFor(() => expect(planner.copyDay).toHaveBeenLastCalledWith(1, 1, 0, 1, 1, true));
  });

  it("can't copy a day onto itself", async () => {
    planner.getDay.mockResolvedValue(chestDay());
    const { user, dialog } = await openEditor(0);
    await user.click(await within(dialog).findByRole("button", { name: /Copy day/ }));
    const copy = within(await screen.findByRole("dialog", { name: "Copy day" }));
    await user.selectOptions(copy.getByLabelText("Day"), "Monday");
    expect(copy.getByText(/Choose a different day/)).toBeTruthy();
    expect((copy.getByRole("button", { name: "Copy day" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("clears a day after confirmation", async () => {
    planner.getDay.mockResolvedValue(chestDay());
    planner.clearDay.mockResolvedValue(undefined);
    const { user, dialog } = await openEditor(0);
    await user.click(await within(dialog).findByRole("button", { name: /Clear day/ }));
    const confirm = await screen.findByRole("alertdialog", { name: "Clear this day?" });
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(planner.clearDay).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: /Clear day/ }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Clear day" }));
    await waitFor(() => expect(planner.clearDay).toHaveBeenCalledWith(1, 1, 0));
  });

  it("copies a week to several weeks at once", async () => {
    planner.copyWeek.mockResolvedValue({ copied_days: 8, target_week_numbers: [2, 4] });
    const user = userEvent.setup();
    renderPlanner();
    await screen.findByTestId("day-0");
    await user.click(screen.getByRole("button", { name: /copy week/i }));
    const copy = within(await screen.findByRole("dialog", { name: "Copy week" }));
    expect(copy.queryByRole("checkbox", { name: "Week 1" })).toBeNull();                // not onto itself
    expect((copy.getByRole("button", { name: "Copy week" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(copy.getByRole("checkbox", { name: "Week 2" }));
    await user.click(copy.getByRole("checkbox", { name: "Week 4" }));
    await user.click(copy.getByRole("button", { name: "Copy to 2 weeks" }));
    await waitFor(() => expect(planner.copyWeek).toHaveBeenCalledWith(1, 1, [2, 4], false));
    expect((await screen.findByRole("status")).textContent).toMatch(/Week 1 copied to weeks 2, 4/);
  });

  it("copy week: 'select all' and the overwrite confirmation", async () => {
    planner.copyWeek.mockRejectedValueOnce(new ApiError({ kind: "client", status: 409, code: "target_not_empty", message: "Week(s) 3 already have a plan. Replace it?" }));
    planner.copyWeek.mockResolvedValueOnce({ copied_days: 28, target_week_numbers: [2, 3, 4, 5, 6, 7, 8] });
    const user = userEvent.setup();
    renderPlanner();
    await screen.findByTestId("day-0");
    await user.click(screen.getByRole("button", { name: /copy week/i }));
    const copy = within(await screen.findByRole("dialog", { name: "Copy week" }));
    await user.click(copy.getByRole("button", { name: "Select all other weeks" }));
    await user.click(copy.getByRole("button", { name: "Copy to 7 weeks" }));
    expect((await copy.findByRole("alert")).textContent).toMatch(/already have a plan/);
    await user.click(copy.getByRole("button", { name: "Replace them" }));
    await waitFor(() => expect(planner.copyWeek).toHaveBeenLastCalledWith(1, 1, [2, 3, 4, 5, 6, 7, 8], true));
  });

  it("clears a week only after confirmation", async () => {
    planner.clearWeek.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPlanner();
    await screen.findByTestId("day-0");
    await user.click(screen.getByRole("button", { name: /clear week/i }));
    const confirm = await screen.findByRole("alertdialog", { name: "Clear week 1?" });
    expect(confirm.textContent).toMatch(/all seven days/);
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(planner.clearWeek).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /clear week/i }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Clear week" }));
    await waitFor(() => expect(planner.clearWeek).toHaveBeenCalledWith(1, 1));
    expect((await screen.findByRole("status")).textContent).toMatch(/Week 1 cleared/);
  });

  it("copy/clear week are disabled while the week is empty", async () => {
    planner.getWeek.mockResolvedValue(makeWeek(1));
    renderPlanner();
    await screen.findByTestId("day-0");
    expect((screen.getByRole("button", { name: /copy week/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /clear week/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});


describe("starting a workout from a planned day", () => {
  const logged = (status: "in_progress" | "completed") => ({ items: [{ id: 8, workout_date: "2026-11-16", status, source: "plan", title: "Chest", cycle_name: "Winter Block", started_at: "x", ended_at: null,
    duration_seconds: 0, exercise_count: 2, completed_exercise_count: 0, completed_sets: 0, cardio_minutes: 0, exercise_names: [] }], total: 1, page: 1, page_size: 10 }) as never;

  it("offers Start workout on a planned day and never touches the plan", async () => {
    planner.getDay.mockResolvedValue(chestDay());
    vi.mocked(workoutService.start).mockResolvedValue({ id: 51 } as never);
    const { user, dialog } = await openEditor(0);
    await user.click(await within(dialog).findByRole("button", { name: /Start workout/ }));
    expect(workoutService.start).toHaveBeenCalledWith({ source: "plan", cycle_id: 1, week_number: 1, day_of_week: 0 });
    for (const write of [planner.putDay, planner.clearDay, planner.addExercise, planner.updateExercise, planner.removeExercise, planner.addCardio, planner.copyDay]) {
      expect(write).not.toHaveBeenCalled();
    }
  });

  it("offers Resume (not Start) when that day already has an unfinished workout", async () => {
    planner.getDay.mockResolvedValue(chestDay());
    vi.mocked(workoutService.list).mockResolvedValue(logged("in_progress"));
    const { dialog } = await openEditor(0);
    const link = await within(dialog).findByRole("link", { name: /Resume workout/ });
    expect(link.getAttribute("href")).toBe("/workout/8");
    expect(within(dialog).queryByRole("button", { name: /Start workout/ })).toBeNull();
  });

  it("shows a completed day as logged instead of offering a duplicate", async () => {
    planner.getDay.mockResolvedValue(chestDay());
    vi.mocked(workoutService.list).mockResolvedValue(logged("completed"));
    const { dialog } = await openEditor(0);
    expect(await within(dialog).findByText("Workout logged")).toBeTruthy();
    expect(within(dialog).getByRole("link", { name: "View workout" }).getAttribute("href")).toBe("/workout/8");
    expect(within(dialog).queryByRole("button", { name: /Start workout/ })).toBeNull();
  });

  it("offers nothing on an empty day", async () => {
    planner.getDay.mockResolvedValue(makeDay());
    const { dialog } = await openEditor(0);
    await within(dialog).findByLabelText("Day title", { exact: false });
    expect(within(dialog).queryByRole("button", { name: /Start workout/ })).toBeNull();
  });

  it("offers nothing on a rest day", async () => {
    planner.getDay.mockResolvedValue(makeDay({ status: "rest", kind: "rest", schedule_id: 3 }));
    const { dialog } = await openEditor(0);
    await within(dialog).findByTestId("rest-note");
    expect(within(dialog).queryByRole("button", { name: /Start workout/ })).toBeNull();
  });
});
