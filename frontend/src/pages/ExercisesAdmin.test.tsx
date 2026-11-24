// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ExercisesPage from "./ExercisesPage";
import { ToastProvider } from "../components/ui/Toast";
import { resetSession, setSession } from "../features/auth/session";
import { resetCatalogueStore } from "../features/exercises/catalogueStore";
import { MUSCLE_GROUPS, makeExercise, makeList } from "../features/exercises/testData";
import { ApiError } from "../services/apiError";
import { catalogueService } from "../services/catalogueService";
import { exerciseService, masterDataService } from "../services/exerciseService";
import type { Catalogue, CatalogueItem } from "../types/catalogue";

vi.mock("../services/catalogueService", () => ({
  catalogueService: { list: vi.fn(), add: vi.fn(), create: vi.fn(), uploadMedia: vi.fn(), deleteMedia: vi.fn() },
}));
vi.mock("../services/exerciseMasterService", () => ({ exerciseMasterService: { list: vi.fn().mockResolvedValue({ items: [], motions: {} }) } }));
vi.mock("../services/exerciseService", () => ({
  exerciseService: { list: vi.fn(), create: vi.fn(), update: vi.fn(), setActive: vi.fn(), remove: vi.fn(), get: vi.fn() },
  masterDataService: { muscleGroups: vi.fn(), workoutTypes: vi.fn() },
}));
const cat = vi.mocked(catalogueService);

const item = (key: string, name: string, muscle_group: string, target_area: string | null, equipment: string): CatalogueItem =>
  ({ key, name, muscle_group, target_area, equipment, icon_motion: "press", in_library: false, exercise_id: null });
const CAT: Catalogue = {
  items: [item("incline-dumbbell-press", "Incline Dumbbell Press", "Chest", "Upper Chest", "Dumbbell")],
  muscle_groups: ["Chest"], motions: { press: "Press" },
};
const open = () => render(<MemoryRouter><ToastProvider><ExercisesPage /></ToastProvider></MemoryRouter>);
const png = () => new File([new Uint8Array(8)], "a.png", { type: "image/png" });
const mp4 = () => new File([new Uint8Array(8)], "clip.mp4", { type: "video/mp4" });

beforeEach(() => {
  window.scrollTo = vi.fn() as never;
  URL.createObjectURL = vi.fn(() => "blob:preview") as never;
  URL.revokeObjectURL = vi.fn() as never;
  resetCatalogueStore();
  setSession({ email: "admin@example.com", role: "admin" });
  cat.list.mockResolvedValue(CAT);
  vi.mocked(masterDataService.muscleGroups).mockResolvedValue(MUSCLE_GROUPS);
  vi.mocked(exerciseService.list).mockResolvedValue(makeList([makeExercise()]));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); resetSession(); resetCatalogueStore(); });

describe("admin tools on the Exercises page", () => {
  it("shows the edit pencil and the Add exercise button to the admin", async () => {
    open();
    await screen.findByTestId("cat-incline-dumbbell-press");
    expect(screen.getByRole("button", { name: /Edit pictures and videos of Incline Dumbbell Press/ })).toBeTruthy();
    expect(screen.getByTestId("add-catalogue-exercise")).toBeTruthy();
  });

  it("hides both from a normal user", async () => {
    setSession({ email: "user@example.com", role: "user" });
    open();
    await screen.findByTestId("cat-incline-dumbbell-press");
    expect(screen.queryByRole("button", { name: /Edit pictures and videos/ })).toBeNull();
    expect(screen.queryByTestId("add-catalogue-exercise")).toBeNull();
  });

  it("hides both while the sign-in is still being checked", async () => {
    resetSession();
    open();
    await screen.findByTestId("cat-incline-dumbbell-press");
    expect(screen.queryByTestId("add-catalogue-exercise")).toBeNull();
  });
});

describe("Add exercise dialog", () => {
  async function openDialog() {
    open();
    await userEvent.click(await screen.findByTestId("add-catalogue-exercise"));
    return await screen.findByRole("dialog", { name: "Add exercise" });
  }

  it("has the pictures section on top, then lists for muscle group and target area, and free text for equipment and movement", async () => {
    const d = await openDialog();
    const order = Array.from(d.querySelectorAll("section, .field")).map((n) => n.getAttribute("aria-label") ?? n.querySelector("label")?.textContent?.replace(/[*(optional)]/g, "").trim());
    expect(order[0]).toBe("Pictures and videos");                                          // media first
    const group = within(d).getByLabelText(/Muscle group/) as HTMLSelectElement;
    expect(group.tagName).toBe("SELECT");
    expect((within(d).getByLabelText(/Target area/) as HTMLSelectElement).disabled).toBe(true);   // needs a muscle first
    expect((within(d).getByLabelText(/Equipment/) as HTMLInputElement).type).toBe("text");
    expect((within(d).getByLabelText(/Movement/) as HTMLInputElement).type).toBe("text");
  });

  it("offers only the target areas of the chosen muscle group", async () => {
    const d = await openDialog();
    await waitFor(() => expect((within(d).getByLabelText(/Muscle group/) as HTMLSelectElement).disabled).toBe(false));
    await userEvent.selectOptions(within(d).getByLabelText(/Muscle group/), "Chest");
    const area = within(d).getByLabelText(/Target area/) as HTMLSelectElement;
    expect(Array.from(area.options).map((o) => o.textContent)).toEqual(["Not specific", "Upper Chest", "Middle Chest", "Lower Chest", "Inner Chest"]);
    await userEvent.selectOptions(area, "Lower Chest");
    await userEvent.selectOptions(within(d).getByLabelText(/Muscle group/), "Back");            // changing the muscle clears the old area
    expect((within(d).getByLabelText(/Target area/) as HTMLSelectElement).value).toBe("");
  });

  it("asks for the required fields", async () => {
    const d = await openDialog();
    await userEvent.click(within(d).getByTestId("catalogue-save"));
    const alerts = (await within(d).findAllByRole("alert")).map((a) => a.textContent).join(" | ");
    expect(alerts).toMatch(/exercise name/); expect(alerts).toMatch(/muscle group/); expect(alerts).toMatch(/equipment/i);
    expect(cat.create).not.toHaveBeenCalled();
  });

  it("creates the exercise, uploads the chosen pictures and video, and shows it on the page", async () => {
    const created = { ...item("landmine-press", "Landmine Press", "Chest", "Upper Chest", "Landmine bar"), movement: "Press up and forward", custom: true };
    cat.create.mockResolvedValue(created);
    cat.uploadMedia.mockResolvedValue([{ id: 7, kind: "image", content_type: "image/png", url: "/m/7" }, { id: 8, kind: "video", content_type: "video/mp4", url: "/m/8" }]);
    cat.list.mockResolvedValueOnce(CAT).mockResolvedValue({ ...CAT, items: [...CAT.items, created] });
    const d = await openDialog();
    const files = d.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(files, [png(), mp4()]);
    expect(within(d).getAllByRole("listitem")).toHaveLength(2);                            // previews with a video badge
    expect(within(d).getByText("Video")).toBeTruthy();
    await userEvent.type(within(d).getByLabelText(/Exercise name/), "  Landmine   Press ");
    await waitFor(() => expect((within(d).getByLabelText(/Muscle group/) as HTMLSelectElement).disabled).toBe(false));
    await userEvent.selectOptions(within(d).getByLabelText(/Muscle group/), "Chest");
    await userEvent.selectOptions(within(d).getByLabelText(/Target area/), "Upper Chest");
    await userEvent.type(within(d).getByLabelText(/Equipment/), "Landmine bar");
    await userEvent.type(within(d).getByLabelText(/Movement/), "Press up and forward");
    await userEvent.click(within(d).getByTestId("catalogue-save"));
    await waitFor(() => expect(cat.create).toHaveBeenCalledWith({
      name: "Landmine   Press".replace(/\s+/g, " "), muscle_group: "Chest", target_area: "Upper Chest", equipment: "Landmine bar", movement: "Press up and forward",
    }));
    await waitFor(() => expect(cat.uploadMedia).toHaveBeenCalledWith("landmine-press", [expect.any(File), expect.any(File)]));
    expect(await screen.findByTestId("cat-landmine-press")).toBeTruthy();                  // visible right away
    expect(await screen.findByText(/"Landmine Press" was added with 2 files/)).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Add exercise" })).toBeNull();
  });

  it("works without any pictures", async () => {
    cat.create.mockResolvedValue({ ...item("sled-push", "Sled Push", "Chest", null, "Sled"), custom: true });
    const d = await openDialog();
    await userEvent.type(within(d).getByLabelText(/Exercise name/), "Sled Push");
    await waitFor(() => expect((within(d).getByLabelText(/Muscle group/) as HTMLSelectElement).disabled).toBe(false));
    await userEvent.selectOptions(within(d).getByLabelText(/Muscle group/), "Chest");
    await userEvent.type(within(d).getByLabelText(/Equipment/), "Sled");
    await userEvent.click(within(d).getByTestId("catalogue-save"));
    await waitFor(() => expect(cat.create).toHaveBeenCalledWith({ name: "Sled Push", muscle_group: "Chest", target_area: null, equipment: "Sled", movement: null }));
    expect(cat.uploadMedia).not.toHaveBeenCalled();
  });

  it("shows the server's message (for example a duplicate name) and stays open", async () => {
    cat.create.mockRejectedValue(new ApiError({ kind: "client", status: 409, message: "'Cable Row' is already in the catalogue." }));
    const d = await openDialog();
    await userEvent.type(within(d).getByLabelText(/Exercise name/), "Cable Row");
    await waitFor(() => expect((within(d).getByLabelText(/Muscle group/) as HTMLSelectElement).disabled).toBe(false));
    await userEvent.selectOptions(within(d).getByLabelText(/Muscle group/), "Back");
    await userEvent.type(within(d).getByLabelText(/Equipment/), "Cable");
    await userEvent.click(within(d).getByTestId("catalogue-save"));
    expect((await within(d).findByRole("alert")).textContent).toMatch(/already in the catalogue/);
    expect(screen.getByRole("dialog", { name: "Add exercise" })).toBeTruthy();
  });

  it("keeps the exercise and says so when only the picture upload fails", async () => {
    const sled = { ...item("sled-push", "Sled Push", "Chest", null, "Sled"), custom: true };
    cat.create.mockResolvedValue(sled);
    cat.list.mockResolvedValueOnce(CAT).mockResolvedValue({ ...CAT, items: [...CAT.items, sled] });
    cat.uploadMedia.mockRejectedValue(new ApiError({ kind: "client", status: 413, message: "'a.png' is too large." }));
    const d = await openDialog();
    await userEvent.upload(d.querySelector('input[type="file"]') as HTMLInputElement, png());
    await userEvent.type(within(d).getByLabelText(/Exercise name/), "Sled Push");
    await waitFor(() => expect((within(d).getByLabelText(/Muscle group/) as HTMLSelectElement).disabled).toBe(false));
    await userEvent.selectOptions(within(d).getByLabelText(/Muscle group/), "Chest");
    await userEvent.type(within(d).getByLabelText(/Equipment/), "Sled");
    await userEvent.click(within(d).getByTestId("catalogue-save"));
    expect(await screen.findByText(/was added, but its pictures could not be uploaded/)).toBeTruthy();
    expect(await screen.findByTestId("cat-sled-push")).toBeTruthy();
  });

  it("shows an admin-added exercise's movement text in its details", async () => {
    cat.list.mockResolvedValue({ ...CAT, items: [{ ...item("landmine-press", "Landmine Press", "Chest", "Upper Chest", "Landmine bar"), movement: "Press up and forward", custom: true }] });
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Details of Landmine Press" }));
    expect(within(await screen.findByRole("dialog", { name: "Landmine Press" })).getByText("Press up and forward")).toBeTruthy();
  });
});
