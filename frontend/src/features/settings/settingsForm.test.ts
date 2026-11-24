import { describe, expect, it } from "vitest";
import {
  DEFAULTS, applySection, describeMinutes, describeSeconds, formatBytes, formatWithPreference,
  isDirty, parseDraft, sectionIsDirty, toDraft,
} from "./settingsForm";
import { filenameFrom } from "../../services/settingsService";
import type { Settings } from "../../types/settings";

const SAVED: Settings = { ...DEFAULTS, updated_at: "2026-11-19T10:00:00Z" };

describe("parseDraft", () => {
  it("accepts the defaults", () => {
    const r = parseDraft(toDraft(DEFAULTS));
    expect(r.errors).toEqual({});
    expect(r.values).toEqual(DEFAULTS);
  });

  it("trims and collapses the display name; blank becomes null", () => {
    expect(parseDraft({ ...toDraft(DEFAULTS), display_name: "  Gokul   K " }).values?.display_name).toBe("Gokul K");
    expect(parseDraft({ ...toDraft(DEFAULTS), display_name: "   " }).values?.display_name).toBeNull();
  });

  it.each([
    ["rest_between_sets_seconds", "-1", /negative/],
    ["rest_between_sets_seconds", "", /Enter/],
    ["rest_between_sets_seconds", "abc", /whole number/],
    ["rest_between_sets_seconds", "1.5", /whole number/],
    ["rest_between_sets_seconds", "3601", /3,600 or less/],
    ["rest_between_exercises_seconds", "-30", /negative/],
    ["target_workout_minutes", "0", /at least 1/],
    ["target_workout_minutes", "-5", /negative/],
    ["target_workout_minutes", "601", /600 or less/],
    ["display_name", "x".repeat(51), /50 characters/],
  ] as const)("rejects %s = %j", (field, value, message) => {
    const r = parseDraft({ ...toDraft(DEFAULTS), [field]: value });
    expect(r.values).toBeNull();
    expect(r.errors[field]).toMatch(message);
  });

  it("allows 0 seconds of rest and the maximums", () => {
    const r = parseDraft({ ...toDraft(DEFAULTS), rest_between_sets_seconds: "0", rest_between_exercises_seconds: "3600", target_workout_minutes: "600" });
    expect(r.values).toMatchObject({ rest_between_sets_seconds: 0, rest_between_exercises_seconds: 3600, target_workout_minutes: 600 });
  });

  it("reports every invalid field at once", () => {
    const r = parseDraft({ ...toDraft(DEFAULTS), rest_between_sets_seconds: "-1", target_workout_minutes: "0" });
    expect(Object.keys(r.errors).sort()).toEqual(["rest_between_sets_seconds", "target_workout_minutes"]);
  });
});

describe("dirty tracking", () => {
  it("is clean for an untouched draft and ignores whitespace-only name changes", () => {
    expect(isDirty(toDraft(SAVED), SAVED)).toBe(false);
    expect(isDirty({ ...toDraft(SAVED), display_name: "  " }, SAVED)).toBe(false);
  });
  it("detects a change in any field", () => {
    expect(isDirty({ ...toDraft(SAVED), weight_unit: "lbs" }, SAVED)).toBe(true);
    expect(isDirty({ ...toDraft(SAVED), rest_between_sets_seconds: "91" }, SAVED)).toBe(true);
    expect(isDirty({ ...toDraft(SAVED), display_name: "A" }, SAVED)).toBe(true);
  });
  it("tracks a single section", () => {
    const d = { ...toDraft(SAVED), week_start: "sunday" as const };
    expect(sectionIsDirty(d, SAVED, "calendar")).toBe(true);
    expect(sectionIsDirty(d, SAVED, "workout")).toBe(false);
  });
  it("applySection replaces only that section", () => {
    const base = { ...toDraft(SAVED), week_start: "sunday" as const, weight_unit: "lbs" as const };
    const next = applySection(base, toDraft(SAVED), "workout");
    expect(next.weight_unit).toBe("kg");
    expect(next.week_start).toBe("sunday");
  });
});

describe("display helpers", () => {
  it("formats a stored date in each preference without shifting the day", () => {
    expect(formatWithPreference("2026-11-19", "DD/MM/YYYY")).toBe("19/11/2026");
    expect(formatWithPreference("2026-11-19", "DD MMM YYYY")).toBe("19 Nov 2026");
    expect(formatWithPreference("2026-11-19", "YYYY-MM-DD")).toBe("2026-11-19");
    expect(formatWithPreference("2027-01-01", "DD MMM YYYY")).toBe("01 Jan 2027");
    expect(formatWithPreference("2028-02-29", "DD/MM/YYYY")).toBe("29/02/2028");
  });
  it("describes durations", () => {
    expect(describeSeconds("90")).toBe("1 min 30 s");
    expect(describeSeconds("45")).toBe("45 s");
    expect(describeSeconds("120")).toBe("2 min");
    expect(describeSeconds("-1")).toBe("");
    expect(describeSeconds("")).toBe("");
    expect(describeMinutes("75")).toBe("1 h 15 min");
    expect(describeMinutes("60")).toBe("1 h");
    expect(describeMinutes("45")).toBe("45 min");
  });
  it("formats sizes", () => {
    expect(formatBytes(null)).toBe("Unknown");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
  it("takes a safe filename from Content-Disposition", () => {
    expect(filenameFrom('attachment; filename="gym-planner-backup-20261119-1030.db"')).toBe("gym-planner-backup-20261119-1030.db");
    expect(filenameFrom(null)).toBe("gym-planner-backup.db");
    expect(filenameFrom('attachment; filename="../../evil.db"')).toBe("gym-planner-backup.db");
  });
});
