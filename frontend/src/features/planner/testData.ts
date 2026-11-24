import type {
  CardioActivity, CycleDetail, CycleSummary, DayDetail, DaySummary, ScheduledExercise, WeekDetail,
} from "../../types/planner";
import { addDays } from "../../utils/date";

export const CARDIO: CardioActivity[] = [{ id: 1, name: "Walking" }, { id: 2, name: "Running" }, { id: 3, name: "Treadmill" }];

export function makeCycle(over: Partial<CycleSummary> = {}): CycleSummary {
  return {
    id: 1, name: "Winter Block", description: "Eight weeks.", start_date: "2026-11-16", end_date: "2027-01-10", total_weeks: 8,
    status: "active", planned_days: 3, rest_days: 1, exercise_count: 8, cardio_count: 1,
    created_at: "2026-11-18T10:00:00Z", updated_at: "2026-11-18T10:00:00Z", ...over,
  };
}

export function makeCycleDetail(over: Partial<CycleSummary> = {}): CycleDetail {
  const c = makeCycle(over);
  return {
    ...c,
    weeks: Array.from({ length: c.total_weeks }, (_, i) => ({
      id: i + 1, week_number: i + 1, name: null, notes: null,
      start_date: addDays(c.start_date, 7 * i), end_date: addDays(c.start_date, 7 * i + 6),
      planned_days: i === 0 ? 3 : 0, rest_days: i === 0 ? 1 : 0, exercise_count: 0, cardio_count: 0,
    })),
  };
}

export function daySummary(dow: number, start = "2026-11-16", over: Partial<DaySummary> = {}): DaySummary {
  return {
    day_of_week: dow, date: addDays(start, dow), schedule_id: null, status: "unplanned", kind: "empty", title: null,
    display_title: null, notes: null, muscle_groups: [], exercise_count: 0, cardio_count: 0, ...over,
  };
}

export function makeWeek(weekNumber = 1, overrides: Record<number, Partial<DaySummary>> = {}, cycle = makeCycle()): WeekDetail {
  const start = addDays(cycle.start_date, 7 * (weekNumber - 1));
  return {
    cycle: { id: cycle.id, name: cycle.name, status: cycle.status, start_date: cycle.start_date, end_date: cycle.end_date, total_weeks: cycle.total_weeks },
    week_id: weekNumber, week_number: weekNumber, name: null, notes: null, start_date: start, end_date: addDays(start, 6),
    days: Array.from({ length: 7 }, (_, d) => daySummary(d, start, overrides[d] ?? {})),
  };
}

export function plannedExercise(id: number, order: number, name: string, over: Partial<ScheduledExercise> = {}): ScheduledExercise {
  return {
    id, order, target_sets: 3, target_reps: "10", target_weight_kg: null, rest_seconds: null, notes: null,
    exercise: { id: 100 + id, name, is_active: true, muscle_group: { id: 1, name: "Chest" },
      target_area: { id: 2, name: "Middle Chest", muscle_group_id: 1 }, workout_type: { id: 1, name: "Barbell" } },
    ...over,
  };
}

export function makeDay(over: Partial<DayDetail> = {}): DayDetail {
  return {
    cycle_id: 1, week_number: 1, day_of_week: 0, date: "2026-11-16", schedule_id: null, status: "unplanned", kind: "empty",
    title: null, display_title: null, notes: null, muscle_groups: [], exercise_count: 0, cardio_count: 0, strength: [], cardio: [], ...over,
  };
}

/** Monday with Chest: Bench Press + Cable Fly. */
export function chestDay(over: Partial<DayDetail> = {}): DayDetail {
  const items = [plannedExercise(11, 1, "Barbell Bench Press", { target_sets: 4, target_reps: "6-8", target_weight_kg: 80, rest_seconds: 120 }),
    plannedExercise(12, 2, "Cable Fly")];
  return makeDay({
    schedule_id: 5, status: "planned", kind: "strength", display_title: "Chest", muscle_groups: [{ id: 1, name: "Chest" }],
    exercise_count: 2, strength: [{ id: 21, muscle_group: { id: 1, name: "Chest" }, notes: null, exercises: items }], ...over,
  });
}

export function cardioDay(over: Partial<DayDetail> = {}): DayDetail {
  return makeDay({
    day_of_week: 5, date: "2026-11-21", schedule_id: 9, status: "planned", kind: "cardio", display_title: "Cardio", cardio_count: 1,
    cardio: [{ id: 31, cardio_activity: { id: 2, name: "Running" }, duration_minutes: 40, distance_km: 5, notes: null }], ...over,
  });
}
