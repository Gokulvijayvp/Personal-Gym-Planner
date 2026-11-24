// @vitest-environment jsdom
import { setSession, resetSession } from "../features/auth/session";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import SettingsPage from "./SettingsPage";
import { ToastProvider } from "../components/ui/Toast";
import { ApiError } from "../services/apiError";
import { settingsService } from "../services/settingsService";
import type { DataInfo, Settings } from "../types/settings";

vi.mock("../services/settingsService", () => ({
  settingsService: { get: vi.fn(), update: vi.fn(), reset: vi.fn(), dataInfo: vi.fn(), downloadBackup: vi.fn() },
}));
const svc = vi.mocked(settingsService);

const DEFAULT_SETTINGS: Settings = {
  display_name: null, rest_between_sets_seconds: 90, rest_between_exercises_seconds: 120, target_workout_minutes: 60,
  weight_unit: "kg", distance_unit: "km", week_start: "monday", date_format: "DD MMM YYYY", updated_at: "2026-11-19T10:00:00Z",
};
const INFO: DataInfo = {
  application: "Personal Gym Planner API", api_version: "0.1.0", environment: "development", timezone: "Asia/Kolkata",
  database_engine: "SQLite", schema_version: "d5a2b8c1e9f3", database_size_bytes: 204800,
  counts: { exercises: 1, cycles: 1, planned_days: 3, workout_sessions: 0 },
  backup_includes: ["Exercise Library (including your own exercises)", "Workout Cycles, weeks and daily plans"],
};

function renderPage() {
  return render(<MemoryRouter><ToastProvider><SettingsPage /></ToastProvider></MemoryRouter>);
}
const field = (name: RegExp | string) => screen.getByLabelText(name) as HTMLInputElement;
const saveButton = () => screen.getByRole("button", { name: /^(Save changes|Saving…)$/ });

beforeEach(() => {
  setSession({ email: "admin@example.com", role: "admin" });
  svc.get.mockResolvedValue(DEFAULT_SETTINGS);
  svc.dataInfo.mockResolvedValue(INFO);
  svc.update.mockImplementation(async (v) => ({ ...v, updated_at: "2026-11-19T11:00:00Z" }));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); resetSession(); });

async function ready() {
  renderPage();
  await screen.findByLabelText("Rest between sets");
}

describe("loading", () => {
  it("shows a loading state, then the saved values", async () => {
    svc.get.mockResolvedValue({ ...DEFAULT_SETTINGS, display_name: "Gokul", rest_between_sets_seconds: 45, weight_unit: "lbs" });
    renderPage();
    expect(screen.getByRole("status", { name: "Loading settings" })).toBeTruthy();
    await screen.findByLabelText("Rest between sets");
    expect(field("Rest between sets").value).toBe("45");
    expect(field(/Display name/).value).toBe("Gokul");
    expect((screen.getByRole("radio", { name: "lbs" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("All changes saved")).toBeTruthy();
  });

  it("shows an error state with a working retry when settings cannot load", async () => {
    svc.get.mockRejectedValueOnce(new ApiError({ kind: "network", message: "Can't reach the server." }));
    renderPage();
    expect(await screen.findByText("Couldn't load your settings")).toBeTruthy();
    expect(screen.getByText("Can't reach the server.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByLabelText("Rest between sets");
    expect(svc.get).toHaveBeenCalledTimes(2);
  });

  it("renders the four sections", async () => {
    await ready();
    for (const name of ["Workout Preferences", "Calendar Preferences", "Personal Preferences", "Data Management"]) {
      expect(screen.getByRole("heading", { name })).toBeTruthy();
    }
    expect(screen.queryByText(/password|email|log in/i)).toBeNull();
  });
});

describe("editing and saving", () => {
  it("starts clean with Save disabled, then flags unsaved changes", async () => {
    await ready();
    expect(saveButton().hasAttribute("disabled")).toBe(true);
    await userEvent.clear(field("Rest between sets"));
    await userEvent.type(field("Rest between sets"), "75");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(saveButton().hasAttribute("disabled")).toBe(false);
  });

  it("nothing is sent while typing; Save sends every value once", async () => {
    await ready();
    await userEvent.clear(field("Rest between sets"));
    await userEvent.type(field("Rest between sets"), "75");
    await userEvent.clear(field("Rest between exercises"));
    await userEvent.type(field("Rest between exercises"), "150");
    await userEvent.clear(field("Workout duration target"));
    await userEvent.type(field("Workout duration target"), "50");
    await userEvent.click(screen.getByRole("radio", { name: "lbs" }));
    await userEvent.click(screen.getByRole("radio", { name: "miles" }));
    await userEvent.click(screen.getByRole("radio", { name: "Sunday" }));
    await userEvent.click(screen.getByRole("radio", { name: /YYYY-MM-DD/ }));
    await userEvent.type(field(/Display name/), "  Gokul ");
    expect(svc.update).not.toHaveBeenCalled();

    await userEvent.click(saveButton());
    await waitFor(() => expect(svc.update).toHaveBeenCalledTimes(1));
    expect(svc.update).toHaveBeenCalledWith({
      display_name: "Gokul", rest_between_sets_seconds: 75, rest_between_exercises_seconds: 150, target_workout_minutes: 50,
      weight_unit: "lbs", distance_unit: "miles", week_start: "sunday", date_format: "YYYY-MM-DD",
    });
    expect(await screen.findByText("Settings saved.")).toBeTruthy();
    expect(screen.getByText("All changes saved")).toBeTruthy();
    expect(saveButton().hasAttribute("disabled")).toBe(true);
  });

  it("shows a saving indicator and ignores repeated taps", async () => {
    let finish!: (s: Settings) => void;
    svc.update.mockImplementation(() => new Promise<Settings>((res) => { finish = res; }));
    await ready();
    await userEvent.click(screen.getByRole("radio", { name: "lbs" }));
    const button = saveButton();
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.submit(screen.getByRole("form", { name: "Settings" }));
    await screen.findAllByText("Saving…");
    expect(svc.update).toHaveBeenCalledTimes(1);
    expect(field("Rest between sets").disabled).toBe(true);
    await act(async () => finish({ ...DEFAULT_SETTINGS, weight_unit: "lbs" }));
    await screen.findByText("All changes saved");
  });

  it("persists across a refresh: a new page load shows what the server returns", async () => {
    await ready();
    await userEvent.click(screen.getByRole("radio", { name: "lbs" }));
    await userEvent.click(saveButton());
    await screen.findByText("Settings saved.");
    const saved = await svc.update.mock.results[0].value;
    cleanup();

    svc.get.mockResolvedValue(saved);
    await ready();
    expect((screen.getByRole("radio", { name: "lbs" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("All changes saved")).toBeTruthy();
  });

  it("Discard changes restores the saved values", async () => {
    await ready();
    await userEvent.type(field(/Display name/), "Temp");
    await userEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(field(/Display name/).value).toBe("");
    expect(screen.getByText("All changes saved")).toBeTruthy();
    expect(svc.update).not.toHaveBeenCalled();
  });

  it("warns before leaving the page with unsaved changes, and not otherwise", async () => {
    await ready();
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    await userEvent.click(screen.getByRole("radio", { name: "lbs" }));
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });
});

describe("validation", () => {
  it.each([
    ["Rest between sets", "-5", /negative/],
    ["Rest between exercises", "-1", /negative/],
    ["Workout duration target", "0", /at least 1/],
    ["Rest between sets", "", /Enter/],
    ["Rest between sets", "9.5", /whole number/],
  ])("%s = %j shows an error and does not call the API", async (label, value, message) => {
    await ready();
    const input = field(label);
    await userEvent.clear(input);
    if (value) await userEvent.type(input, value);
    await userEvent.click(saveButton());
    expect((await screen.findAllByRole("alert")).some((a) => message.test(a.textContent ?? ""))).toBe(true);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(svc.update).not.toHaveBeenCalled();
    expect(screen.getByText(/Fix the highlighted fields/)).toBeTruthy();
  });

  it("limits the display name length", async () => {
    await ready();
    await userEvent.type(field(/Display name/), "x".repeat(60));
    await userEvent.click(saveButton());
    expect(await screen.findByText(/50 characters or fewer/)).toBeTruthy();
    expect(svc.update).not.toHaveBeenCalled();
  });

  it("clears a field's server error as soon as it is edited", async () => {
    svc.update.mockRejectedValueOnce(new ApiError({
      kind: "validation", status: 422, code: "validation_error", message: "Invalid",
      details: [{ field: "target_workout_minutes", message: "Input should be less than or equal to 600" }],
    }));
    await ready();
    await userEvent.click(screen.getByRole("radio", { name: "lbs" }));
    await userEvent.click(saveButton());
    expect(await screen.findByText("Input should be less than or equal to 600")).toBeTruthy();
    expect(screen.getByText(/Some values were not accepted/)).toBeTruthy();
    await userEvent.type(field("Workout duration target"), "0");
    expect(screen.queryByText("Input should be less than or equal to 600")).toBeNull();
  });
});

describe("API failures", () => {
  it("keeps the edits and shows the error when saving fails, then succeeds on retry", async () => {
    svc.update.mockRejectedValueOnce(new ApiError({ kind: "network", message: "Can't reach the server. Check your connection." }));
    await ready();
    await userEvent.click(screen.getByRole("radio", { name: "lbs" }));
    await userEvent.click(saveButton());
    expect(await screen.findByText("Can't reach the server. Check your connection.")).toBeTruthy();
    expect(screen.getByText("Unsaved changes")).toBeTruthy();   // nothing is claimed as saved
    expect(screen.queryByText("Settings saved.")).toBeNull();
    expect((screen.getByRole("radio", { name: "lbs" }) as HTMLInputElement).checked).toBe(true);

    await userEvent.click(saveButton());
    expect(await screen.findByText("Settings saved.")).toBeTruthy();
    expect(screen.getByText("All changes saved")).toBeTruthy();
  });
});

describe("date format preview", () => {
  it("shows today in the chosen format", async () => {
    await ready();
    const preview = screen.getByTestId("date-preview");
    const before = preview.textContent;
    await userEvent.click(screen.getByRole("radio", { name: /YYYY-MM-DD/ }));
    expect(preview.textContent).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await userEvent.click(screen.getByRole("radio", { name: /DD\/MM\/YYYY/ }));
    expect(preview.textContent).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(before).toMatch(/^\d{2} [A-Z][a-z]{2} \d{4}$/);
  });

  it("explains that the calendar stays Monday-first", async () => {
    await ready();
    expect(screen.getByText(/Calendar and cycle planning stay Monday-first/)).toBeTruthy();
  });
});

describe("reset to defaults", () => {
  const CHANGED: Settings = { ...DEFAULT_SETTINGS, rest_between_sets_seconds: 30, weight_unit: "lbs", week_start: "sunday", display_name: "Gokul" };

  beforeEach(() => {
    svc.get.mockResolvedValue(CHANGED);
    svc.reset.mockResolvedValue({ ...CHANGED, rest_between_sets_seconds: 90, rest_between_exercises_seconds: 120, target_workout_minutes: 60, weight_unit: "kg", distance_unit: "km" });
  });

  it("asks for confirmation and does nothing if cancelled", async () => {
    await ready();
    await userEvent.click(screen.getByRole("button", { name: "Reset Workout Preferences to defaults" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/Rest between sets: 90 s/)).toBeTruthy();
    expect(within(dialog).getByText(/not affected/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(svc.reset).not.toHaveBeenCalled();
    expect(field("Rest between sets").value).toBe("30");
  });

  it("resets only that section after confirming, and keeps other sections as they were", async () => {
    await ready();
    await userEvent.click(screen.getByRole("radio", { name: "Monday" }));        // unsaved edit in Calendar
    await userEvent.click(screen.getByRole("button", { name: "Reset Workout Preferences to defaults" }));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Reset to defaults" }));
    await waitFor(() => expect(svc.reset).toHaveBeenCalledWith("workout"));
    expect(await screen.findByText("Workout Preferences restored to defaults.")).toBeTruthy();
    expect(field("Rest between sets").value).toBe("90");
    expect((screen.getByRole("radio", { name: "kg" }) as HTMLInputElement).checked).toBe(true);
    expect(field(/Display name/).value).toBe("Gokul");
    expect((screen.getByRole("radio", { name: "Monday" }) as HTMLInputElement).checked).toBe(true); // calendar draft kept
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("warns that unsaved edits in the section will be lost", async () => {
    await ready();
    await userEvent.clear(field("Rest between sets"));
    await userEvent.type(field("Rest between sets"), "55");
    await userEvent.click(screen.getByRole("button", { name: "Reset Workout Preferences to defaults" }));
    expect(await screen.findByText(/Edits you haven't saved in this section will be lost/)).toBeTruthy();
  });

  it("does not warn about edits when the section is untouched", async () => {
    await ready();
    await userEvent.click(screen.getByRole("button", { name: "Reset Personal Preferences to defaults" }));
    await screen.findByRole("alertdialog");
    expect(screen.queryByText(/haven't saved/)).toBeNull();
  });

  it("shows the error inside the dialog if the reset fails, and keeps the values", async () => {
    svc.reset.mockRejectedValueOnce(new ApiError({ kind: "server", status: 500, message: "Something went wrong on the server." }));
    await ready();
    await userEvent.click(screen.getByRole("button", { name: "Reset Calendar Preferences to defaults" }));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Reset to defaults" }));
    expect(await within(await screen.findByRole("alertdialog")).findByText("Something went wrong on the server.")).toBeTruthy();
    expect((screen.getByRole("radio", { name: "Sunday" }) as HTMLInputElement).checked).toBe(true);
  });
});

describe("data management", () => {
  it("shows database information and what a backup includes, without any file paths", async () => {
    await ready();
    const info = await screen.findByRole("group", { hidden: true, name: "" }).catch(() => null);
    expect(info).toBeNull();
    const list = await screen.findByLabelText("Application and database information");
    expect(within(list).getByText("SQLite · 200.0 KB")).toBeTruthy();
    expect(within(list).getByText("d5a2b8c1e9f3")).toBeTruthy();
    expect(within(list).getByText("Asia/Kolkata")).toBeTruthy();
    expect(screen.getByText("Exercise Library (including your own exercises)")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\.db\b|[A-Z]:\\|sqlite:\/\//);
    expect(screen.queryByRole("button", { name: /delete|reset (database|data)|wipe/i })).toBeNull();
  });

  it("shows a retryable error if the data info cannot load, without breaking the page", async () => {
    svc.dataInfo.mockRejectedValueOnce(new ApiError({ kind: "server", status: 500, message: "Something went wrong on the server." }));
    await ready();
    expect(await screen.findByText("Couldn't load data information")).toBeTruthy();
    expect(field("Rest between sets")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByLabelText("Application and database information")).toBeTruthy();
  });

  it("on a managed database (RDS) the backup box explains automatic backups instead of offering a download", async () => {
    svc.dataInfo.mockResolvedValue({ ...INFO, database_engine: "PostgreSQL" });
    await ready();
    await screen.findByLabelText("Application and database information");
    expect(screen.queryByRole("button", { name: "Download backup" })).toBeNull();
    expect(screen.getByText(/AWS RDS/)).toBeTruthy();
  });

  it("a normal user sees their own counts but no server details and no backup", async () => {
    setSession({ email: "user@example.com", role: "user" });
    svc.dataInfo.mockResolvedValue({ counts: INFO.counts, application: null, api_version: null, environment: null, timezone: null,
      database_engine: null, schema_version: null, database_size_bytes: null, backup_includes: [] });
    await ready();
    const list = await screen.findByLabelText("Application and database information");
    expect(within(list).getByText("Exercises")).toBeTruthy();
    expect(within(list).getByText("Logged workouts")).toBeTruthy();
    for (const hidden of ["Application", "Database", "Schema version", "Timezone"]) expect(within(list).queryByText(hidden)).toBeNull();
    expect(screen.queryByRole("button", { name: "Download backup" })).toBeNull();
    expect(screen.queryByText(/AWS RDS/)).toBeNull();
    expect(screen.queryByRole("heading", { name: "Backup" })).toBeNull();
  });

  it("the admin sees the server details and the backup", async () => {
    await ready();
    const list = await screen.findByLabelText("Application and database information");
    for (const shown of ["Application", "Database", "Schema version", "Timezone", "Exercises"]) expect(within(list).getByText(shown)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download backup" })).toBeTruthy();
  });

  it("hides the whole-database backup from normal users", async () => {
    setSession({ email: "user@example.com", role: "user" });
    await ready();
    await screen.findByLabelText("Application and database information");
    expect(screen.queryByRole("button", { name: "Download backup" })).toBeNull();
  });

  it("downloads a backup once even if tapped repeatedly", async () => {
    const created: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => { created.push(b); return "blob:x"; });
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    let finish!: (v: { blob: Blob; filename: string }) => void;
    svc.downloadBackup.mockImplementation(() => new Promise((res) => { finish = res; }));
    await ready();
    const button = await screen.findByRole("button", { name: "Download backup" });
    fireEvent.click(button);
    fireEvent.click(button);
    await screen.findByRole("button", { name: "Preparing backup…" });
    await act(async () => finish({ blob: new Blob(["SQLite format 3"]), filename: "gym-planner-backup-20261119-1030.db" }));
    expect(await screen.findByText(/Backup downloaded \(gym-planner-backup-20261119-1030.db\)/)).toBeTruthy();
    expect(svc.downloadBackup).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(1);
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });

  it("shows an error and allows retry when the backup fails", async () => {
    svc.downloadBackup.mockRejectedValueOnce(new ApiError({ kind: "network", message: "Can't reach the server." }));
    await ready();
    await userEvent.click(await screen.findByRole("button", { name: "Download backup" }));
    expect(await screen.findByText("Can't reach the server.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download backup" }).hasAttribute("disabled")).toBe(false);
  });
});

describe("mobile input behaviour", () => {
  it("uses numeric keyboards, no autofill on numbers, and sensible attributes", async () => {
    await ready();
    for (const label of ["Rest between sets", "Rest between exercises", "Workout duration target"]) {
      const input = field(label);
      expect(input.getAttribute("inputmode")).toBe("numeric");
      expect(input.getAttribute("autocomplete")).toBe("off");
      expect(input.getAttribute("enterkeyhint")).toBe("done");
    }
    expect(field(/Display name/).getAttribute("autocomplete")).toBe("nickname");
  });

  it("every control has an accessible name and radios are grouped", async () => {
    await ready();
    expect(screen.getAllByRole("radio").length).toBe(2 + 2 + 2 + 3);
    for (const legend of ["Weight unit", "Distance unit", "First day of week", "Date format"]) {
      expect(screen.getByRole("group", { name: legend })).toBeTruthy();
    }
  });

  it("submits with the keyboard (Enter in a field)", async () => {
    await ready();
    await userEvent.click(screen.getByRole("radio", { name: "lbs" }));
    await userEvent.type(field("Rest between sets"), "{Enter}");
    await waitFor(() => expect(svc.update).toHaveBeenCalledTimes(1));
  });
});
