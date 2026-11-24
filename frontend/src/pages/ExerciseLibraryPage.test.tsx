// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ExerciseLibraryPage from "./ExerciseLibraryPage";
import { ToastProvider } from "../components/ui/Toast";
import { ApiError } from "../services/apiError";
import { exerciseService, masterDataService } from "../services/exerciseService";
import { catalogueService } from "../services/catalogueService";
import {
  MUSCLE_GROUPS, WORKOUT_TYPES, makeExercise, makeList,
} from "../features/exercises/testData";

vi.mock("../services/exerciseService", () => ({
  exerciseService: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), setActive: vi.fn(), remove: vi.fn() },
  masterDataService: { muscleGroups: vi.fn(), workoutTypes: vi.fn() },
}));

vi.mock("../services/catalogueService", () => ({ catalogueService: { list: vi.fn(), add: vi.fn() } }));
vi.mock("../services/exerciseMasterService", () => ({ exerciseMasterService: { list: vi.fn().mockResolvedValue({ items: [], motions: {} }) } }));

const svc = vi.mocked(exerciseService);
const master = vi.mocked(masterDataService);

const BENCH = makeExercise();
const FLY = makeExercise({ id: 2, name: "Cable Fly", target_area: { id: 4, name: "Inner Chest", muscle_group_id: 1 },
  workout_type: { id: 4, name: "Cable" }, secondary_muscle_groups: [], is_active: false });

function renderPage(url = "/exercises") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ToastProvider><ExerciseLibraryPage /></ToastProvider>
    </MemoryRouter>,
  );
}

const lastQuery = () => svc.list.mock.calls[svc.list.mock.calls.length - 1][0];

beforeEach(() => {
  window.scrollTo = vi.fn();
  master.muscleGroups.mockResolvedValue(MUSCLE_GROUPS);
  master.workoutTypes.mockResolvedValue(WORKOUT_TYPES);
  svc.list.mockResolvedValue(makeList([BENCH, FLY]));
  vi.mocked(catalogueService.list).mockResolvedValue({ items: [], muscle_groups: [], motions: {} });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("loading the page", () => {
  it("shows header, count, filters and exercise cards", async () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Exercise Library" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /add exercise/i })).toBeTruthy();
    const card = await screen.findByRole("article", { name: "Barbell Bench Press" });
    expect(within(card).getByText("Chest")).toBeTruthy();
    expect(within(card).getByText("Middle Chest")).toBeTruthy();
    expect(within(card).getByText("Barbell")).toBeTruthy();
    expect(within(card).getByText("Active")).toBeTruthy();
    expect(within(card).getByText(/Also works: Triceps/)).toBeTruthy();
    expect(within(screen.getByRole("article", { name: "Cable Fly" })).getByText("Inactive")).toBeTruthy();
    expect(screen.getByTestId("total-count").textContent).toBe("2 exercises");
    for (const name of [/search exercises/i, "Muscle group", "Target area", "Workout type", "Status"]) {
      expect(screen.getByLabelText(name)).toBeTruthy();
    }
    expect(lastQuery()).toMatchObject({ sort: "name", order: "asc", page: 1, page_size: 12 });
  });

  it("shows loading skeletons while fetching", async () => {
    let resolve!: (v: ReturnType<typeof makeList>) => void;
    svc.list.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderPage();
    expect((await screen.findAllByTestId("exercise-skeleton")).length).toBeGreaterThan(0);
    expect(screen.getByRole("status", { name: /loading exercises/i })).toBeTruthy();
    resolve(makeList([BENCH]));
    await screen.findByRole("article", { name: "Barbell Bench Press" });
    expect(screen.queryAllByTestId("exercise-skeleton")).toHaveLength(0);
  });

  it("singular count label", async () => {
    svc.list.mockResolvedValue(makeList([BENCH]));
    renderPage();
    await waitFor(() => expect(screen.getByTestId("total-count").textContent).toBe("1 exercise"));
  });
});

describe("empty and error states", () => {
  it("empty library -> empty state with an Add button that opens the form", async () => {
    svc.list.mockResolvedValue(makeList([]));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("No exercises yet");
    await user.click(screen.getByRole("button", { name: /add your first exercise/i }));
    expect(await screen.findByRole("dialog", { name: "Add exercise" })).toBeTruthy();
  });

  it("no search results -> search empty state, Clear filters restores the list", async () => {
    const user = userEvent.setup();
    svc.list.mockImplementation(async (q) =>
      q.search === "zzz" ? makeList([], { total_all: 2 }) : makeList([BENCH, FLY]));
    renderPage();
    await screen.findByRole("article", { name: "Barbell Bench Press" });
    await user.type(screen.getByLabelText(/search exercises/i), "zzz");
    await screen.findByText("No matching exercises");
    expect(screen.getByText(/Nothing matches “zzz”/)).toBeTruthy();
    expect(screen.getByTestId("total-count").textContent).toBe("2 exercises"); // header count ignores filters
    // Two "Clear filters" buttons exist on purpose: one in the filter bar, one inside the empty state.
    expect(screen.getAllByRole("button", { name: "Clear filters" })).toHaveLength(2);
    await user.click(within(screen.getByText("No matching exercises").closest("section")!)
      .getByRole("button", { name: "Clear filters" }));
    await screen.findByRole("article", { name: "Barbell Bench Press" });
    expect((screen.getByLabelText(/search exercises/i) as HTMLInputElement).value).toBe("");
  });

  it("API failure -> error state, Try again reloads", async () => {
    const user = userEvent.setup();
    svc.list.mockRejectedValueOnce(new ApiError({ kind: "server", status: 500, message: "Something went wrong on the server. Please try again." }));
    renderPage();
    await screen.findByText("Couldn't load exercises");
    expect(screen.getByText(/Something went wrong on the server/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("article", { name: "Barbell Bench Press" });
    expect(svc.list).toHaveBeenCalledTimes(2);
  });

  it("network failure shows the friendly message", async () => {
    svc.list.mockRejectedValueOnce(new ApiError({ kind: "network", message: "Can't reach the server." }));
    renderPage();
    await screen.findByText("Can't reach the server.");
  });

  it("master data failure -> error with retry; Add is disabled", async () => {
    const user = userEvent.setup();
    master.muscleGroups.mockRejectedValueOnce(new ApiError({ kind: "network", message: "Can't reach the server." }));
    renderPage();
    await screen.findByText(/Couldn't load muscle groups and workout types/);
    expect((screen.getByRole("button", { name: /add exercise/i }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByLabelText("Muscle group");
  });
});

describe("search and filters", () => {
  it("search is debounced and sent as `search`", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Barbell Bench Press" });
    const before = svc.list.mock.calls.length;
    await user.type(screen.getByLabelText(/search exercises/i), "bench");
    expect(svc.list.mock.calls.length).toBe(before); // not one request per keystroke
    await waitFor(() => expect(lastQuery().search).toBe("bench"));
    expect(svc.list.mock.calls.length).toBe(before + 1);
  });

  it("muscle group filter", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Barbell Bench Press" });
    await user.selectOptions(screen.getByLabelText("Muscle group"), "Back");
    await waitFor(() => expect(lastQuery().muscle_group_id).toBe(2));
  });

  it("workout type filter", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Barbell Bench Press" });
    await user.selectOptions(screen.getByLabelText("Workout type"), "Cable");
    await waitFor(() => expect(lastQuery().workout_type_id).toBe(4));
  });

  it("status filter: active / inactive / all", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Barbell Bench Press" });
    await user.selectOptions(screen.getByLabelText("Status"), "Inactive");
    await waitFor(() => expect(lastQuery().is_active).toBe(false));
    await user.selectOptions(screen.getByLabelText("Status"), "Active");
    await waitFor(() => expect(lastQuery().is_active).toBe(true));
    await user.selectOptions(screen.getByLabelText("Status"), "All");
    await waitFor(() => expect(lastQuery().is_active).toBeUndefined());
  });

  it("target area filter lists only the chosen muscle group's areas (dependent dropdown)", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Barbell Bench Press" });
    const area = screen.getByLabelText("Target area") as HTMLSelectElement;
    const optionNames = () => Array.from(area.options).map((o) => o.textContent);
    expect(optionNames()).toContain("Lats");        // no muscle chosen: everything, grouped
    expect(optionNames()).toContain("Upper Chest");

    await user.selectOptions(screen.getByLabelText("Muscle group"), "Chest");
    expect(optionNames()).toEqual(["All target areas", "Upper Chest", "Middle Chest", "Lower Chest", "Inner Chest"]);
    await user.selectOptions(area, "Inner Chest");
    await waitFor(() => expect(lastQuery()).toMatchObject({ muscle_group_id: 1, target_area_id: 4 }));

    // Switching to a muscle group the area doesn't belong to clears the area filter.
    await user.selectOptions(screen.getByLabelText("Muscle group"), "Back");
    expect(optionNames()).toEqual(["All target areas", "Upper Back", "Lats"]);
    await waitFor(() => expect(lastQuery().target_area_id).toBeUndefined());
    expect(lastQuery().muscle_group_id).toBe(2);
  });

  it("filters combine, and Clear filters resets them all", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Barbell Bench Press" });
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull(); // hidden when nothing is active
    await user.selectOptions(screen.getByLabelText("Muscle group"), "Chest");
    await user.selectOptions(screen.getByLabelText("Workout type"), "Barbell");
    await user.selectOptions(screen.getByLabelText("Status"), "Active");
    await user.type(screen.getByLabelText(/search exercises/i), "press");
    await waitFor(() => expect(lastQuery()).toMatchObject({
      search: "press", muscle_group_id: 1, workout_type_id: 1, is_active: true }));
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(lastQuery().muscle_group_id).toBeUndefined());
    for (const key of ["search", "muscle_group_id", "workout_type_id", "is_active"] as const) {
      expect(lastQuery()[key], key).toBeUndefined();
    }
    expect((screen.getByLabelText("Muscle group") as HTMLSelectElement).value).toBe("");
    expect((screen.getByLabelText(/search exercises/i) as HTMLInputElement).value).toBe("");
  });

  it("filters are restored from the URL (refresh / shared link)", async () => {
    renderPage("/exercises?q=fly&muscle=1&area=4&type=4&status=inactive&sort=newest&page=2");
    await waitFor(() => expect(svc.list).toHaveBeenCalled());
    expect(lastQuery()).toMatchObject({ search: "fly", muscle_group_id: 1, target_area_id: 4, workout_type_id: 4,
      is_active: false, sort: "created_at", order: "desc", page: 2 });
    expect((await screen.findByLabelText(/search exercises/i) as HTMLInputElement).value).toBe("fly");
    expect((screen.getByLabelText("Status") as HTMLSelectElement).value).toBe("inactive");
  });

  it("sorting", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Barbell Bench Press" });
    await user.selectOptions(screen.getByLabelText("Sort by"), "Name (Z–A)");
    await waitFor(() => expect(lastQuery()).toMatchObject({ sort: "name", order: "desc" }));
  });

  it("pagination moves between pages and resets to page 1 when a filter changes", async () => {
    const user = userEvent.setup();
    svc.list.mockImplementation(async (q) => makeList([BENCH], { page: q.page, pages: 3, total: 30, total_all: 30 }));
    renderPage();
    await screen.findByText("Page 1 of 3");
    expect((screen.getByRole("button", { name: /previous/i }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: /next/i }));
    await screen.findByText("Page 2 of 3");
    expect(lastQuery().page).toBe(2);
    await user.selectOptions(screen.getByLabelText("Status"), "Active");
    await screen.findByText("Page 1 of 3");
    expect(lastQuery().page).toBe(1);
  });
});

describe("add exercise", () => {
  async function openForm() {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Barbell Bench Press" });
    await user.click(screen.getByRole("button", { name: /add exercise/i }));
    // "Add Exercise" opens the catalogue; the manual form is one click further ("Create your own").
    await user.click(await screen.findByRole("button", { name: /create your own/i }));
    const dialog = await screen.findByRole("dialog", { name: "Add exercise" });
    expect(within(dialog).getByLabelText(/Exercise name/)).toBeTruthy();
    return { user, dialog };
  }

  it("target area is disabled until a primary muscle is chosen, then lists only that group's areas", async () => {
    const { user, dialog } = await openForm();
    const area = within(dialog).getByLabelText(/Target muscle area/) as HTMLSelectElement;
    expect(area.disabled).toBe(true);
    expect(within(dialog).getByText(/Choose a primary muscle group first/)).toBeTruthy();

    await user.selectOptions(within(dialog).getByLabelText(/Primary muscle group/), "Shoulders");
    expect(area.disabled).toBe(false);
    expect(Array.from(area.options).map((o) => o.textContent)).toEqual(["Not specified", "Front Delts", "Side Delts"]);

    await user.selectOptions(area, "Side Delts");
    await user.selectOptions(within(dialog).getByLabelText(/Primary muscle group/), "Chest"); // different group
    expect(area.value).toBe(""); // stale selection cleared
    expect(Array.from(area.options).map((o) => o.textContent)).toContain("Upper Chest");
    expect(Array.from(area.options).map((o) => o.textContent)).not.toContain("Side Delts");
  });

  it("secondary muscle choices exclude the primary muscle", async () => {
    const { user, dialog } = await openForm();
    expect(within(dialog).getByRole("checkbox", { name: "Chest" })).toBeTruthy();
    await user.click(within(dialog).getByRole("checkbox", { name: "Triceps" }));
    await user.selectOptions(within(dialog).getByLabelText(/Primary muscle group/), "Triceps");
    expect(within(dialog).queryByRole("checkbox", { name: "Triceps" })).toBeNull();      // now the primary
    expect(within(dialog).getByRole("checkbox", { name: "Chest" })).toBeTruthy();
  });

  it("client-side validation blocks an incomplete form and nothing is sent", async () => {
    const { user, dialog } = await openForm();
    await user.click(within(dialog).getByRole("button", { name: "Add exercise" }));
    expect(await within(dialog).findByText("Enter an exercise name.")).toBeTruthy();
    expect(within(dialog).getByText("Choose a primary muscle group.")).toBeTruthy();
    expect(svc.create).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(within(dialog).getByLabelText(/Exercise name/)); // focus moves to first error
    await user.type(within(dialog).getByLabelText(/Image URL/), "not a url");
    await user.click(within(dialog).getByRole("button", { name: "Add exercise" }));
    expect(await within(dialog).findByText(/valid web address/)).toBeTruthy();
  });

  it("creates the exercise, closes, shows a success toast and refreshes the list", async () => {
    const created = makeExercise({ id: 3, name: "Incline Dumbbell Press" });
    svc.create.mockResolvedValue(created);
    const { user, dialog } = await openForm();
    const listCalls = svc.list.mock.calls.length;

    await user.type(within(dialog).getByLabelText(/Exercise name/), "  Incline   Dumbbell Press ");
    await user.type(within(dialog).getByLabelText(/Description/), "Upper chest focus");
    await user.selectOptions(within(dialog).getByLabelText(/Primary muscle group/), "Chest");
    await user.selectOptions(within(dialog).getByLabelText(/Target muscle area/), "Upper Chest");
    await user.selectOptions(within(dialog).getByLabelText(/Workout type/), "Dumbbell");
    await user.click(within(dialog).getByRole("checkbox", { name: "Triceps" }));
    await user.type(within(dialog).getByLabelText(/Instructions/), "Press up.");
    await user.type(within(dialog).getByLabelText(/Image URL/), "https://example.com/a.png");
    await user.click(within(dialog).getByRole("switch")); // active -> inactive
    await user.click(within(dialog).getByRole("button", { name: "Add exercise" }));

    await waitFor(() => expect(svc.create).toHaveBeenCalledTimes(1));
    expect(svc.create).toHaveBeenCalledWith({
      name: "Incline Dumbbell Press", description: "Upper chest focus", muscle_group_id: 1,
      secondary_muscle_group_ids: [5], target_area_id: 1, workout_type_id: 2, instructions: "Press up.",
      media_url: "https://example.com/a.png", is_active: false,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect((await screen.findByRole("status")).textContent).toMatch(/Incline Dumbbell Press.*added/);
    await waitFor(() => expect(svc.list.mock.calls.length).toBeGreaterThan(listCalls));
  });

  it("duplicate name from the server is shown on the name field and the form stays open", async () => {
    svc.create.mockRejectedValue(new ApiError({
      kind: "client", status: 409, code: "duplicate_name", message: "An exercise named 'Cable Fly' already exists.",
      details: [{ field: "name", message: "An exercise with this name already exists." }],
    }));
    const { user, dialog } = await openForm();
    await user.type(within(dialog).getByLabelText(/Exercise name/), "cable fly");
    await user.selectOptions(within(dialog).getByLabelText(/Primary muscle group/), "Chest");
    await user.click(within(dialog).getByRole("button", { name: "Add exercise" }));
    expect(await within(dialog).findByText("An exercise with this name already exists.")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Add exercise" })).toBeTruthy();
    expect((within(dialog).getByLabelText(/Exercise name/) as HTMLInputElement).value).toBe("cable fly"); // input kept
    expect((within(dialog).getByRole("button", { name: "Add exercise" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("server/network failure shows an alert in the form and keeps the data", async () => {
    svc.create.mockRejectedValue(new ApiError({ kind: "network", message: "Can't reach the server." }));
    const { user, dialog } = await openForm();
    await user.type(within(dialog).getByLabelText(/Exercise name/), "Push Up");
    await user.selectOptions(within(dialog).getByLabelText(/Primary muscle group/), "Chest");
    await user.click(within(dialog).getByRole("button", { name: "Add exercise" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("Can't reach the server.");
    expect((within(dialog).getByLabelText(/Exercise name/) as HTMLInputElement).value).toBe("Push Up");
  });

  it("Cancel and Escape close the form without saving", async () => {
    const { user, dialog } = await openForm();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: /add exercise/i }));
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(svc.create).not.toHaveBeenCalled();
  });
});

describe("edit exercise", () => {
  it("opens pre-filled, saves changes with PUT and shows a toast", async () => {
    svc.update.mockResolvedValue({ ...BENCH, name: "Flat Bench Press" });
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Barbell Bench Press" });
    await user.click(screen.getByRole("button", { name: "Edit Barbell Bench Press" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit exercise" });

    expect((within(dialog).getByLabelText(/Exercise name/) as HTMLInputElement).value).toBe("Barbell Bench Press");
    expect((within(dialog).getByLabelText(/Primary muscle group/) as HTMLSelectElement).value).toBe("1");
    expect((within(dialog).getByLabelText(/Target muscle area/) as HTMLSelectElement).value).toBe("2");
    expect((within(dialog).getByLabelText(/Workout type/) as HTMLSelectElement).value).toBe("1");
    expect((within(dialog).getByRole("checkbox", { name: "Triceps" }) as HTMLInputElement).checked).toBe(true);
    expect((within(dialog).getByRole("switch") as HTMLInputElement).checked).toBe(true);

    const name = within(dialog).getByLabelText(/Exercise name/);
    await user.clear(name);
    await user.type(name, "Flat Bench Press");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(svc.update).toHaveBeenCalledTimes(1));
    expect(svc.update).toHaveBeenCalledWith(1, expect.objectContaining({
      name: "Flat Bench Press", muscle_group_id: 1, target_area_id: 2, workout_type_id: 1,
      secondary_muscle_group_ids: [5], is_active: true }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect((await screen.findByRole("status")).textContent).toMatch(/Flat Bench Press.*updated/);
  });
});

describe("activate / deactivate", () => {
  it("toggles status from the card", async () => {
    svc.setActive.mockResolvedValue({ ...BENCH, is_active: false });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Deactivate Barbell Bench Press" }));
    await waitFor(() => expect(svc.setActive).toHaveBeenCalledWith(1, false));
    expect((await screen.findByRole("status")).textContent).toMatch(/deactivated/);
    await user.click(screen.getByRole("button", { name: "Activate Cable Fly" }));
    await waitFor(() => expect(svc.setActive).toHaveBeenCalledWith(2, true));
  });

  it("a failed toggle shows an error toast", async () => {
    svc.setActive.mockRejectedValue(new ApiError({ kind: "server", message: "Something went wrong on the server." }));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Deactivate Barbell Bench Press" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Something went wrong/);
  });
});

describe("delete exercise", () => {
  it("asks for confirmation; Cancel deletes nothing", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Delete Barbell Bench Press" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Delete exercise?" });
    expect(within(dialog).getByText(/can't be undone/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(svc.remove).not.toHaveBeenCalled();
  });

  it("Confirm deletes, shows a toast and refreshes", async () => {
    svc.remove.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Delete Barbell Bench Press" }));
    const listCalls = svc.list.mock.calls.length;
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete exercise" }));
    await waitFor(() => expect(svc.remove).toHaveBeenCalledWith(1));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect((await screen.findByRole("status")).textContent).toMatch(/Barbell Bench Press.*deleted/);
    await waitFor(() => expect(svc.list.mock.calls.length).toBeGreaterThan(listCalls));
  });

  it("an exercise known to be in use can't be deleted: explains why and offers Deactivate instead", async () => {
    svc.list.mockResolvedValue(makeList([makeExercise({ usage_count: 3 })]));
    svc.setActive.mockResolvedValue(makeExercise({ is_active: false }));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Delete Barbell Bench Press" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Can't delete this exercise" });
    expect(within(dialog).getByText(/used in 3 planned or logged record/)).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Delete exercise" })).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Deactivate instead" }));
    await waitFor(() => expect(svc.setActive).toHaveBeenCalledWith(1, false));
    expect(svc.remove).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("when the server refuses (409 exercise_in_use) the dialog switches to the explanation", async () => {
    svc.remove.mockRejectedValue(new ApiError({
      kind: "client", status: 409, code: "exercise_in_use",
      message: "'Barbell Bench Press' is used in 2 planned or logged record(s) and can't be deleted. Deactivate it instead.",
    }));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Delete Barbell Bench Press" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete exercise" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Can't delete this exercise" });
    expect(within(dialog).getByText(/used in 2 planned or logged record/)).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Deactivate instead" })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Delete exercise" })).toBeNull();
  });

  it("a generic failure keeps the dialog open with an error", async () => {
    svc.remove.mockRejectedValue(new ApiError({ kind: "network", message: "Can't reach the server." }));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Delete Barbell Bench Press" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete exercise" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("Can't reach the server.");
    expect(within(dialog).getByRole("button", { name: "Delete exercise" })).toBeTruthy(); // can retry
  });
});
