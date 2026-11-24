// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import History from "./History";
import { DEFAULT_PREFS, dateFormatter } from "../home/prefs";
import { ApiError } from "../../services/apiError";
import { workoutService } from "../../services/workoutService";
import type { SessionListItem } from "../../types/workout";
import type { Settings } from "../../types/settings";

vi.mock("../../services/workoutService", () => ({ workoutService: { list: vi.fn() } }));
const svc = vi.mocked(workoutService);

const ITEM = (over: Partial<SessionListItem> = {}): SessionListItem => ({
  id: 1, workout_date: "2026-11-18", status: "completed", source: "plan", title: "Pull day", cycle_name: "Winter Block", started_at: "2026-11-18T05:00:00Z",
  ended_at: "2026-11-18T06:02:00Z", duration_seconds: 3725, exercise_count: 5, completed_exercise_count: 4, completed_sets: 14, cardio_minutes: 15,
  exercise_names: ["Lat Pulldown", "Barbell Row"], ...over,
});
const list = (items: SessionListItem[], total = items.length) => ({ items, total, page: 1, page_size: 10 });

function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname + l.search}</div>; }
/** The History list on its own (it now lives under Progress > History); the 2nd argument is unused and kept for the old call shape. */
async function renderPage(url = "/workout", _unused?: unknown, history = list([ITEM()]), settings: Partial<Settings> = {}) {
  svc.list.mockResolvedValue(history);
  const fmt = dateFormatter({ ...DEFAULT_PREFS, dateFormat: settings.date_format ?? DEFAULT_PREFS.dateFormat });
  render(<MemoryRouter initialEntries={[url]}><History fmt={fmt} /><Where /></MemoryRouter>);
  await screen.findByTestId("history");
}
const lastQuery = () => svc.list.mock.calls[svc.list.mock.calls.length - 1][0];
const SLOW = { timeout: 3000 };

beforeEach(() => { window.scrollTo = vi.fn(); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("workout history", () => {
  it("lists completed workouts with date, duration and counts, each opening its log", async () => {
    await renderPage("/workout", undefined, list([ITEM(), ITEM({ id: 2, workout_date: "2026-11-16", title: null, source: "blank", duration_seconds: 1800, exercise_count: 1,
      completed_exercise_count: 1, completed_sets: 3, cardio_minutes: 0, exercise_names: ["Plank"] })]), { date_format: "DD/MM/YYYY" });
    const rows = within(screen.getByRole("list", { name: "Past workouts" })).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("Pull day")).toBeTruthy();
    expect(within(rows[0]).getByText("18/11/2026")).toBeTruthy();
    expect(within(rows[0]).getByText("1 h 2 min · 4 of 5 exercises done · 14 sets · 15 min cardio")).toBeTruthy();
    expect(within(rows[0]).getByText("Lat Pulldown, Barbell Row…")).toBeTruthy();
    expect(within(rows[1]).getByText("Blank workout")).toBeTruthy();
    expect(within(rows[1]).getByText("30 min · 1 of 1 exercise done · 3 sets")).toBeTruthy();
    expect(within(rows[0]).getByRole("link").getAttribute("aria-label")).toBe("Wednesday 18/11/2026: Pull day, Completed. Open");
    await userEvent.click(within(rows[1]).getByRole("link"));
    expect(screen.getByTestId("where").textContent).toBe("/workout/2");
  });

  it("asks only for completed workouts by default and labels cancelled ones when included", async () => {
    await renderPage();
    expect(lastQuery()).toMatchObject({ status: "completed", page: 1 });
    svc.list.mockResolvedValue(list([ITEM(), ITEM({ id: 3, status: "cancelled", title: "Leg day" })]));
    await userEvent.click(screen.getByLabelText("Include cancelled"));
    await waitFor(() => expect(lastQuery()).toMatchObject({ status: "finished" }));
    const cancelled = await screen.findByTestId("history-3");
    expect(within(cancelled).getByText("Cancelled")).toBeTruthy();
    expect(cancelled.getAttribute("aria-label")).toContain("Cancelled");
    expect(screen.getByTestId("where").textContent).toBe("/workout?cancelled=1");
  });

  it("filters by date range and keeps the filters in the URL", async () => {
    await renderPage();
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-11-10" } });
    await waitFor(() => expect(lastQuery()).toMatchObject({ start: "2026-11-10" }));
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-11-17" } });
    await waitFor(() => expect(lastQuery()).toMatchObject({ start: "2026-11-10", end: "2026-11-17" }));
    expect(screen.getByTestId("where").textContent).toBe("/workout?from=2026-11-10&to=2026-11-17");
  });

  it("filters by exercise after a short typing pause, not on every keystroke", async () => {
    await renderPage();
    const calls = svc.list.mock.calls.length;
    await userEvent.type(screen.getByLabelText("Filter by exercise"), "bench");
    expect(svc.list.mock.calls.length).toBe(calls);
    await waitFor(() => expect(lastQuery()).toMatchObject({ exercise: "bench" }), SLOW);
    expect(svc.list.mock.calls.length).toBe(calls + 1);
    expect(screen.getByTestId("where").textContent).toBe("/workout?exercise=bench");
  });

  it("restores filters from the URL on load (refresh, back button, shared link)", async () => {
    await renderPage("/workout?from=2026-11-01&to=2026-11-30&exercise=squat&cancelled=1&page=2", undefined, { items: [ITEM()], total: 25, page: 2, page_size: 10 });
    expect(lastQuery()).toEqual({ status: "finished", start: "2026-11-01", end: "2026-11-30", exercise: "squat", page: 2, page_size: 10 });
    expect((screen.getByLabelText("From") as HTMLInputElement).value).toBe("2026-11-01");
    expect((screen.getByLabelText("Filter by exercise") as HTMLInputElement).value).toBe("squat");
    expect((screen.getByLabelText("Include cancelled") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("Page 2 of 3")).toBeTruthy();
  });

  it("pages through results", async () => {
    await renderPage("/workout", undefined, { items: [ITEM()], total: 25, page: 1, page_size: 10 });
    expect(screen.getByText("25 workouts")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /Next/ }));
    await waitFor(() => expect(lastQuery()).toMatchObject({ page: 2 }));
    expect(screen.getByTestId("where").textContent).toBe("/workout?page=2");
  });

  it("clears every filter at once", async () => {
    await renderPage("/workout?from=2026-11-01&exercise=squat");
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(lastQuery()).toEqual({ status: "completed", page: 1, page_size: 10, start: undefined, end: undefined, exercise: undefined }));
    expect((screen.getByLabelText("Filter by exercise") as HTMLInputElement).value).toBe("");
  });

  it("explains a reversed date range and does not query with it", async () => {
    await renderPage();
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-11-01" } });
    await waitFor(() => expect(lastQuery()).toMatchObject({ end: "2026-11-01" }));
    const before = svc.list.mock.calls.length;
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-11-10" } });
    expect(await screen.findByText("The end date must be on or after the start date.")).toBeTruthy();
    expect(svc.list.mock.calls.length).toBe(before);
  });

  it("shows an honest empty state with no history, and a different one when filters match nothing", async () => {
    await renderPage("/workout", undefined, list([]));
    expect(screen.getByTestId("history-empty").textContent).toContain("No finished workouts yet");
    cleanup();
    await renderPage("/workout?exercise=zzz", undefined, list([]));
    expect(screen.getByTestId("history-empty").textContent).toContain("No workouts match these filters");
  });

  it("shows an error with a retry when history cannot be loaded", async () => {
    svc.list.mockRejectedValueOnce(new ApiError({ kind: "server", status: 500, message: "Something went wrong on the server." }));
    render(<MemoryRouter><History fmt={dateFormatter(DEFAULT_PREFS)} /></MemoryRouter>);
    expect(await screen.findByText("Couldn't load your history")).toBeTruthy();
    svc.list.mockResolvedValue(list([ITEM()]));
    await userEvent.click(within(screen.getByTestId("history")).getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("history-1")).toBeTruthy();
  });

  it("history rows are read-only links: no editing controls on the list", async () => {
    await renderPage();
    expect(within(screen.getByTestId("history")).queryByRole("button", { name: /remove|delete|edit|complete/i })).toBeNull();
  });
});
