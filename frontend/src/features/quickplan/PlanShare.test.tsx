// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PlanImportDialog from "./PlanImportDialog";
import PlanShareDialog from "./PlanShareDialog";
import { ToastProvider } from "../../components/ui/Toast";
import { ApiError } from "../../services/apiError";
import { planShareService } from "../../services/planShareService";
import type { PlanSharePreview } from "../../types/planShare";

vi.mock("../../services/planShareService", () => ({
  planShareService: { shareDay: vi.fn(), shareWeek: vi.fn(), preview: vi.fn(), importPlan: vi.fn() },
}));
const svc = vi.mocked(planShareService);
const written: string[] = [];

beforeEach(() => {
  written.length = 0;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(async (t: string) => { written.push(t); }), readText: vi.fn(async () => " ABCDE-FGHJK ") },
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const wrap = (ui: React.ReactNode) => render(<ToastProvider>{ui}</ToastProvider>);

describe("PlanShareDialog", () => {
  const open = (onClose = vi.fn()) => wrap(<PlanShareDialog cycleId={4} week={2} day={3} dayName="Thursday" onClose={onClose} />);

  it("shares this day by default and copies the code", async () => {
    svc.shareDay.mockResolvedValue({ code: "ABCDE-FGHJK", kind: "day", days_count: 1, expires_at: "2027-01-01T00:00:00Z" });
    open();
    await userEvent.click(screen.getByTestId("make-plan-code"));
    await waitFor(() => expect(svc.shareDay).toHaveBeenCalledWith(4, 2, 3));
    expect((await screen.findByLabelText("Share code") as HTMLInputElement).value).toBe("ABCDE-FGHJK");
    expect(written).toEqual(["ABCDE-FGHJK"]);
    expect(screen.getByText(/Your code is copied/)).toBeTruthy();
    expect(screen.getByText(/Thursday's plan/)).toBeTruthy();
  });

  it("can share the whole week instead", async () => {
    svc.shareWeek.mockResolvedValue({ code: "WWWWW-22222", kind: "week", days_count: 5, expires_at: "2027-01-01T00:00:00Z" });
    open();
    await userEvent.click(screen.getByLabelText(/This whole week/));
    await userEvent.click(screen.getByTestId("make-plan-code"));
    await waitFor(() => expect(svc.shareWeek).toHaveBeenCalledWith(4, 2));
    expect(svc.shareDay).not.toHaveBeenCalled();
    expect(await screen.findByText(/5 planned days of week 2/)).toBeTruthy();
  });

  it("shows the server's message when there is nothing planned", async () => {
    svc.shareDay.mockRejectedValue(new ApiError({ kind: "client", status: 400, message: "Thursday has nothing planned to share." }));
    open();
    await userEvent.click(screen.getByTestId("make-plan-code"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/nothing planned/);
  });
});

const DAY: PlanSharePreview = {
  kind: "day", expires_at: "2027-01-01T00:00:00Z", new_exercises: ["Alice Fly"],
  days: [{ day_of_week: -1, name: "This day", status: "planned", title: null, muscle_groups: ["Chest", "Triceps"], exercise_count: 3, cardio_count: 1 }],
};
const WEEK: PlanSharePreview = {
  kind: "week", expires_at: "2027-01-01T00:00:00Z", new_exercises: [],
  days: [
    { day_of_week: 0, name: "Monday", status: "planned", title: null, muscle_groups: ["Chest"], exercise_count: 4, cardio_count: 0 },
    { day_of_week: 2, name: "Wednesday", status: "rest", title: null, muscle_groups: [], exercise_count: 0, cardio_count: 0 },
  ],
};

describe("PlanImportDialog", () => {
  const open = (onImported = vi.fn(), onClose = vi.fn()) =>
    wrap(<PlanImportDialog cycle={{ id: 9, name: "Winter" }} week={2} day={4} onClose={onClose} onImported={onImported} />);

  async function enter(code = "abcde-fghjk") {
    await userEvent.type(await screen.findByLabelText("Share code"), code);
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
  }

  it("asks for a code first and shows the server's message for a bad one", async () => {
    svc.preview.mockRejectedValue(new ApiError({ kind: "client", status: 404, message: "That code isn't valid or has expired. Check it and try again." }));
    open();
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Paste the share code first/);
    await enter("WRONG-CODE1");
    expect((await screen.findByRole("alert")).textContent).toMatch(/isn't valid or has expired/);
    expect(svc.importPlan).not.toHaveBeenCalled();
  });

  it("the in-dialog Paste button fills the box from the clipboard", async () => {
    open();
    await userEvent.click(screen.getByRole("button", { name: "Paste" }));
    await waitFor(() => expect((screen.getByLabelText("Share code") as HTMLInputElement).value).toBe("ABCDE-FGHJK"));
  });

  it("a day code: shows it, lets you choose the weekday (default: the open day), lists new exercises, and imports", async () => {
    svc.preview.mockResolvedValue(DAY);
    svc.importPlan.mockResolvedValue({ kind: "day", replaced_days: 0, imported_days: 1, added_exercises: ["Alice Fly"] });
    const onImported = vi.fn();
    open(onImported);
    await enter();
    const dialog = await screen.findByRole("dialog", { name: "Copy a shared day" });
    expect(within(dialog).getByText(/Chest \+ Triceps, 3 exercises, cardio/)).toBeTruthy();
    expect(within(dialog).getByText(/Alice Fly/)).toBeTruthy();                              // will be added to the library
    const select = within(dialog).getByLabelText("Put it on") as HTMLSelectElement;
    expect(select.value).toBe("4");                                                           // Friday: the day that was open
    await userEvent.selectOptions(select, "1");
    await userEvent.click(within(dialog).getByTestId("plan-import"));
    await waitFor(() => expect(svc.importPlan).toHaveBeenCalledWith({ code: "abcde-fghjk", cycle_id: 9, week_number: 2, day_of_week: 1, confirm_replace: false }));
    await waitFor(() => expect(onImported).toHaveBeenCalledWith({ kind: "day", replaced_days: 0, imported_days: 1, added_exercises: ["Alice Fly"] }));
  });

  it("a week code: lists the days and goes into the current week, with no weekday choice", async () => {
    svc.preview.mockResolvedValue(WEEK);
    svc.importPlan.mockResolvedValue({ kind: "week", replaced_days: 0, imported_days: 2, added_exercises: [] });
    open();
    await enter();
    const dialog = await screen.findByRole("dialog", { name: "Copy a shared week" });
    expect(within(dialog).getByText("Monday: Chest, 4 exercises")).toBeTruthy();
    expect(within(dialog).getByText("Wednesday: rest day")).toBeTruthy();
    expect(within(dialog).queryByLabelText("Put it on")).toBeNull();
    expect(dialog.textContent).toMatch(/week 2/);
    await userEvent.click(within(dialog).getByTestId("plan-import"));
    await waitFor(() => expect(svc.importPlan).toHaveBeenCalledWith({ code: "abcde-fghjk", cycle_id: 9, week_number: 2, day_of_week: null, confirm_replace: false }));
  });

  it("when a plan is already there it asks to confirm the deletion, and only then replaces it", async () => {
    svc.preview.mockResolvedValue(DAY);
    svc.importPlan
      .mockRejectedValueOnce(new ApiError({ kind: "client", status: 409, code: "target_not_empty", message: "Friday already has a plan. Confirm to replace it." }))
      .mockResolvedValueOnce({ kind: "day", replaced_days: 1, imported_days: 1, added_exercises: [] });
    const onImported = vi.fn();
    open(onImported);
    await enter();
    await userEvent.click(await screen.findByTestId("plan-import"));
    const confirm = await screen.findByRole("alertdialog", { name: "Replace your plan?" });
    expect(confirm.textContent).toMatch(/Friday of week 2 will be deleted/);
    expect(svc.importPlan).toHaveBeenCalledTimes(1);                                          // nothing was replaced yet
    expect(onImported).not.toHaveBeenCalled();
    await userEvent.click(within(confirm).getByRole("button", { name: "Delete mine and import" }));
    await waitFor(() => expect(svc.importPlan).toHaveBeenLastCalledWith(expect.objectContaining({ confirm_replace: true, day_of_week: 4 })));
    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
  });

  it("cancelling the confirmation deletes nothing", async () => {
    svc.preview.mockResolvedValue(WEEK);
    svc.importPlan.mockRejectedValue(new ApiError({ kind: "client", status: 409, code: "target_not_empty", message: "This week already has a plan." }));
    const onImported = vi.fn();
    open(onImported);
    await enter();
    await userEvent.click(await screen.findByTestId("plan-import"));
    const confirm = await screen.findByRole("alertdialog");
    expect(confirm.textContent).toMatch(/all of week 2/);
    await userEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(svc.importPlan).toHaveBeenCalledTimes(1);
    expect(onImported).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Copy a shared week" })).toBeTruthy();         // back at the preview
  });

  it("shows other server errors (for example a finished cycle) in the dialog", async () => {
    svc.preview.mockResolvedValue(DAY);
    svc.importPlan.mockRejectedValue(new ApiError({ kind: "client", status: 409, code: "cycle_locked", message: "This cycle is completed and can no longer be changed." }));
    open();
    await enter();
    await userEvent.click(await screen.findByTestId("plan-import"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/can no longer be changed/);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
