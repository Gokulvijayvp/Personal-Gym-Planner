// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import ExercisesPage from "./ExercisesPage";
import { ToastProvider } from "../components/ui/Toast";
import { catalogueService } from "../services/catalogueService";
import { exerciseMasterService } from "../services/exerciseMasterService";
import { exerciseService, masterDataService } from "../services/exerciseService";
import type { Catalogue, CatalogueItem } from "../types/catalogue";
import { MUSCLE_GROUPS, WORKOUT_TYPES, makeExercise, makeList } from "../features/exercises/testData";

vi.mock("../services/catalogueService", () => ({ catalogueService: { list: vi.fn(), add: vi.fn() } }));
vi.mock("../services/exerciseMasterService", () => ({ exerciseMasterService: { list: vi.fn().mockResolvedValue({ items: [], motions: {} }) } }));
vi.mock("../services/exerciseService", () => ({
  exerciseService: { list: vi.fn(), create: vi.fn(), update: vi.fn(), setActive: vi.fn(), remove: vi.fn(), get: vi.fn() },
  masterDataService: { muscleGroups: vi.fn(), workoutTypes: vi.fn() },
}));
const cat = vi.mocked(catalogueService);

const item = (key: string, name: string, muscle_group: string, target_area: string | null, equipment: string, icon_motion = "press", in_library = false): CatalogueItem =>
  ({ key, name, muscle_group, target_area, equipment, icon_motion, in_library, exercise_id: in_library ? 1 : null });
const CAT: Catalogue = {
  items: [
    item("incline-dumbbell-press", "Incline Dumbbell Press", "Chest", "Upper Chest", "Dumbbell", "incline"),
    item("incline-barbell-bench-press", "Incline Barbell Bench Press", "Chest", "Upper Chest", "Barbell", "incline"),
    item("cable-crossover", "Cable Crossover", "Chest", "Lower Chest", "Cable", "fly"),
    item("lat-pulldown", "Lat Pulldown", "Back", "Lats", "Cable", "pullup", true),
    item("barbell-curl", "Barbell Curl", "Biceps", "Biceps", "Barbell", "curl"),
  ],
  muscle_groups: ["Chest", "Back", "Biceps"], motions: { incline: "Incline press", fly: "Fly / crossover" },
};

function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname + l.search}</div>; }
function open(url = "/exercises") {
  return render(<MemoryRouter initialEntries={[url]}><ToastProvider><ExercisesPage /><Where /></ToastProvider></MemoryRouter>);
}
const names = () => screen.getAllByRole("listitem").map((l) => l.querySelector("b")?.textContent);

beforeEach(() => {
  window.scrollTo = vi.fn() as never;
  cat.list.mockResolvedValue(CAT);
  vi.mocked(masterDataService.muscleGroups).mockResolvedValue(MUSCLE_GROUPS);
  vi.mocked(masterDataService.workoutTypes).mockResolvedValue(WORKOUT_TYPES);
  vi.mocked(exerciseService.list).mockResolvedValue(makeList([makeExercise()]));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Exercises tab", () => {
  it("guides Muscle group -> Target area -> Equipment -> exercise cards", async () => {
    open();
    await screen.findByTestId("cat-barbell-curl");
    expect(screen.queryByRole("group", { name: "Target area" })).toBeNull();           // narrower filters appear as you go
    await userEvent.click(within(screen.getByRole("group", { name: "Muscle group" })).getByRole("button", { name: "Chest" }));
    expect(names()).toEqual(["Incline Dumbbell Press", "Incline Barbell Bench Press", "Cable Crossover"]);
    await userEvent.click(within(screen.getByRole("group", { name: "Target area" })).getByRole("button", { name: "Upper Chest" }));
    expect(names()).toEqual(["Incline Dumbbell Press", "Incline Barbell Bench Press"]);
    await userEvent.click(within(screen.getByRole("group", { name: "Equipment" })).getByRole("button", { name: "Dumbbell" }));
    expect(names()).toEqual(["Incline Dumbbell Press"]);
    const card = screen.getByTestId("cat-incline-dumbbell-press");
    expect(within(card).getByText("Chest · Upper Chest")).toBeTruthy();
    expect(within(card).getByText("Dumbbell")).toBeTruthy();
  });

  it("choosing a broader filter resets the narrower ones", async () => {
    open();
    await screen.findByTestId("cat-barbell-curl");
    await userEvent.click(within(screen.getByRole("group", { name: "Muscle group" })).getByRole("button", { name: "Chest" }));
    await userEvent.click(within(screen.getByRole("group", { name: "Target area" })).getByRole("button", { name: "Lower Chest" }));
    expect(names()).toEqual(["Cable Crossover"]);
    await userEvent.click(within(screen.getByRole("group", { name: "Muscle group" })).getByRole("button", { name: "Back" }));
    expect(names()).toEqual(["Lat Pulldown"]);
    expect(screen.queryByRole("group", { name: "Target area" })).toBeNull();
  });

  it("filters by equipment on its own, and combines with search", async () => {
    open();
    await screen.findByTestId("cat-barbell-curl");
    await userEvent.click(within(screen.getByRole("group", { name: "Equipment" })).getByRole("button", { name: "Barbell" }));
    expect(names()).toEqual(["Incline Barbell Bench Press", "Barbell Curl"]);
    await userEvent.type(screen.getByLabelText("Search exercise catalogue"), "curl");
    expect(names()).toEqual(["Barbell Curl"]);
  });

  it("tapping a card shows its details, with no Add button", async () => {
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Details of Cable Crossover" }));
    const dialog = await screen.findByRole("dialog", { name: "Cable Crossover" });
    expect(within(dialog).getByText("Lower Chest")).toBeTruthy();
    expect(within(dialog).getByText("Fly / crossover")).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: /^Add / })).toBeNull();
  });

  it("has no My library tab and no Add buttons", async () => {
    open();
    await screen.findByTestId("cat-barbell-curl");
    expect(screen.queryByRole("tab", { name: "My library" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Add / })).toBeNull();
    expect(screen.queryByText("In library")).toBeNull();
  });

  it("explains an empty result and offers a way out", async () => {
    open();
    await screen.findByTestId("cat-barbell-curl");
    await userEvent.type(screen.getByLabelText("Search exercise catalogue"), "zzzz");
    expect(screen.getByText("No exercise matches")).toBeTruthy();
  });
});

void exerciseMasterService;
