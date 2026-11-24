/**
 * Date helpers. Rules:
 *  - API timestamps ("...Z", UTC) are shown in the app timezone (Asia/Kolkata).
 *  - Calendar dates ("YYYY-MM-DD") are timezone-less: never pass them through `new Date("YYYY-MM-DD")`
 *    in local time, that is what causes off-by-one-day bugs. They are handled as UTC-midnight here.
 *  - "Today" is today in the app timezone, not the browser's.
 */
import { APP_TIMEZONE } from "../config/env";
import type { DateString, UtcDateTimeString } from "../types/api";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's date (YYYY-MM-DD) in the app timezone. `now` is injectable for tests. */
export function todayISO(now: Date = new Date(), timeZone: string = APP_TIMEZONE): DateString {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Parse "YYYY-MM-DD" to a Date at UTC midnight (safe from timezone shifts). */
export function parseDateOnly(value: DateString): Date {
  if (!ISO_DATE.test(value)) throw new RangeError(`Invalid date "${value}", expected YYYY-MM-DD`);
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw new RangeError(`Invalid calendar date "${value}"`);
  }
  return d;
}

/** Parse an API UTC timestamp. */
export function parseApiDateTime(value: UtcDateTimeString): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new RangeError(`Invalid timestamp "${value}"`);
  return d;
}

const DEFAULT_DATE_FORMAT: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long", year: "numeric" };

/** Format a calendar date, e.g. "Thursday, 19 November 2026". No timezone conversion. */
export function formatDateOnly(value: DateString, options: Intl.DateTimeFormatOptions = DEFAULT_DATE_FORMAT): string {
  return new Intl.DateTimeFormat("en-IN", { ...options, timeZone: "UTC" }).format(parseDateOnly(value));
}

/** Format an instant (Date) as a date in the app timezone. */
export function formatDate(
  value: Date, options: Intl.DateTimeFormatOptions = DEFAULT_DATE_FORMAT, timeZone: string = APP_TIMEZONE,
): string {
  return new Intl.DateTimeFormat("en-IN", { ...options, timeZone }).format(value);
}

/** Format an API UTC timestamp in the app timezone, e.g. "19 Nov 2026, 1:30 am". */
export function formatDateTime(value: UtcDateTimeString, timeZone: string = APP_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone,
  }).format(parseApiDateTime(value));
}

/** Add whole days to a calendar date (pure date math, DST-proof). */
export function addDays(value: DateString, days: number): DateString {
  const d = parseDateOnly(value);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Monday=0 … Sunday=6, matching the backend's DailySchedule.day_of_week. */
export function weekdayIndex(value: DateString): number {
  return (parseDateOnly(value).getUTCDay() + 6) % 7;
}

/** Monday of the week containing the date. */
export function startOfWeek(value: DateString): DateString {
  return addDays(value, -weekdayIndex(value));
}

/** Number of days in the month containing the date (handles leap years). */
export function daysInMonth(value: DateString): number {
  const d = parseDateOnly(value);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

export function startOfMonth(value: DateString): DateString {
  parseDateOnly(value);
  return `${value.slice(0, 8)}01`;
}

export function endOfMonth(value: DateString): DateString {
  return `${value.slice(0, 8)}${String(daysInMonth(value)).padStart(2, "0")}`;
}

/** Move by whole months; the day of month is clamped (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(value: DateString, months: number): DateString {
  const d = parseDateOnly(value);
  const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + months;
  const year = Math.floor(total / 12);
  const month = total - year * 12; // 0-11
  const day = Math.min(d.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  return `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Time of day of an API UTC timestamp in the app timezone, e.g. "1:30 pm". */
export function formatTime(value: UtcDateTimeString, timeZone: string = APP_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone }).format(parseApiDateTime(value));
}
