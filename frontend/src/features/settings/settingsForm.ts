import type { DateFormat, ResetSection, Settings, SettingsValues } from "../../types/settings";
import { parseDateOnly } from "../../utils/date";

/** The form edits strings (so a field can be empty while typing); `parseDraft` turns them into API values. */
export interface Draft {
  display_name: string;
  rest_between_sets_seconds: string;
  rest_between_exercises_seconds: string;
  target_workout_minutes: string;
  weight_unit: SettingsValues["weight_unit"];
  distance_unit: SettingsValues["distance_unit"];
  week_start: SettingsValues["week_start"];
  date_format: DateFormat;
}
export type DraftField = keyof Draft;

export const LIMITS = { restMax: 3600, minutesMax: 600, nameMax: 50 } as const;

/** Mirrors backend `settings_service.DEFAULTS` (the server is the source of truth for resets). */
export const DEFAULTS: SettingsValues = {
  display_name: null, rest_between_sets_seconds: 90, rest_between_exercises_seconds: 120, target_workout_minutes: 60,
  weight_unit: "kg", distance_unit: "km", week_start: "monday", date_format: "DD MMM YYYY",
};

export const SECTION_FIELDS: Record<Exclude<ResetSection, "all">, DraftField[]> = {
  workout: ["rest_between_sets_seconds", "rest_between_exercises_seconds", "target_workout_minutes", "weight_unit", "distance_unit"],
  calendar: ["week_start", "date_format"],
  personal: ["display_name"],
};
export const SECTION_TITLES: Record<Exclude<ResetSection, "all">, string> = {
  workout: "Workout Preferences", calendar: "Calendar Preferences", personal: "Personal Preferences",
};

export const DATE_FORMATS: DateFormat[] = ["DD/MM/YYYY", "DD MMM YYYY", "YYYY-MM-DD"];

export function toDraft(s: SettingsValues): Draft {
  return {
    display_name: s.display_name ?? "",
    rest_between_sets_seconds: String(s.rest_between_sets_seconds),
    rest_between_exercises_seconds: String(s.rest_between_exercises_seconds),
    target_workout_minutes: String(s.target_workout_minutes),
    weight_unit: s.weight_unit, distance_unit: s.distance_unit, week_start: s.week_start, date_format: s.date_format,
  };
}

/** Copy one section's values from `source` into `base` (used after a server-side section reset). */
export function applySection(base: Draft, source: Draft, section: Exclude<ResetSection, "all">): Draft {
  const next = { ...base };
  for (const f of SECTION_FIELDS[section]) (next as Record<DraftField, string>)[f] = source[f];
  return next;
}

export function isDirty(draft: Draft, saved: Settings | SettingsValues): boolean {
  const base = toDraft(saved);
  return (Object.keys(base) as DraftField[]).some((k) => (k === "display_name" ? draft[k].trim() !== base[k] : draft[k] !== base[k]));
}

export function sectionIsDirty(draft: Draft, saved: Settings, section: Exclude<ResetSection, "all">): boolean {
  const base = toDraft(saved);
  return SECTION_FIELDS[section].some((k) => draft[k] !== base[k]);
}

function wholeNumber(raw: string, label: string, min: number, max: number): { value?: number; error?: string } {
  const text = raw.trim();
  if (text === "") return { error: `Enter ${label}.` };
  if (/^-/.test(text)) return { error: "This can't be negative." };
  if (!/^\d+$/.test(text)) return { error: "Use a whole number, e.g. 90." };
  const value = Number(text);
  if (value < min) return { error: min === 0 ? "This can't be negative." : `Must be at least ${min}.` };
  if (value > max) return { error: `Must be ${max.toLocaleString("en-IN")} or less.` };
  return { value };
}

export interface ParseResult { values: SettingsValues | null; errors: Partial<Record<DraftField, string>> }

export function parseDraft(d: Draft): ParseResult {
  const errors: ParseResult["errors"] = {};
  const sets = wholeNumber(d.rest_between_sets_seconds, "a rest time in seconds", 0, LIMITS.restMax);
  const between = wholeNumber(d.rest_between_exercises_seconds, "a rest time in seconds", 0, LIMITS.restMax);
  const minutes = wholeNumber(d.target_workout_minutes, "a duration in minutes", 1, LIMITS.minutesMax);
  if (sets.error) errors.rest_between_sets_seconds = sets.error;
  if (between.error) errors.rest_between_exercises_seconds = between.error;
  if (minutes.error) errors.target_workout_minutes = minutes.error;
  const name = d.display_name.trim().replace(/\s+/g, " ");
  if (name.length > LIMITS.nameMax) errors.display_name = `Keep it to ${LIMITS.nameMax} characters or fewer.`;
  if (Object.keys(errors).length > 0) return { values: null, errors };
  return {
    errors,
    values: {
      display_name: name === "" ? null : name,
      rest_between_sets_seconds: sets.value!, rest_between_exercises_seconds: between.value!,
      target_workout_minutes: minutes.value!,
      weight_unit: d.weight_unit, distance_unit: d.distance_unit, week_start: d.week_start, date_format: d.date_format,
    },
  };
}

/** "90" -> "1 min 30 s". Empty for anything that is not a valid non-negative whole number. */
export function describeSeconds(raw: string): string {
  if (!/^\d+$/.test(raw.trim())) return "";
  const total = Number(raw);
  if (total < 60) return `${total} s`;
  const m = Math.floor(total / 60), s = total % 60;
  return s === 0 ? `${m} min` : `${m} min ${s} s`;
}

/** "75" -> "1 h 15 min". */
export function describeMinutes(raw: string): string {
  if (!/^\d+$/.test(raw.trim())) return "";
  const total = Number(raw);
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60), m = total % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Show a stored "YYYY-MM-DD" date in the chosen display format. Display only: the stored date never changes. */
export function formatWithPreference(iso: string, format: DateFormat): string {
  const d = parseDateOnly(iso);
  const y = String(d.getUTCFullYear()), m = d.getUTCMonth(), day = d.getUTCDate();
  const dd = String(day).padStart(2, "0");
  if (format === "DD/MM/YYYY") return `${dd}/${String(m + 1).padStart(2, "0")}/${y}`;
  if (format === "DD MMM YYYY") return `${dd} ${MONTHS[m]} ${y}`;
  return `${y}-${String(m + 1).padStart(2, "0")}-${dd}`;
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return "Unknown";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Trigger a browser download for in-memory data. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
