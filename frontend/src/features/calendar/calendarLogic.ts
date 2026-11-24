import type { DateString } from "../../types/api";
import type { CalendarDay } from "../../types/calendar";
import type { DayKind } from "../../types/planner";
import {
  addDays, addMonths, endOfMonth, formatDateOnly, parseDateOnly, startOfMonth, startOfWeek, todayISO,
} from "../../utils/date";

export type CalendarView = "month" | "week" | "day";
export const VIEWS: CalendarView[] = ["month", "week", "day"];

export interface CalendarState { view: CalendarView; date: DateString }

/** URL -> state. Anything malformed falls back (view = month, date = today in Asia/Kolkata). */
export function parseCalendarParams(params: URLSearchParams, today: DateString = todayISO()): CalendarState {
  const rawView = params.get("view");
  const view = VIEWS.includes(rawView as CalendarView) ? (rawView as CalendarView) : "month";
  let date = today;
  const rawDate = params.get("date");
  if (rawDate) {
    try { parseDateOnly(rawDate); const y = Number(rawDate.slice(0, 4)); if (y >= 2000 && y <= 2100) date = rawDate; } catch { /* keep today */ }
  }
  return { view, date };
}

/** state -> URL. The default view (month) and today's date are omitted to keep addresses short. */
export function serializeCalendarParams(state: CalendarState, today: DateString = todayISO()): URLSearchParams {
  const p = new URLSearchParams();
  if (state.view !== "month") p.set("view", state.view);
  if (state.date !== today) p.set("date", state.date);
  return p;
}

/** The 7 dates (Monday first) of the week containing `date`. */
export function weekDates(date: DateString): DateString[] {
  const monday = startOfWeek(date);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** Month grid: whole Monday..Sunday weeks covering the month (4 to 6 rows). */
export function monthGrid(date: DateString): DateString[][] {
  const first = startOfWeek(startOfMonth(date));
  const last = addDays(startOfWeek(endOfMonth(date)), 6);
  const weeks: DateString[][] = [];
  for (let d = first; d <= last; d = addDays(d, 7)) weeks.push(weekDates(d));
  return weeks;
}

/** Inclusive date range the backend must return for a view. */
export function rangeFor(view: CalendarView, date: DateString): { start: DateString; end: DateString } {
  if (view === "day") return { start: date, end: date };
  if (view === "week") { const w = weekDates(date); return { start: w[0], end: w[6] }; }
  const grid = monthGrid(date);
  return { start: grid[0][0], end: grid[grid.length - 1][6] };
}

/** Previous / next: a month, a week or a day. */
export function shiftDate(view: CalendarView, date: DateString, delta: -1 | 1): DateString {
  if (view === "month") return addMonths(date, delta);
  return addDays(date, delta * (view === "week" ? 7 : 1));
}

export function titleFor(view: CalendarView, date: DateString): string {
  if (view === "month") return formatDateOnly(date, { month: "long", year: "numeric" });
  if (view === "day") return formatDateOnly(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const w = weekDates(date);
  const sameMonth = w[0].slice(0, 7) === w[6].slice(0, 7);
  const sameYear = w[0].slice(0, 4) === w[6].slice(0, 4);
  const start = formatDateOnly(w[0], sameMonth ? { day: "numeric" } : sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
  return `${start} – ${formatDateOnly(w[6], { day: "numeric", month: "short", year: "numeric" })}`;
}

export const KIND_NAME: Record<DayKind, string> = {
  empty: "Not planned", rest: "Rest day", strength: "Strength", cardio: "Cardio", mixed: "Strength + cardio",
};

/** Short text for a month cell: "Chest, Triceps", "Cardio", "Rest"... Long lists are cut with "+N". */
export function compactLabel(day: CalendarDay, maxNames = 2): string {
  const plan = day.plan;
  if (!plan) return "";
  if (plan.kind === "rest") return "Rest";
  if (plan.kind === "cardio") return "Cardio";
  if (plan.kind === "empty") return "";
  const names = plan.muscle_groups.map((g) => g.name);
  const shown = names.slice(0, maxNames).join(", ");
  const more = names.length > maxNames ? ` +${names.length - maxNames}` : "";
  return plan.kind === "mixed" ? `${shown}${more} + cardio` : `${shown}${more}`;
}

/** Sentence for screen readers / tooltips, e.g. "Thursday 19 November: Strength (Chest, Triceps), week 1 of Winter Block". */
export function describeDay(day: CalendarDay): string {
  const when = formatDateOnly(day.date, { weekday: "long", day: "numeric", month: "long" });
  if (!day.cycle || !day.plan) return `${when}: no workout cycle`;
  const kind = KIND_NAME[day.plan.kind];
  const what = day.plan.kind === "strength" || day.plan.kind === "mixed"
    ? ` (${day.plan.muscle_groups.map((g) => g.name).join(", ")})` : "";
  const logged = day.workout ? `, workout ${day.workout.status === "completed" ? "logged" : "in progress"}` : "";
  return `${when}: ${kind}${what}, week ${day.week_number} of ${day.cycle.name}${logged}`;
}
