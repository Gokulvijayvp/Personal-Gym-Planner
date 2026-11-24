import type { ActiveCycleCard, ChecklistItem, Dashboard, WeekDay } from "../../types/dashboard";
import type { CycleBrief, DayDetail, DaySummary } from "../../types/planner";
import { addDays } from "../../utils/date";
import { cardioDay, chestDay, makeDay } from "../planner/testData";

export const WINTER: CycleBrief = {
  id: 1, name: "Winter Block", status: "active", start_date: "2026-11-16", end_date: "2027-01-10", total_weeks: 8,
};

export function summaryOf(plan: DayDetail): DaySummary {
  const { cycle_id: _c, week_number: _w, strength: _s, cardio: _d, ...rest } = plan;
  return rest;
}

/** Thursday 19 Nov 2026, week 1 of Winter Block: Mon chest, Tue rest, Wed cardio, Thu (today) chest + cardio. */
export const THURSDAY_PLAN: DayDetail = chestDay({
  day_of_week: 3, date: "2026-11-19", kind: "mixed", cardio_count: 1, cardio: cardioDay().cardio,
  title: "Push day", display_title: "Push day", notes: "Pause on the chest.",
  muscle_groups: [{ id: 1, name: "Chest" }, { id: 5, name: "Triceps" }],
});

export function weekOf(start: string, today: string, cycle: CycleBrief | null, plans: Record<number, DayDetail | null>, weekNumber = 1): WeekDay[] {
  return Array.from({ length: 7 }, (_, dow) => {
    const date = addDays(start, dow);
    const plan = cycle ? (plans[dow] ?? makeDay({ cycle_id: cycle.id, week_number: weekNumber, day_of_week: dow, date })) : null;
    return {
      date, day_of_week: dow, is_today: date === today, cycle, week_number: cycle ? weekNumber : null,
      plan: plan ? summaryOf({ ...plan, day_of_week: dow, date }) : null,
    };
  });
}

export const MON_PLAN = chestDay({ day_of_week: 0, date: "2026-11-16" });
export const TUE_PLAN = makeDay({ day_of_week: 1, date: "2026-11-17", status: "rest", kind: "rest", display_title: "Rest day" });
export const WED_PLAN = cardioDay({ day_of_week: 2, date: "2026-11-18" });

export function checklist(over: Partial<Record<ChecklistItem["key"], Partial<ChecklistItem>>> = {}): ChecklistItem[] {
  const base: ChecklistItem[] = [
    { key: "exercises", status: "done", count: 12, reason: null },
    { key: "cycle", status: "done", count: 1, reason: null },
    { key: "week_plan", status: "done", count: 3, reason: null },
  ];
  return base.map((i) => ({ ...i, ...(over[i.key] ?? {}) }));
}

export function activeCard(over: Partial<ActiveCycleCard> = {}): ActiveCycleCard {
  return {
    cycle: WINTER, state: "in_progress", current_week: 1, total_days: 56, completed_days: 3, progress_percent: 5,
    days_until_start: null, days_remaining: 53, ...over,
  };
}

export function makeDashboard(over: Partial<Dashboard> = {}): Dashboard {
  const plans = { 0: MON_PLAN, 1: TUE_PLAN, 2: WED_PLAN, 3: THURSDAY_PLAN };
  const items = checklist();
  return {
    date: "2026-11-19", timezone: "Asia/Kolkata",
    cycle_counts: { draft: 0, active: 1, completed: 0, archived: 0 },
    active_cycle: activeCard(), other_cycle: null,
    today: { date: "2026-11-19", day_of_week: 3, cycle: WINTER, week_number: 1, plan: THURSDAY_PLAN, covered_by_inactive: null },
    week: { start: "2026-11-16", end: "2026-11-22", days: weekOf("2026-11-16", "2026-11-19", WINTER, plans) },
    stats: { exercises_total: 12, exercises_active: 11, exercise_sets: 2, active_cycles: 1, planned_days_this_week: 3, rest_days_this_week: 1, planned_exercises_this_week: 6 },
    setup: { items, completed: 3, applicable: 3, all_done: true },
    today_workout: null, in_progress_session: null, recent_activity: [],
    ...over,
  };
}
