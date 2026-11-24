import type { DateString } from "../../types/api";
import type { DateFormat, DistanceUnit, WeightUnit } from "../../types/settings";
import { addDays, addMonths, parseDateOnly, todayISO } from "../../utils/date";
import { formatWithPreference } from "../settings/settingsForm";
import type { RangeQuery } from "../../services/progressService";

// ---- date range ------------------------------------------------------------------------------------

export type Preset = "7d" | "30d" | "90d" | "6m" | "12m" | "all" | "custom";
export const PRESETS: { value: Preset; label: string }[] = [
  { value: "7d", label: "Last 7 days" }, { value: "30d", label: "Last 30 days" }, { value: "90d", label: "Last 90 days" },
  { value: "6m", label: "Last 6 months" }, { value: "12m", label: "Last 12 months" }, { value: "all", label: "All time" },
  { value: "custom", label: "Custom range" },
];
export const DEFAULT_PRESET: Preset = "30d";

export interface RangeSelection { preset: Preset; from: DateString; to: DateString }

const ISO = /^\d{4}-\d{2}-\d{2}$/;
export function isValidDate(value: string): boolean {
  if (!ISO.test(value)) return false;
  try { parseDateOnly(value); return true; } catch { return false; }
}

export function parseRangeParams(p: URLSearchParams): RangeSelection {
  const raw = p.get("range") as Preset | null;
  const preset = PRESETS.some((x) => x.value === raw) ? (raw as Preset) : DEFAULT_PRESET;
  return { preset, from: p.get("from") ?? "", to: p.get("to") ?? "" };
}

/** What to ask the API for. "Last N days" includes today; calendar dates are Asia/Kolkata, never the browser's. */
export function rangeQuery(sel: RangeSelection, today: DateString = todayISO()): RangeQuery | null {
  switch (sel.preset) {
    case "7d": return { start: addDays(today, -6), end: today };
    case "30d": return { start: addDays(today, -29), end: today };
    case "90d": return { start: addDays(today, -89), end: today };
    case "6m": return { start: addDays(addMonths(today, -6), 1), end: today };
    case "12m": return { start: addDays(addMonths(today, -12), 1), end: today };
    case "all": return {};
    case "custom":
      if (!isValidDate(sel.from) || !isValidDate(sel.to) || sel.to < sel.from) return null;
      return { start: sel.from, end: sel.to };
  }
}

export function customError(sel: RangeSelection): string | null {
  if (sel.preset !== "custom") return null;
  if (!sel.from || !sel.to) return "Choose both a start and an end date.";
  if (!isValidDate(sel.from) || !isValidDate(sel.to)) return "Enter valid dates.";
  if (sel.to < sel.from) return "The end date must be on or after the start date.";
  return null;
}

// ---- units: values arrive in kg / km and are converted only for display ---------------------------------

const LBS_PER_KG = 2.2046226218;
const MILES_PER_KM = 0.6213711922;

function trim(n: number, places: number): string {
  const t = n.toFixed(places);
  return t.includes(".") ? t.replace(/\.?0+$/, "") : t;
}
const group = (n: number) => Math.round(n).toLocaleString("en-IN");

export const weightValue = (kg: number, unit: WeightUnit) => (unit === "lbs" ? kg * LBS_PER_KG : kg);
export const distanceValue = (km: number, unit: DistanceUnit) => (unit === "miles" ? km * MILES_PER_KM : km);

/** A single lifted weight: "62.5 kg" / "137.8 lbs". */
export function formatWeight(kg: number, unit: WeightUnit): string {
  return `${trim(weightValue(kg, unit), unit === "lbs" ? 1 : 2)} ${unit}`;
}

/** Aggregate training volume, rounded for display: "12,340 kg". */
export function formatVolume(kg: number, unit: WeightUnit): string {
  return `${group(weightValue(kg, unit))} ${unit}`;
}

/** The volume of one set can be small, so keep a decimal: "1,512.5 kg". */
export function formatSetVolume(kg: number, unit: WeightUnit): string {
  const v = weightValue(kg, unit);
  return `${v >= 10000 ? group(v) : Number(trim(v, 1)).toLocaleString("en-IN")} ${unit}`;
}

export function formatDistance(km: number, unit: DistanceUnit): string {
  return `${trim(distanceValue(km, unit), 2)} ${unit}`;
}

export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function formatSeconds(seconds: number): string {
  return formatMinutes(Math.round(seconds / 60));
}

// ---- dates for axes and tables, in the user's chosen format --------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Compact axis label that follows the date-format setting: "02 Nov", "02/11" or "11-02". */
export function axisDate(iso: DateString, format: DateFormat): string {
  const [, m, d] = iso.split("-");
  return format === "DD/MM/YYYY" ? `${d}/${m}` : format === "YYYY-MM-DD" ? `${m}-${d}` : `${d} ${MONTHS[+m - 1]}`;
}

/** "2026-11" -> "Nov 2026" / "11/2026" / "2026-11". */
export function monthLabel(yyyymm: string, format: DateFormat): string {
  const [y, m] = yyyymm.split("-");
  return format === "DD/MM/YYYY" ? `${m}/${y}` : format === "YYYY-MM-DD" ? yyyymm : `${MONTHS[+m - 1]} ${y}`;
}

export const fullDate = (iso: DateString, format: DateFormat) => formatWithPreference(iso, format);

export function describeRange(start: DateString | null, end: DateString, format: DateFormat): string {
  return start ? `${fullDate(start, format)} – ${fullDate(end, format)}` : "No completed workouts yet";
}

// ---- chart maths ---------------------------------------------------------------------------------------

/** A tidy upper bound and tick step for a bar chart that starts at zero. */
export function niceScale(max: number, targetTicks = 4): { max: number; step: number } {
  if (!(max > 0)) return { max: 1, step: 1 };
  const raw = max / targetTicks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow;
  return { max: Math.ceil(max / step) * step, step };
}

/** Axis bounds for a line chart around the data (it does not have to start at zero, and says so).
 *  With `integer` the ticks are whole numbers, so a reps axis can never show a half rep rounded into a wrong label. */
export function lineScale(min: number, max: number, targetTicks = 4, integer = false): { min: number; max: number; step: number } {
  if (min === max) { const pad = Math.max(1, Math.abs(min) * 0.1); return lineScale(min - pad, max + pad, targetTicks, integer); }
  const raw = (max - min) / targetTicks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  let step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow;
  if (integer) step = Math.max(1, Math.ceil(step));
  return { min: Math.floor(min / step) * step, max: Math.ceil(max / step) * step, step };
}

/** Which labels to show so they never collide: every nth, always including the last. */
export function labelIndexes(count: number, maxLabels: number): number[] {
  if (count <= maxLabels) return Array.from({ length: count }, (_, i) => i);
  const step = Math.ceil(count / maxLabels);
  const idx: number[] = [];
  for (let i = count - 1; i >= 0; i -= step) idx.unshift(i);
  return idx;
}

export function daysBetween(a: DateString, b: DateString): number {
  return Math.round((parseDateOnly(b).getTime() - parseDateOnly(a).getTime()) / 86400000);
}
