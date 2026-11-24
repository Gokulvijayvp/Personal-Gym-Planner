// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import QuickSetupDialog from "./QuickSetupDialog";
import { applyPreset, autoPicks, effectivePicks, otherWeeks, PRESETS } from "./quickSetupLogic";
import { catalogueService } from "../../services/catalogueService";
import { masterDataService } from "../../services/exerciseService";
import { exerciseSetService } from "../../services/exerciseSetService";
import { plannerService } from "../../services/plannerService";
import type { Catalogue, CatalogueItem } from "../../types/catalogue";

vi.mock("../../services/catalogueService", () => ({ catalogueService: { list: vi.fn(), add: vi.fn() } }));
vi.mock("../../services/exerciseService", () => ({ masterDataService: { muscleGroups: vi.fn() } }));
vi.mock("../../services/exerciseSetService", () => ({ exerciseSetService: { list: vi.fn() } }));
vi.mock("../../services/plannerService", () => ({
  plannerService: {
    clearDay: vi.fn(), putDay: vi.fn(), addMuscleGroup: vi.fn(), addExercise: vi.fn(), copyWeek: vi.fn(), copyDay: vi.fn(),
  },
}));

const item = (key: string, name: string, muscle_group: string, exercise_id: number | null = null): CatalogueItem =>
  ({ key, name, muscle_group, target_area: null, equipment: "Barbell", icon_motion: "press", in_library: exercise_id !== null, exercise_id });
const ITEMS = [
  item("bench", "Bench Press", "Chest", 11), item("fly", "Fly", "Chest"), item("incline", "Incline Press", "Chest"), item("dip", "Dips", "Chest"),
  item("row", "Row", "Back", 21), item("pull", "Pull-up", "Back"),
];
const CAT: Catalogue = { items: ITEMS, muscle_groups: ["Chest", "Back"], motions: {} };
const cat = vi.mocked(catalogueService);
const planner = vi.mocked(plannerService);

beforeEach(() => {
  cat.list.mockResolvedValue(CAT);
  cat.add.mockImplementation(async (key: string) => ({ id: 100 + key.length } as never));
  vi.mocked(masterDataService.muscleGroups).mockResolvedValue([
    { id: 1, name: "Chest", sort_order: 1, target_areas: [] }, { id: 2, name: "Back", sort_order: 2, target_areas: [] },
  ]);
  vi.mocked(exerciseSetService.list).mockResolvedValue([
    { id: 9, name: "Chest B", muscle_group: "Chest", created_at: "2026-11-23T00:00:00Z", exercises: [
      { key: "fly", name: "Fly", equipment: "Barbell", icon_motion: "press" }, { key: "dip", name: "Dips", equipment: "Barbell", icon_motion: "press" }] },
  ]);
  for (const f of [planner.clearDay, planner.putDay, planner.addMuscleGroup, planner.addExercise, planner.copyWeek, planner.copyDay]) f.mockResolvedValue(undefined as never);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("quick setup logic", () => {
  it("picks the first N exercises of each chosen muscle", () => {
    expect(autoPicks(ITEMS, ["Chest", "Back"], 2)).toEqual(["bench", "fly", "row", "pull"]);
    expect(autoPicks(ITEMS, ["Chest"], 0)).toEqual([]);
  });
  it("hand-picked exercises win, and only for chosen muscles", () => {
    expect(effectivePicks({ rest: false, muscles: ["Back"], picks: ["pull", "bench"] }, ITEMS, 3)).toEqual(["pull"]);
    expect(effectivePicks({ rest: true, muscles: [] }, ITEMS, 3)).toEqual([]);
  });
  it("presets skip muscles the catalogue does not have", () => {
    const week = applyPreset(PRESETS.find((p) => p.id === "ppl")!, ["Chest", "Back"]);
    expect(week[0].muscles).toEqual(["Chest"]);
    expect(week[2].muscles).toEqual([]);
    expect(week[6].rest).toBe(true);
  });
  it("works out which other weeks get a copy", () => {
    expect(otherWeeks("this", 2, 4)).toEqual([]);
    expect(otherWeeks("following", 2, 4)).toEqual([3, 4]);
    expect(otherWeeks("all", 2, 4)).toEqual([1, 3, 4]);
  });
});

describe("QuickSetupDialog", () => {
  const open = (onApplied = vi.fn()) => {
    render(<QuickSetupDialog cycle={{ id: 7, name: "Plan", total_weeks: 4 }} week={1} day={0} onClose={vi.fn()} onApplied={onApplied} />);
    return onApplied;
  };

  it("builds a week from a ready-made split and copies it to every week", async () => {
    const onApplied = open();
    await userEvent.click(await screen.findByRole("button", { name: "One muscle a day" }));
    await userEvent.click(screen.getByLabelText("All 4 weeks"));
    await userEvent.click(screen.getByTestId("qs-apply"));
    await waitFor(() => expect(onApplied).toHaveBeenCalled());
    // Monday = Chest, Tuesday = Back, Sunday = rest (the other muscles are not in this small catalogue)
    expect(planner.putDay).toHaveBeenCalledWith(7, 1, 0, { status: "planned", title: "Chest", notes: null });
    expect(planner.putDay).toHaveBeenCalledWith(7, 1, 1, { status: "planned", title: "Back", notes: null });
    expect(planner.putDay).toHaveBeenCalledWith(7, 1, 6, { status: "rest", title: null, notes: null });
    expect(planner.addMuscleGroup).toHaveBeenCalledWith(7, 1, 0, 1);
    expect(planner.addExercise).toHaveBeenCalledTimes(3 + 2);                 // 3 chest (first 3) + 2 back
    expect(planner.addExercise).toHaveBeenCalledWith(7, 1, 0, 1, expect.objectContaining({ exercise_id: 11, target_sets: 3 }));
    expect(planner.copyWeek).toHaveBeenCalledWith(7, 1, [2, 3, 4], true);
  });

  it("sets up a single day and lets you tick your own exercises", async () => {
    const onApplied = open();
    await userEvent.click(await screen.findByRole("tab", { name: "One day" }));
    const day = screen.getByTestId("qs-day-0");
    await userEvent.click(within(day).getByRole("button", { name: "Chest" }));
    await userEvent.click(within(day).getByRole("button", { name: /Choose exercises/ }));
    await userEvent.click(within(day).getByLabelText(/Bench Press/));          // untick the first one
    await userEvent.click(screen.getByTestId("qs-apply"));
    await waitFor(() => expect(onApplied).toHaveBeenCalled());
    expect(planner.putDay).toHaveBeenCalledTimes(1);
    expect(planner.addExercise).toHaveBeenCalledTimes(2);                      // fly + incline (bench was unticked)
    expect(planner.addExercise).not.toHaveBeenCalledWith(7, 1, 0, 1, expect.objectContaining({ exercise_id: 11 }));
    expect(planner.copyWeek).not.toHaveBeenCalled();
    expect(planner.copyDay).not.toHaveBeenCalled();
  });

  it("repeats one day in every week with copy-day", async () => {
    open();
    await userEvent.click(await screen.findByRole("tab", { name: "One day" }));
    await userEvent.click(within(screen.getByTestId("qs-day-0")).getByRole("button", { name: "Back" }));
    await userEvent.click(screen.getByLabelText("All 4 weeks"));
    await userEvent.click(screen.getByTestId("qs-apply"));
    await waitFor(() => expect(planner.copyDay).toHaveBeenCalledTimes(3));
    expect(planner.copyDay).toHaveBeenCalledWith(7, 1, 0, 2, 0, true);
  });

  it("uses a saved set (My exercises) instead of the automatic picks", async () => {
    const onApplied = open();
    await userEvent.click(await screen.findByRole("tab", { name: "One day" }));
    const day = screen.getByTestId("qs-day-0");
    expect(within(day).queryByTestId("qs-set-0-9")).toBeNull();                        // sets appear once their muscle is chosen
    await userEvent.click(within(day).getByRole("button", { name: "Chest" }));
    await userEvent.click(within(day).getByTestId("qs-set-0-9"));
    await userEvent.click(screen.getByTestId("qs-apply"));
    await waitFor(() => expect(onApplied).toHaveBeenCalled());
    expect(planner.addExercise).toHaveBeenCalledTimes(2);                              // exactly the set: fly + dips
    const ids = planner.addExercise.mock.calls.map((c) => c[4].exercise_id);
    expect(ids).toEqual([100 + "fly".length, 100 + "dip".length]);
    expect(planner.addExercise).not.toHaveBeenCalledWith(7, 1, 0, 1, expect.objectContaining({ exercise_id: 11 }));
  });

  it("tapping the set again goes back to the other picks", async () => {
    open();
    await userEvent.click(await screen.findByRole("tab", { name: "One day" }));
    const day = screen.getByTestId("qs-day-0");
    await userEvent.click(within(day).getByRole("button", { name: "Chest" }));
    const chip = within(day).getByTestId("qs-set-0-9");
    await userEvent.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("false");
  });

  it("cannot apply until a day is chosen", async () => {
    open();
    await screen.findByRole("button", { name: "One muscle a day" });
    expect((screen.getByTestId("qs-apply") as HTMLButtonElement).disabled).toBe(true);
  });
});
