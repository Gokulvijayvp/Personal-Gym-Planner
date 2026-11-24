import { APP_TIMEZONE } from "../../config/env";
import type { DateString } from "../../types/api";
import type { CycleBrief } from "../../types/planner";
import type { ActiveCycleCard, CycleCounts, WeekDay } from "../../types/dashboard";
import { formatDateOnly } from "../../utils/date";
import { KIND_NAME } from "../calendar/calendarLogic";

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Hour of day (0-23) in the app timezone, never the browser's. */
export function hourInAppTz(now: Date = new Date(), timeZone: string = APP_TIMEZONE): number {
  const hour = new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone }).format(now);
  return Number(hour) % 24;
}

export type Greeting = "Good morning" | "Good afternoon" | "Good evening";

export function greetingFor(hour: number): Greeting {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  return "Good evening";
}

/** "Good evening, Gokul" or, with no name set, a friendly generic line. */
export function greetingText(hour: number, displayName: string | null): string {
  const base = greetingFor(hour);
  return displayName ? `${base}, ${displayName}` : base;
}

/** Opens that day in the Weekly Planner (same link the Calendar's Day view uses). */
export function plannerDayLink(cycleId: number, weekNumber: number, dayOfWeek: number): string {
  return `/planner?cycle=${cycleId}&week=${weekNumber}&day=${dayOfWeek}`;
}

export function plannerWeekLink(cycleId: number, weekNumber: number | null): string {
  return weekNumber ? `/planner?cycle=${cycleId}&week=${weekNumber}` : `/planner?cycle=${cycleId}`;
}

/** One-line status under the active cycle's name. `fmt` formats a stored date using the user's preference. */
export function cycleStatusLine(card: ActiveCycleCard, fmt: (d: DateString) => string): string {
  const weeks = card.cycle.total_weeks;
  if (card.state === "in_progress") return `Week ${card.current_week} of ${weeks}`;
  if (card.state === "upcoming") {
    const n = card.days_until_start ?? 0;
    return n === 1 ? "Starts tomorrow" : `Starts in ${plural(n, "day")}`;
  }
  return `Ended on ${fmt(card.cycle.end_date)}`;
}

export interface NoCycleMessage { title: string; text: string; action: string }

/** What to say when no cycle is active, based on what does exist. */
export function noActiveCycleMessage(counts: CycleCounts, other: CycleBrief | null): NoCycleMessage {
  if (!other) return { title: "No workout cycle yet", text: "Create your first cycle to start planning your weeks.", action: "Create a cycle" };
  if (other.status === "draft") {
    return { title: "No active cycle", text: `"${other.name}" is still a draft. Activate it in Workout Cycles to see it here.`, action: "Open Workout Cycles" };
  }
  if (other.status === "completed") {
    return { title: "No active cycle", text: `Your latest cycle, "${other.name}", is completed. Create a new one to keep planning.`, action: "Open Workout Cycles" };
  }
  return { title: "No active cycle", text: `Only archived cycles exist (${counts.archived}). Create a new cycle to keep planning.`, action: "Open Workout Cycles" };
}

/** Sentence for screen readers: "Thursday 19 Nov 2026: Strength, Chest and Triceps, 5 exercises". */
export function describeWeekDay(day: WeekDay, fmt: (d: DateString) => string): string {
  const when = `${formatDateOnly(day.date, { weekday: "long" })} ${fmt(day.date)}`;
  if (!day.cycle || !day.plan) return `${when}: no active cycle`;
  const kind = KIND_NAME[day.plan.kind];
  const groups = day.plan.muscle_groups.map((g) => g.name).join(", ");
  const count = day.plan.exercise_count > 0 ? `, ${plural(day.plan.exercise_count, "exercise")}` : "";
  return `${when}${day.is_today ? " (today)" : ""}: ${kind}${groups ? `, ${groups}` : ""}${count}`;
}
