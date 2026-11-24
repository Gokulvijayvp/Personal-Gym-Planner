/** Mirrors backend `app.schemas.dashboard`. */
import type { DateString } from "./api";
import type { CycleBrief, DayDetail, DaySummary } from "./planner";
import type { RecentSession, SessionRef } from "./workout";

export type CycleState = "in_progress" | "upcoming" | "ended";
export type ChecklistStatus = "done" | "pending" | "not_applicable";

export interface CycleCounts { draft: number; active: number; completed: number; archived: number }

export interface ActiveCycleCard {
  cycle: CycleBrief;
  state: CycleState;
  current_week: number | null;
  total_days: number;
  completed_days: number;
  progress_percent: number;
  days_until_start: number | null;
  days_remaining: number | null;
}

export interface TodayPlan {
  date: DateString;
  day_of_week: number;
  cycle: CycleBrief | null;
  week_number: number | null;
  plan: DayDetail | null;
  covered_by_inactive: CycleBrief | null;
}

export interface WeekDay {
  date: DateString;
  day_of_week: number;
  is_today: boolean;
  cycle: CycleBrief | null;
  week_number: number | null;
  plan: DaySummary | null;
}

export interface WeekOverview { start: DateString; end: DateString; days: WeekDay[] }

export interface DashboardStats {
  exercises_total: number;
  /** Saved My exercises sets such as "Chest A". */
  exercise_sets: number;
  exercises_active: number;
  active_cycles: number;
  planned_days_this_week: number;
  rest_days_this_week: number;
  planned_exercises_this_week: number;
}

export interface ChecklistItem {
  key: "exercises" | "cycle" | "week_plan";
  status: ChecklistStatus;
  count: number | null;
  reason: string | null;
}

export interface SetupStatus { items: ChecklistItem[]; completed: number; applicable: number; all_done: boolean }

export interface Dashboard {
  date: DateString;
  timezone: string;
  cycle_counts: CycleCounts;
  active_cycle: ActiveCycleCard | null;
  other_cycle: CycleBrief | null;
  today: TodayPlan;
  week: WeekOverview;
  stats: DashboardStats;
  setup: SetupStatus;
  today_workout: SessionRef | null;
  in_progress_session: SessionRef | null;
  recent_activity: RecentSession[];
}
