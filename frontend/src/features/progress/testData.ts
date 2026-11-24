import type {
  Cardio, Consistency, ExerciseOptions, ExerciseProgress, MuscleGroups, Overview, PersonalRecords, RangeInfo, Volume,
} from "../../types/progress";

export const RANGE: RangeInfo = { start: "2026-10-21", end: "2026-11-19", days: 30, all_time: false, end_clamped: false };

export const OVERVIEW: Overview = {
  range: RANGE, workouts: 6, training_days: 6, completed_sets: 54, volume_kg: 12345.6, duration_seconds: 21600,
  average_duration_seconds: 3600, training_days_per_week: 1.4, workouts_per_week: 1.4,
};

export const EMPTY_OVERVIEW: Overview = {
  range: RANGE, workouts: 0, training_days: 0, completed_sets: 0, volume_kg: 0, duration_seconds: 0,
  average_duration_seconds: null, training_days_per_week: null, workouts_per_week: null,
};

export const CONSISTENCY: Consistency = {
  range: RANGE, workouts: 6, training_days: 5, average_workouts_per_week: 1.4, average_training_days_per_week: 1.17,
  weeks: [
    { label: "2026-10-19", start: "2026-10-19", end: "2026-10-25", workouts: 1, training_days: 1, partial: true },
    { label: "2026-10-26", start: "2026-10-26", end: "2026-11-01", workouts: 0, training_days: 0, partial: false },
    { label: "2026-11-02", start: "2026-11-02", end: "2026-11-08", workouts: 3, training_days: 2, partial: false },
    { label: "2026-11-09", start: "2026-11-09", end: "2026-11-15", workouts: 1, training_days: 1, partial: false },
    { label: "2026-11-16", start: "2026-11-16", end: "2026-11-22", workouts: 1, training_days: 1, partial: true },
  ],
  weeks_truncated: false,
  months: [
    { label: "2026-10", start: "2026-10-01", end: "2026-10-31", workouts: 2, training_days: 2, partial: true },
    { label: "2026-11", start: "2026-11-01", end: "2026-11-30", workouts: 4, training_days: 3, partial: true },
  ],
  frequency: [{ label: "0", weeks: 1 }, { label: "1", weeks: 1 }, { label: "2", weeks: 1 }, { label: "3", weeks: 0 }, { label: "4+", weeks: 0 }],
};

export const OPTIONS: ExerciseOptions = {
  range: RANGE,
  exercises: [
    { key: "id:2", exercise_id: 2, name: "Barbell Bench Press", completed_sets: 20, sessions: 5, last_date: "2026-11-16", best_weight_kg: 80 },
    { key: "id:3", exercise_id: 3, name: "Barbell Squat", completed_sets: 12, sessions: 3, last_date: "2026-11-17", best_weight_kg: 120 },
    { key: "id:4", exercise_id: 4, name: "Pull Up", completed_sets: 9, sessions: 3, last_date: "2026-11-12", best_weight_kg: null },
  ],
};

export function exerciseProgress(over: Partial<ExerciseProgress> = {}): ExerciseProgress {
  return {
    range: RANGE, key: "id:2", exercise_id: 2, name: "Barbell Bench Press", completed_sets: 20, sessions: 5, training_days: 5, sessions_per_week: 1.17,
    best_weight: { value: 80, date: "2026-11-16" }, best_reps: { value: 12, date: "2026-10-22" }, total_volume_kg: 6400.5,
    series: [
      { date: "2026-10-22", sets: 4, best_weight_kg: 62.5, reps_at_best_weight: 8, max_reps: 12, total_reps: 36, volume_kg: 2000 },
      { date: "2026-11-02", sets: 4, best_weight_kg: 70, reps_at_best_weight: 6, max_reps: 10, total_reps: 30, volume_kg: 2000 },
      { date: "2026-11-16", sets: 4, best_weight_kg: 80, reps_at_best_weight: 4, max_reps: 8, total_reps: 26, volume_kg: 2400.5 },
    ],
    reps_at_weight: [{ weight_kg: 80, best_reps: 4, date: "2026-11-16" }, { weight_kg: 62.5, best_reps: 8, date: "2026-10-22" }],
    improvement: { from_date: "2026-10-22", to_date: "2026-11-16", from_weight_kg: 62.5, to_weight_kg: 80, change_kg: 17.5, change_percent: 28 },
    improvement_note: null, ...over,
  };
}

export const VOLUME: Volume = {
  range: RANGE, total_volume_kg: 12345.6, counted_sets: 40, excluded_sets: 14,
  weeks: CONSISTENCY.weeks.map((w, i) => ({ label: w.label, start: w.start, end: w.end, volume_kg: [1000, 0, 7000.6, 3000, 1345][i], partial: w.partial })),
  months: [{ label: "2026-10", start: "2026-10-01", end: "2026-10-31", volume_kg: 1000, partial: true }, { label: "2026-11", start: "2026-11-01", end: "2026-11-30", volume_kg: 11345.6, partial: true }],
  by_exercise: [{ name: "Barbell Squat", key: "id:3", volume_kg: 7000, completed_sets: 12 }, { name: "Barbell Bench Press", key: "id:2", volume_kg: 5000, completed_sets: 20 }],
  by_muscle_group: [{ name: "Quadriceps", key: null, volume_kg: 7000, completed_sets: 12 }, { name: "Chest", key: null, volume_kg: 5000, completed_sets: 20 }],
  unassigned_kg: 345.6,
};

export const RECORDS: PersonalRecords = {
  range: RANGE, new_in_range: 2,
  records: [
    { key: "id:2", exercise_id: 2, name: "Barbell Bench Press",
      max_weight: { weight_kg: 80, reps: 4, volume_kg: 320, date: "2026-11-16", session_id: 11, in_range: true },
      max_set_volume: { weight_kg: 62.5, reps: 12, volume_kg: 750, date: "2026-10-22", session_id: 8, in_range: true },
      reps_at_weight: [{ weight_kg: 80, reps: 4, date: "2026-11-16", session_id: 11, in_range: true }, { weight_kg: 62.5, reps: 12, date: "2026-10-22", session_id: 8, in_range: true }],
      max_bodyweight_reps: null },
    { key: "id:4", exercise_id: 4, name: "Pull Up", max_weight: null, max_set_volume: null, reps_at_weight: [],
      max_bodyweight_reps: { reps: 12, date: "2026-09-01", session_id: 5, in_range: false } },
  ],
};

export const MUSCLES: MuscleGroups = {
  range: RANGE, total_sets: 40,
  groups: [
    { name: "Chest", completed_sets: 20, percent_of_sets: 50, sessions: 5, exercises: 2, sessions_per_week: 1.17 },
    { name: "Back", completed_sets: 15, percent_of_sets: 37.5, sessions: 4, exercises: 3, sessions_per_week: null },
    { name: "Unassigned", completed_sets: 5, percent_of_sets: 12.5, sessions: 1, exercises: 1, sessions_per_week: null },
  ],
};

export function cardio(over: Partial<Cardio> = {}): Cardio {
  return {
    range: RANGE, entries: 5, sessions: 4, total_minutes: 135, total_distance_km: 16.1, entries_with_distance: 4, calories_logged: 0, calories_entries: 0,
    activities: [
      { name: "Running", entries: 3, minutes: 90, distance_km: 16.1, entries_with_distance: 3, last_date: "2026-11-16" },
      { name: "Walking", entries: 2, minutes: 45, distance_km: 0, entries_with_distance: 0, last_date: "2026-11-10" },
    ],
    activity: "Running",
    series: [{ date: "2026-10-22", distance_km: 5, minutes: 30 }, { date: "2026-11-02", distance_km: 5.5, minutes: 32 }, { date: "2026-11-16", distance_km: 5.6, minutes: 28 }],
    ...over,
  };
}
