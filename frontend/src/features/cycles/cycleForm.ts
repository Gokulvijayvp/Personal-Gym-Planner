import type { DateString } from "../../types/api";
import type { CycleInput, CycleStatus, CycleSummary } from "../../types/planner";
import { addDays, formatDateOnly, parseDateOnly, todayISO, weekdayIndex } from "../../utils/date";

export const MAX_WEEKS = 52;
export const WEEK_PRESETS = [4, 6, 8, 12] as const;

export interface CycleFormValues { name: string; description: string; startDate: string; totalWeeks: string }
export type CycleFormErrors = Partial<Record<"name" | "description" | "start_date" | "total_weeks", string>>;

export const STATUS_LABEL: Record<CycleStatus, string> = {
  draft: "Draft", active: "Active", completed: "Completed", archived: "Archived",
};

/** The Monday on or after `from` (cycles always start on a Monday). */
export function nextMonday(from: DateString): DateString {
  const idx = weekdayIndex(from);
  return idx === 0 ? from : addDays(from, 7 - idx);
}

export function emptyCycleForm(now: Date = new Date()): CycleFormValues {
  return { name: "", description: "", startDate: nextMonday(todayISO(now)), totalWeeks: "8" };
}

export function valuesFromCycle(c: CycleSummary): CycleFormValues {
  return { name: c.name, description: c.description ?? "", startDate: c.start_date, totalWeeks: String(c.total_weeks) };
}

export const isMondayDate = (d: DateString) => weekdayIndex(d) === 0;

/** Last day of a cycle: start + 7 x weeks - 1 days. Same formula as the backend. null if inputs aren't valid yet. */
export function computeEndDate(startDate: string, totalWeeks: string): DateString | null {
  const weeks = Number(totalWeeks);
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > MAX_WEEKS) return null;
  try {
    parseDateOnly(startDate);
  } catch {
    return null;
  }
  return addDays(startDate, 7 * weeks - 1);
}

export function validateCycleForm(v: CycleFormValues): CycleFormErrors {
  const errors: CycleFormErrors = {};
  const name = v.name.replace(/\s+/g, " ").trim();
  if (!name) errors.name = "Enter a cycle name.";
  else if (name.length < 2) errors.name = "Name must be at least 2 characters.";
  else if (name.length > 120) errors.name = "Name must be at most 120 characters.";
  if (v.description.trim().length > 2000) errors.description = "Keep the description under 2000 characters.";

  if (!v.startDate) errors.start_date = "Choose a start date.";
  else {
    try {
      parseDateOnly(v.startDate);
      const year = Number(v.startDate.slice(0, 4));
      if (year < 2000 || year > 2100) errors.start_date = "Start date must be between 2000 and 2100.";
      else if (!isMondayDate(v.startDate)) errors.start_date = "A cycle must start on a Monday so every week runs Monday to Sunday.";
    } catch {
      errors.start_date = "Enter a valid date.";
    }
  }

  const weeks = Number(v.totalWeeks);
  if (v.totalWeeks.trim() === "" || !Number.isInteger(weeks)) errors.total_weeks = "Enter a whole number of weeks.";
  else if (weeks < 1 || weeks > MAX_WEEKS) errors.total_weeks = `Weeks must be between 1 and ${MAX_WEEKS}.`;
  return errors;
}

export function toCycleInput(v: CycleFormValues): CycleInput {
  return {
    name: v.name.replace(/\s+/g, " ").trim(),
    description: v.description.trim() || null,
    start_date: v.startDate,
    total_weeks: Number(v.totalWeeks),
  };
}

export function formatRange(start: DateString, end: DateString): string {
  const short: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return `${formatDateOnly(start, sameYear ? short : { ...short, year: "numeric" })} – ${formatDateOnly(end, { ...short, year: "numeric" })}`;
}

export interface GroupedCycles { active: CycleSummary[]; drafts: CycleSummary[]; previous: CycleSummary[] }

/** Active first; drafts (upcoming); previous = completed + archived, newest first. */
export function groupCycles(cycles: CycleSummary[]): GroupedCycles {
  const byStartDesc = (a: CycleSummary, b: CycleSummary) => b.start_date.localeCompare(a.start_date) || b.id - a.id;
  return {
    active: cycles.filter((c) => c.status === "active").sort(byStartDesc),
    drafts: cycles.filter((c) => c.status === "draft").sort(byStartDesc),
    previous: cycles.filter((c) => c.status === "completed" || c.status === "archived").sort(byStartDesc),
  };
}
