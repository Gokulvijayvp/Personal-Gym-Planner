// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import WorkoutCyclesPage from "./WorkoutCyclesPage";
import { ToastProvider } from "../components/ui/Toast";
import { ApiError } from "../services/apiError";
import { cycleService } from "../services/plannerService";
import { makeCycle, makeCycleDetail } from "../features/planner/testData";

vi.mock("../services/plannerService", () => ({
  cycleService: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), activate: vi.fn(), complete: vi.fn(), archive: vi.fn() },
  plannerService: {}, planningMasterData: {},
}));
const svc = vi.mocked(cycleService);

const ACTIVE = makeCycle({ id: 1, name: "Winter Block", status: "active" });
const DRAFT = makeCycle({ id: 2, name: "Spring Block", status: "draft", start_date: "2027-03-01", end_date: "2027-05-23", total_weeks: 12,
  planned_days: 0, rest_days: 0, exercise_count: 0, cardio_count: 0 });
const DONE = makeCycle({ id: 3, name: "Autumn Base", status: "completed", start_date: "2026-08-03", end_date: "2026-09-13", total_weeks: 6 });
const OLD = makeCycle({ id: 4, name: "Old Block", status: "archived", start_date: "2026-01-05", end_date: "2026-02-01", total_weeks: 4 });

function renderPage() {
  return render(<MemoryRouter><ToastProvider><WorkoutCyclesPage /></ToastProvider></MemoryRouter>);
}
const card = (name: string) => screen.getByRole("article", { name });

beforeEach(() => { window.scrollTo = vi.fn(); svc.list.mockResolvedValue([ACTIVE, DRAFT, DONE, OLD]); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("listing", () => {
  it("shows the active cycle, drafts and previous cycles with dates, duration and status", async () => {
    renderPage();
    await screen.findByRole("article", { name: "Winter Block" });
    const active = screen.getByRole("heading", { name: "Active cycle" }).closest("section")!;
    expect(within(active).getByRole("article", { name: "Winter Block" })).toBeTruthy();
    const drafts = screen.getByRole("heading", { name: "Drafts" }).closest("section")!;
    expect(within(drafts).getByRole("article", { name: "Spring Block" })).toBeTruthy();
    const prev = screen.getByRole("heading", { name: "Previous cycles" }).closest("section")!;
    expect(within(prev).getAllByRole("article").map((a) => a.getAttribute("aria-label"))).toEqual(["Autumn Base", "Old Block"]);

    const w = within(card("Winter Block"));
    expect(w.getByText("Active")).toBeTruthy();
    expect(w.getByText(/16 Nov 2026 – 10 Jan 2027/)).toBeTruthy();
    expect(w.getByText(/8 weeks/)).toBeTruthy();
    expect(within(card("Spring Block")).getByText("Draft")).toBeTruthy();
    expect(within(card("Spring Block")).getByText(/12 weeks/)).toBeTruthy();
    expect(within(card("Autumn Base")).getByText("Completed")).toBeTruthy();
    expect(within(card("Old Block")).getByText("Archived")).toBeTruthy();
    expect(screen.getByTestId("cycle-count").textContent).toBe("4 cycles");
  });

  it("offers the right actions for each status", async () => {
    renderPage();
    await screen.findByRole("article", { name: "Winter Block" });
    const names = (a: string) => within(card(a)).queryAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(names("Winter Block")).toEqual(["Edit Winter Block", "Complete Winter Block", "Archive Winter Block"]);
    expect(names("Spring Block")).toEqual(["Edit Spring Block", "Activate Spring Block", "Archive Spring Block", "Delete Spring Block"]);
    expect(names("Autumn Base")).toEqual(["Archive Autumn Base"]);            // completed: view + archive only
    expect(names("Old Block")).toEqual([]);                                   // archived: read-only
    expect(within(card("Winter Block")).getByRole("link", { name: /Open planner for Winter Block/ }).getAttribute("href")).toBe("/planner?cycle=1");
    expect(within(card("Autumn Base")).getByRole("link", { name: /Open planner for Autumn Base/ }).textContent).toMatch(/View plan/);
  });

  it("shows loading skeletons", async () => {
    let resolve!: (v: typeof ACTIVE[]) => void;
    svc.list.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderPage();
    expect((await screen.findAllByTestId("card-skeleton")).length).toBeGreaterThan(0);
    resolve([ACTIVE]);
    await screen.findByRole("article", { name: "Winter Block" });
    expect(screen.queryAllByTestId("card-skeleton")).toHaveLength(0);
  });

  it("empty state opens the create form", async () => {
    svc.list.mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("No workout cycles yet");
    await user.click(screen.getByRole("button", { name: /create your first cycle/i }));
    expect(await screen.findByRole("dialog", { name: "New workout cycle" })).toBeTruthy();
  });

  it("messages when there is no active cycle or no history", async () => {
    svc.list.mockResolvedValue([DRAFT]);
    renderPage();
    await screen.findByRole("article", { name: "Spring Block" });
    expect(screen.getByTestId("no-active")).toBeTruthy();
    expect(screen.getByTestId("no-previous")).toBeTruthy();
  });

  it("error state with retry", async () => {
    const user = userEvent.setup();
    svc.list.mockRejectedValueOnce(new ApiError({ kind: "network", message: "Can't reach the server." }));
    renderPage();
    await screen.findByText("Couldn't load your cycles");
    expect(screen.getByText("Can't reach the server.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("article", { name: "Winter Block" });
  });
});

describe("create", () => {
  async function openForm() {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("article", { name: "Winter Block" });
    await user.click(screen.getByRole("button", { name: /new cycle/i }));
    const dialog = await screen.findByRole("dialog", { name: "New workout cycle" });
    return { user, dialog };
  }
  const setDate = (dialog: HTMLElement, v: string) => {
    const input = within(dialog).getByLabelText(/Start date/) as HTMLInputElement;
    // date inputs ignore typing in jsdom: set the value the way a browser would on change
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, v);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };

  it("starts with a Monday, 8 weeks and a live end date", async () => {
    const { dialog } = await openForm();
    const date = (within(dialog).getByLabelText(/Start date/) as HTMLInputElement).value;
    expect(new Date(date + "T00:00:00Z").getUTCDay()).toBe(1);
    expect((within(dialog).getByLabelText(/Number of weeks/) as HTMLInputElement).value).toBe("8");
    expect(within(dialog).getByTestId("end-date").textContent).toMatch(/Ends\s*Sunday/);
  });

  it("end date follows custom durations and presets", async () => {
    const { user, dialog } = await openForm();
    setDate(dialog, "2026-11-16");
    expect(within(dialog).getByTestId("end-date").textContent).toMatch(/10 January 2027/);
    await user.click(within(dialog).getByRole("button", { name: "12 weeks" }));
    expect((within(dialog).getByLabelText(/Number of weeks/) as HTMLInputElement).value).toBe("12");
    expect(within(dialog).getByTestId("end-date").textContent).toMatch(/7 February 2027/);
    const weeks = within(dialog).getByLabelText(/Number of weeks/);
    await user.clear(weeks);
    await user.type(weeks, "5");
    expect(within(dialog).getByTestId("end-date").textContent).toMatch(/20 December 2026/);
    await user.clear(weeks);
    expect(within(dialog).getByTestId("end-date").textContent).toMatch(/Choose a start date/);
  });

  it("validates name, Monday start and week count; sends nothing", async () => {
    const { user, dialog } = await openForm();
    await user.click(within(dialog).getByRole("button", { name: "Create cycle" }));
    expect(await within(dialog).findByText("Enter a cycle name.")).toBeTruthy();
    await user.type(within(dialog).getByLabelText(/Cycle name/), "Test");
    setDate(dialog, "2026-11-18");
    await user.click(within(dialog).getByRole("button", { name: "Create cycle" }));
    expect(await within(dialog).findByText(/must start on a Monday/)).toBeTruthy();
    // the fix is one click away
    await user.click(within(dialog).getByRole("button", { name: /Use Monday/ }));
    expect((within(dialog).getByLabelText(/Start date/) as HTMLInputElement).value).toBe("2026-11-23");
    const weeks = within(dialog).getByLabelText(/Number of weeks/);
    for (const v of ["0", "53"]) {
      await user.clear(weeks); await user.type(weeks, v);
      await user.click(within(dialog).getByRole("button", { name: "Create cycle" }));
      expect(await within(dialog).findByText(/between 1 and 52/)).toBeTruthy();
    }
    expect(svc.create).not.toHaveBeenCalled();
  });

  it("creates the cycle with the exact payload, closes, toasts and reloads", async () => {
    svc.create.mockResolvedValue(makeCycleDetail({ id: 9, name: "New Plan", status: "draft", total_weeks: 6 }));
    const { user, dialog } = await openForm();
    setDate(dialog, "2026-11-23");
    await user.type(within(dialog).getByLabelText(/Cycle name/), "  New   Plan ");
    await user.click(within(dialog).getByRole("button", { name: "6 weeks" }));
    await user.type(within(dialog).getByLabelText(/Description/), "Cutting phase");
    const before = svc.list.mock.calls.length;
    await user.click(within(dialog).getByRole("button", { name: "Create cycle" }));
    await waitFor(() => expect(svc.create).toHaveBeenCalledTimes(1));
    expect(svc.create).toHaveBeenCalledWith({ name: "New Plan", description: "Cutting phase", start_date: "2026-11-23", total_weeks: 6 });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect((await screen.findByRole("status")).textContent).toMatch(/New Plan.*created with 6 weeks/);
    await waitFor(() => expect(svc.list.mock.calls.length).toBeGreaterThan(before));
  });

  it("shows server field errors and keeps the form open", async () => {
    svc.create.mockRejectedValue(new ApiError({ kind: "client", status: 409, code: "duplicate_cycle", message: "A cycle named 'X' already exists.",
      details: [{ field: "name", message: "A cycle with this name and start date already exists." }] }));
    const { user, dialog } = await openForm();
    await user.type(within(dialog).getByLabelText(/Cycle name/), "Winter Block");
    await user.click(within(dialog).getByRole("button", { name: "Create cycle" }));
    expect(await within(dialog).findByText("A cycle with this name and start date already exists.")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "New workout cycle" })).toBeTruthy();
    expect((within(dialog).getByLabelText(/Cycle name/) as HTMLInputElement).value).toBe("Winter Block");
  });

  it("network failure shows an alert and keeps the data", async () => {
    svc.create.mockRejectedValue(new ApiError({ kind: "network", message: "Can't reach the server." }));
    const { user, dialog } = await openForm();
    await user.type(within(dialog).getByLabelText(/Cycle name/), "Offline Plan");
    await user.click(within(dialog).getByRole("button", { name: "Create cycle" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("Can't reach the server.");
  });
});

describe("edit", () => {
  it("opens pre-filled and saves changes", async () => {
    svc.update.mockResolvedValue(makeCycleDetail({ id: 2, name: "Spring v2", status: "draft" }));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Edit Spring Block" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit cycle" });
    expect((within(dialog).getByLabelText(/Cycle name/) as HTMLInputElement).value).toBe("Spring Block");
    expect((within(dialog).getByLabelText(/Start date/) as HTMLInputElement).value).toBe("2027-03-01");
    expect((within(dialog).getByLabelText(/Number of weeks/) as HTMLInputElement).value).toBe("12");
    const name = within(dialog).getByLabelText(/Cycle name/);
    await user.clear(name); await user.type(name, "Spring v2");
    const weeks = within(dialog).getByLabelText(/Number of weeks/);
    await user.clear(weeks); await user.type(weeks, "10");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(svc.update).toHaveBeenCalledWith(2, { name: "Spring v2", description: "Eight weeks.", start_date: "2027-03-01", total_weeks: 10 }));
    expect((await screen.findByRole("status")).textContent).toMatch(/Spring v2.*updated/);
  });

  it("shows the server's refusal to shorten a planned cycle on the weeks field", async () => {
    svc.update.mockRejectedValue(new ApiError({ kind: "client", status: 409, code: "weeks_not_empty", message: "Weeks 5 still have planned days.",
      details: [{ field: "total_weeks", message: "Some of the weeks you would remove have a plan." }] }));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Edit Winter Block" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit cycle" });
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
    expect(await within(dialog).findByText(/Some of the weeks you would remove have a plan/)).toBeTruthy();
    expect(within(dialog).getAllByRole("alert").some((a) => /Weeks 5 still have planned days/.test(a.textContent ?? ""))).toBe(true);
  });
});

describe("status actions", () => {
  it("activation asks first, then activates", async () => {
    svc.activate.mockResolvedValue(makeCycleDetail({ id: 2, status: "active" }));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Activate Spring Block" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Activate this cycle?" });
    expect(within(dialog).getByText(/1 Mar – 23 May 2027/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Activate cycle" }));
    await waitFor(() => expect(svc.activate).toHaveBeenCalledWith(2));
    expect((await screen.findByRole("status")).textContent).toMatch(/Spring Block.*active cycle/);
  });

  it("an overlapping activation is refused with the server's message and the dialog stays open", async () => {
    svc.activate.mockRejectedValue(new ApiError({ kind: "client", status: 409, code: "cycle_overlap",
      message: "These dates overlap the active cycle 'Winter Block' (16 Nov 2026 – 10 Jan 2027). Complete or archive that cycle first." }));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Activate Spring Block" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Activate cycle" }));
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(/overlap the active cycle 'Winter Block'/);
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it.each([
    ["Complete Winter Block", "Complete this cycle?", "Complete cycle", () => svc.complete, 1, /completed/],
    ["Archive Autumn Base", "Archive this cycle?", "Archive cycle", () => svc.archive, 3, /archived/],
    ["Delete Spring Block", "Delete this draft?", "Delete draft", () => svc.remove, 2, /deleted/],
  ] as const)("%s needs confirmation", async (buttonName, title, confirm, fn, id, toastRe) => {
    fn().mockResolvedValue(undefined as never);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: buttonName }));
    const dialog = await screen.findByRole("alertdialog", { name: title });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(fn()).not.toHaveBeenCalled();                                      // cancelling does nothing
    await user.click(screen.getByRole("button", { name: buttonName }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: confirm }));
    await waitFor(() => expect(fn()).toHaveBeenCalledWith(id));
    expect((await screen.findByRole("status")).textContent).toMatch(toastRe);
  });

  it("a failed action keeps the dialog open with the error", async () => {
    svc.archive.mockRejectedValue(new ApiError({ kind: "server", status: 500, message: "Something went wrong on the server." }));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Archive Winter Block" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Archive cycle" }));
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(/Something went wrong/);
  });
});
