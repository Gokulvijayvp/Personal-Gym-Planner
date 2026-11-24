// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CataloguePicker from "./CataloguePicker";
import ExerciseFormModal from "./ExerciseFormModal";
import { MUSCLE_GROUPS, WORKOUT_TYPES, makeExercise } from "./testData";
import { ToastProvider } from "../../components/ui/Toast";
import { ApiError } from "../../services/apiError";
import { catalogueService } from "../../services/catalogueService";
import type { Catalogue, CatalogueItem } from "../../types/catalogue";

vi.mock("../../services/catalogueService", () => ({ catalogueService: { list: vi.fn(), add: vi.fn() } }));
vi.mock("../../services/exerciseMasterService", () => ({ exerciseMasterService: { list: vi.fn().mockResolvedValue({ items: [], motions: {} }) } }));
vi.mock("../../services/exerciseService", () => ({ exerciseService: { create: vi.fn(), update: vi.fn() }, masterDataService: {} }));
const svc = vi.mocked(catalogueService);

const item = (over: Partial<CatalogueItem>): CatalogueItem => ({
  key: "incline-dumbbell-press", name: "Incline Dumbbell Press", muscle_group: "Chest", target_area: "Upper Chest",
  equipment: "Dumbbell", icon_motion: "incline", in_library: false, exercise_id: null, ...over,
});
const CAT: Catalogue = {
  items: [
    item({}),
    item({ key: "barbell-curl", name: "Barbell Curl", muscle_group: "Biceps", target_area: "Biceps", equipment: "Barbell", icon_motion: "curl" }),
    item({ key: "lat-pulldown", name: "Lat Pulldown", muscle_group: "Back", target_area: "Lats", equipment: "Cable", icon_motion: "pullup", in_library: true, exercise_id: 9 }),
  ],
  muscle_groups: ["Chest", "Back", "Biceps"], motions: {},
};

function open(props: Partial<React.ComponentProps<typeof CataloguePicker>> = {}) {
  const onClose = vi.fn(), onCreateCustom = vi.fn();
  render(<ToastProvider><CataloguePicker onClose={onClose} onCreateCustom={onCreateCustom} {...props} /></ToastProvider>);
  return { onClose, onCreateCustom };
}
const card = (key: string) => screen.findByTestId(`cat-${key}`);

beforeEach(() => { window.scrollTo = vi.fn() as never; svc.list.mockResolvedValue(CAT); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("catalogue picker", () => {
  it("shows each exercise with its icon, muscle, area and equipment", async () => {
    open();
    const c = await card("incline-dumbbell-press");
    expect(within(c).getByText("Incline Dumbbell Press")).toBeTruthy();
    expect(within(c).getByText("Chest · Upper Chest")).toBeTruthy();
    expect(within(c).getByText("Dumbbell")).toBeTruthy();
    expect(c.querySelector("svg")?.getAttribute("data-motion")).toBe("incline");
    expect(within(c).getByRole("button", { name: "Add Incline Dumbbell Press" })).toBeTruthy();
  });

  it("marks exercises already in the library and offers no Add for them", async () => {
    open();
    const c = await card("lat-pulldown");
    expect(within(c).getByText("In library")).toBeTruthy();
    expect(within(c).queryByRole("button", { name: /^Add / })).toBeNull();
  });

  it("searches by name, muscle or equipment", async () => {
    open();
    await card("barbell-curl");
    await userEvent.type(screen.getByLabelText("Search exercise catalogue"), "cable");
    expect(screen.queryByTestId("cat-barbell-curl")).toBeNull();
    expect(screen.getByTestId("cat-lat-pulldown")).toBeTruthy();
    await userEvent.clear(screen.getByLabelText("Search exercise catalogue"));
    await userEvent.type(screen.getByLabelText("Search exercise catalogue"), "zzzz");
    expect(screen.getByText("No exercise matches")).toBeTruthy();
  });

  it("filters by muscle group and combines with search", async () => {
    open();
    await card("barbell-curl");
    await userEvent.click(screen.getByRole("button", { name: "Biceps" }));
    expect(screen.getByRole("button", { name: "Biceps" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getAllByRole("listitem").map((l) => l.getAttribute("data-testid"))).toEqual(["cat-barbell-curl"]);
    await userEvent.type(screen.getByLabelText("Search exercise catalogue"), "press");
    expect(screen.getByText("No exercise matches")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "All" }));
    await userEvent.clear(screen.getByLabelText("Search exercise catalogue"));
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("adds an exercise with one tap and shows it as in the library", async () => {
    svc.add.mockResolvedValue(makeExercise({ id: 5, name: "Barbell Curl" }));
    const { onClose } = open();
    const c = await card("barbell-curl");
    await userEvent.click(within(c).getByRole("button", { name: "Add Barbell Curl" }));
    await waitFor(() => expect(within(c).getByText("In library")).toBeTruthy());
    expect(svc.add).toHaveBeenCalledTimes(1);
    expect(svc.add).toHaveBeenCalledWith("barbell-curl");
    expect(screen.getByText(/"Barbell Curl" was added to your library/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it("treats a duplicate as already added (nothing is duplicated)", async () => {
    svc.add.mockRejectedValue(new ApiError({ kind: "client", status: 409, code: "already_in_library", message: "already there" }));
    open();
    const c = await card("barbell-curl");
    await userEvent.click(within(c).getByRole("button", { name: "Add Barbell Curl" }));
    await waitFor(() => expect(within(c).getByText("In library")).toBeTruthy());
    expect(screen.getByText(/already in your library/)).toBeTruthy();
  });

  it("shows other failures on the card and keeps the Add button", async () => {
    svc.add.mockRejectedValue(new ApiError({ kind: "network", message: "Can't reach the server." }));
    open();
    const c = await card("barbell-curl");
    await userEvent.click(within(c).getByRole("button", { name: "Add Barbell Curl" }));
    expect((await within(c).findByRole("alert")).textContent).toMatch(/reach the server/);
    expect(within(c).getByRole("button", { name: "Add Barbell Curl" })).toBeTruthy();
  });

  it("closes without refreshing when nothing was added, and offers a manual route", async () => {
    const { onClose, onCreateCustom } = open();
    await card("barbell-curl");
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalledWith(false);
    await userEvent.click(screen.getByRole("button", { name: /create your own/i }));
    expect(onCreateCustom).toHaveBeenCalledWith(false);
  });

  it("shows an error with retry when the catalogue cannot load", async () => {
    svc.list.mockRejectedValueOnce(new ApiError({ kind: "network", message: "Can't reach the server." }));
    open();
    expect(await screen.findByText("Couldn't load the exercise catalogue")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await card("barbell-curl")).toBeTruthy();
  });
});

describe("manual exercise form is simple", () => {
  const renderForm = (exercise?: ReturnType<typeof makeExercise>) => render(
    <ExerciseFormModal exercise={exercise} muscleGroups={MUSCLE_GROUPS} workoutTypes={WORKOUT_TYPES} onClose={vi.fn()} onSaved={vi.fn()} />);
  const more = () => document.querySelector("details.ex-more") as HTMLDetailsElement;

  it("asks only for name and muscle group; the rest is folded under More details", () => {
    renderForm();
    expect(screen.getByLabelText(/Exercise name/)).toBeTruthy();
    expect(screen.getByLabelText(/Primary muscle group/)).toBeTruthy();
    expect(more().open).toBe(false);
    expect(more().textContent).toMatch(/Target muscle area/);
    expect(more().contains(screen.getByLabelText(/Primary muscle group/))).toBe(false);
  });

  it("is open when editing an existing exercise", () => {
    renderForm(makeExercise());
    expect(more().open).toBe(true);
  });

  it("opens More details when an optional field is invalid", async () => {
    renderForm();
    await userEvent.type(screen.getByLabelText(/Exercise name/), "Cable Row");
    await userEvent.selectOptions(screen.getByLabelText(/Primary muscle group/), "2");
    await userEvent.type(more().querySelector("input[type=url]") as HTMLInputElement, "not a url");
    await userEvent.click(screen.getByRole("button", { name: "Add exercise" }));
    await waitFor(() => expect(more().open).toBe(true));
  });
});
