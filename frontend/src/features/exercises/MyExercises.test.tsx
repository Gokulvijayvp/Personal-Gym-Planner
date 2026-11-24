// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MyExercises from "./MyExercises";
import { resetCatalogueStore, setCatalogueMedia } from "./catalogueStore";
import { nextSetName } from "./exerciseSetLogic";
import { ToastProvider } from "../../components/ui/Toast";
import { ApiError } from "../../services/apiError";
import { catalogueService } from "../../services/catalogueService";
import { exerciseSetService } from "../../services/exerciseSetService";
import type { Catalogue, CatalogueItem } from "../../types/catalogue";
import type { ExerciseSet } from "../../types/exerciseSet";

vi.mock("../../services/catalogueService", () => ({ catalogueService: { list: vi.fn() } }));
vi.mock("../../services/exerciseSetService", () => ({
  exerciseSetService: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), share: vi.fn(), previewShared: vi.fn(), importShared: vi.fn() },
}));

const item = (key: string, name: string, muscle_group: string): CatalogueItem =>
  ({ key, name, muscle_group, target_area: null, equipment: "Barbell", icon_motion: "press", in_library: false, exercise_id: null });
const CAT: Catalogue = {
  items: [item("bench", "Bench Press", "Chest"), item("fly", "Fly", "Chest"), item("squat", "Squat", "Quadriceps")],
  muscle_groups: ["Chest", "Quadriceps"], motions: {},
};
const set = (id: number, name: string, keys: [string, string][]): ExerciseSet => ({
  id, name, muscle_group: "Chest", created_at: "2026-11-23T00:00:00Z",
  exercises: keys.map(([key, n]) => ({ key, name: n, equipment: "Barbell", icon_motion: "press" })),
});

const sets = vi.mocked(exerciseSetService);
const open = () => render(<ToastProvider><MyExercises /></ToastProvider>);

beforeEach(() => { resetCatalogueStore(); vi.mocked(catalogueService.list).mockResolvedValue(CAT); sets.list.mockResolvedValue([]); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("nextSetName", () => {
  it("suggests A, then B, and reuses a freed letter", () => {
    expect(nextSetName("Chest", [])).toBe("Chest A");
    expect(nextSetName("Chest", ["Chest A"])).toBe("Chest B");
    expect(nextSetName("Chest", ["chest a", "Chest B"])).toBe("Chest C");
    expect(nextSetName("Chest", ["Chest B"])).toBe("Chest A");
    expect(nextSetName("Leg", ["Chest A"])).toBe("Leg A");
  });
});

describe("My exercises", () => {
  it("starts empty with an Add button", async () => {
    open();
    expect(await screen.findByText("No exercises yet")).toBeTruthy();
    expect(screen.getByTestId("add-set")).toBeTruthy();
  });

  it("walks through muscle, automatic name and exercises, then saves", async () => {
    sets.list.mockResolvedValueOnce([set(1, "Chest A", [["bench", "Bench Press"]])]);
    sets.create.mockResolvedValue(set(2, "Chest B", [["bench", "Bench Press"], ["fly", "Fly"]]));
    open();
    await userEvent.click(await screen.findByTestId("add-set"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByLabelText("Name")).toBeNull();                       // nothing until a muscle is chosen
    await userEvent.click(within(dialog).getByRole("button", { name: "Chest" }));
    expect((within(dialog).getByLabelText("2. Name") as HTMLInputElement).value).toBe("Chest B");   // A is taken
    expect(within(dialog).queryByText("Squat")).toBeNull();                           // only this muscle's exercises
    await userEvent.click(within(dialog).getByRole("button", { name: /Bench Press/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: /Fly/ }));
    await userEvent.click(within(dialog).getByTestId("set-save"));
    await waitFor(() => expect(sets.create).toHaveBeenCalledWith({ name: "Chest B", muscle_group: "Chest", exercise_keys: ["bench", "fly"] }));
  });

  it("lets you type your own name when automatic naming is off", async () => {
    sets.create.mockResolvedValue(set(3, "Heavy day", [["bench", "Bench Press"]]));
    open();
    await userEvent.click(await screen.findByTestId("add-set"));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Chest" }));
    await userEvent.click(within(dialog).getByLabelText(/Name it automatically/));
    const input = within(dialog).getByLabelText("2. Name") as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, "Heavy day");
    await userEvent.click(within(dialog).getByRole("button", { name: /Bench Press/ }));
    await userEvent.click(within(dialog).getByTestId("set-save"));
    await waitFor(() => expect(sets.create).toHaveBeenCalledWith(expect.objectContaining({ name: "Heavy day" })));
  });

  it("asks for at least one exercise", async () => {
    open();
    await userEvent.click(await screen.findByTestId("add-set"));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Chest" }));
    await userEvent.click(within(dialog).getByTestId("set-save"));
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(/at least one exercise/);
    expect(sets.create).not.toHaveBeenCalled();
  });

  it("shows an uploaded picture on the exercise and opens its details when tapped, updating live after an upload", async () => {
    sets.list.mockResolvedValue([set(1, "Chest A", [["bench", "Bench Press"], ["fly", "Fly"]])]);
    vi.mocked(catalogueService.list).mockResolvedValue({
      ...CAT, items: CAT.items.map((i) => i.key === "bench" ? { ...i, media: [{ id: 1, kind: "image" as const, content_type: "image/png", url: "/m/1" }] } : i),
    });
    const { container } = open();
    const card = await screen.findByTestId("set-1");
    await waitFor(() => expect(container.querySelector('img[src="/m/1"]')).toBeTruthy());           // Bench Press shows its picture
    expect(within(card).getByRole("button", { name: "Show Fly" }).querySelector("img")).toBeNull();   // Fly still has the animated icon
    // a picture uploaded elsewhere shows up here without reloading
    setCatalogueMedia("fly", [{ id: 2, kind: "image", content_type: "image/png", url: "/m/2" }]);
    await waitFor(() => expect(container.querySelector('img[src="/m/2"]')).toBeTruthy());
    await userEvent.click(within(card).getByRole("button", { name: "Show Bench Press" }));
    const dialog = await screen.findByRole("dialog", { name: "Bench Press" });
    expect(dialog.querySelector('img[src="/m/1"]')).toBeTruthy();                                  // details show the uploaded picture
    expect(within(dialog).getByText("Chest")).toBeTruthy();
  });

  it("shows each set as a card with its exercises in a row, and deletes after confirming", async () => {
    sets.list.mockResolvedValue([set(1, "Chest A", [["bench", "Bench Press"], ["fly", "Fly"]])]);
    sets.remove.mockResolvedValue(undefined as never);
    open();
    const card = await screen.findByTestId("set-1");
    const row = within(card).getByRole("list", { name: "Chest A exercises" });
    expect(within(row).getAllByRole("listitem").map((l) => l.querySelector("b")?.textContent)).toEqual(["Bench Press", "Fly"]);
    await userEvent.click(within(card).getByRole("button", { name: "Delete Chest A" }));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(sets.remove).toHaveBeenCalledWith(1));
  });
});


describe("Share and paste a code", () => {
  const written: string[] = [];
  beforeEach(() => {
    written.length = 0;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(async (t: string) => { written.push(t); }), readText: vi.fn(async () => " ABCDE-FGHJK ") },
    });
  });

  it("the Share icon copies one code for the whole list and shows it", async () => {
    sets.list.mockResolvedValue([set(1, "Chest A", [["bench", "Bench Press"]]), set(2, "Chest B", [["fly", "Fly"]])]);
    sets.share.mockResolvedValue({ code: "ABCDE-FGHJK", sets_count: 2, expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString() });
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Share my exercises" }));
    const dialog = await screen.findByRole("dialog", { name: "Share my exercises" });
    expect((within(dialog).getByLabelText("Share code") as HTMLInputElement).value).toBe("ABCDE-FGHJK");
    expect(written).toEqual(["ABCDE-FGHJK"]);                                         // already on the clipboard
    expect(within(dialog).getByText(/Your code is copied/)).toBeTruthy();
    expect(dialog.textContent).toMatch(/2 sets/);
    await userEvent.click(within(dialog).getByRole("button", { name: "Copy" }));
    expect(written).toEqual(["ABCDE-FGHJK", "ABCDE-FGHJK"]);
  });

  it("Share is disabled while there is nothing to share, but Paste is available", async () => {
    open();
    await screen.findByText("No exercises yet");
    expect((screen.getByRole("button", { name: "Share my exercises" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Paste a share code" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows the server's message when a code cannot be made", async () => {
    sets.list.mockResolvedValue([set(1, "Chest A", [["bench", "Bench Press"]])]);
    sets.share.mockRejectedValue(new ApiError({ kind: "client", status: 429, message: "You have made many share codes. Try again later." }));
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Share my exercises" }));
    expect(await screen.findByText(/You have made many share codes/)).toBeTruthy();
  });

  it("Paste: enter the code, see what it holds, confirm the deletion, then the list is replaced", async () => {
    sets.list.mockResolvedValueOnce([set(1, "Old A", [["bench", "Bench Press"]]), set(2, "Old B", [["fly", "Fly"]])])
      .mockResolvedValue([set(7, "Chest A", [["bench", "Bench Press"]])]);
    sets.previewShared.mockResolvedValue({ sets_count: 1, sets: [{ name: "Chest A", muscle_group: "Chest", exercise_count: 3 }], expires_at: "2027-01-01T00:00:00Z" });
    sets.importShared.mockResolvedValue({ removed: 2, imported: 1, sets: [] });
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Paste a share code" }));
    const dialog = await screen.findByRole("dialog", { name: "Paste a share code" });
    await userEvent.type(within(dialog).getByLabelText("Share code"), "abcde-fghjk");
    await userEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(sets.previewShared).toHaveBeenCalledWith("abcde-fghjk"));
    const confirm = await screen.findByRole("alertdialog", { name: "Replace your My exercises?" });       // one confirmation
    expect(confirm.textContent).toMatch(/Your 2 current sets will be deleted/);
    expect(confirm.textContent).toMatch(/Old A, Old B/);
    expect(confirm.textContent).toMatch(/Chest A \(3\)/);
    expect(sets.importShared).not.toHaveBeenCalled();                                                       // nothing deleted yet
    await userEvent.click(within(confirm).getByRole("button", { name: "Delete mine and import" }));
    await waitFor(() => expect(sets.importShared).toHaveBeenCalledWith("abcde-fghjk"));
    expect(await screen.findByText(/2 sets were replaced by 1 shared set/)).toBeTruthy();
    expect(await screen.findByTestId("set-7")).toBeTruthy();                                                // the new list is on screen
    expect(screen.queryByTestId("set-1")).toBeNull();
  });

  it("Cancel at the confirmation deletes nothing", async () => {
    sets.list.mockResolvedValue([set(1, "Old A", [["bench", "Bench Press"]])]);
    sets.previewShared.mockResolvedValue({ sets_count: 1, sets: [{ name: "Chest A", muscle_group: "Chest", exercise_count: 1 }], expires_at: "2027-01-01T00:00:00Z" });
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Paste a share code" }));
    await userEvent.type(await screen.findByLabelText("Share code"), "ABCDE-FGHJK");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
    expect(sets.importShared).not.toHaveBeenCalled();
    expect(screen.getByTestId("set-1")).toBeTruthy();
  });

  it("an invalid code shows the message and nothing else happens", async () => {
    sets.list.mockResolvedValue([set(1, "Old A", [["bench", "Bench Press"]])]);
    sets.previewShared.mockRejectedValue(new ApiError({ kind: "client", status: 404, message: "That code isn't valid or has expired. Check it and try again." }));
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Paste a share code" }));
    const dialog = await screen.findByRole("dialog", { name: "Paste a share code" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(/Paste the share code first/);       // empty input is caught locally
    await userEvent.type(within(dialog).getByLabelText("Share code"), "WRONG-CODE1");
    await userEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(/isn't valid or has expired/);
    expect(sets.importShared).not.toHaveBeenCalled();
  });

  it("the Paste button inside the dialog fills the box from the clipboard", async () => {
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Paste a share code" }));
    const dialog = await screen.findByRole("dialog", { name: "Paste a share code" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Paste" }));
    await waitFor(() => expect((within(dialog).getByLabelText("Share code") as HTMLInputElement).value).toBe("ABCDE-FGHJK"));
  });

  it("with no sets yet the confirmation says nothing will be deleted", async () => {
    sets.previewShared.mockResolvedValue({ sets_count: 2, sets: [{ name: "A", muscle_group: "Chest", exercise_count: 1 }, { name: "B", muscle_group: "Chest", exercise_count: 1 }], expires_at: "2027-01-01T00:00:00Z" });
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Paste a share code" }));
    await userEvent.type(await screen.findByLabelText("Share code"), "ABCDE-FGHJK");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(confirm.textContent).toMatch(/nothing will be deleted/);
    expect(within(confirm).getByRole("button", { name: "Import" })).toBeTruthy();
  });
});
