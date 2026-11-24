/** Mirrors backend `app.schemas.workout_log`. Weights are kilograms and distances kilometres, always. */
import type { DateString, UtcDateTimeString } from "./api";

export type LogStatus = "pending" | "completed" | "skipped";
export type SessionStatus = "in_progress" | "completed" | "cancelled";
export type SessionSource = "plan" | "blank";

export interface LoggedSet {
  id: number;
  set_number: number;
  status: LogStatus;
  target_reps: string | null;
  target_weight_kg: number | null;
  actual_reps: number | null;
  actual_weight_kg: number | null;
  rest_seconds: number | null;
  notes: string | null;
}

export interface LoggedExercise {
  id: number;
  position: number;
  exercise_id: number | null;
  exercise_name: string;
  muscle_group_name: string | null;
  workout_type_name: string | null;
  status: LogStatus;
  from_plan: boolean;
  target_sets: number | null;
  target_reps: string | null;
  target_weight_kg: number | null;
  target_rest_seconds: number | null;
  plan_notes: string | null;
  notes: string | null;
  sets: LoggedSet[];
}

export interface LoggedCardio {
  id: number;
  position: number;
  cardio_activity_id: number | null;
  activity_name: string;
  status: LogStatus;
  from_plan: boolean;
  target_duration_minutes: number | null;
  target_distance_km: number | null;
  plan_notes: string | null;
  duration_minutes: number | null;
  distance_km: number | null;
  calories: number | null;
  speed_kmh: number | null;
  resistance: string | null;
  notes: string | null;
}

export interface SessionSummary {
  total_exercises: number;
  completed_exercises: number;
  skipped_exercises: number;
  total_sets: number;
  completed_sets: number;
  cardio_entries: number;
  cardio_completed: number;
  cardio_minutes: number;
}

export interface WorkoutSession {
  id: number;
  workout_date: DateString;
  status: SessionStatus;
  source: SessionSource;
  title: string | null;
  cycle_name: string | null;
  week_number: number | null;
  daily_schedule_id: number | null;
  started_at: UtcDateTimeString;
  ended_at: UtcDateTimeString | null;
  duration_seconds: number;
  notes: string | null;
  cancel_reason: string | null;
  summary: SessionSummary;
  exercises: LoggedExercise[];
  cardio: LoggedCardio[];
  updated_at: UtcDateTimeString;
}

export interface SessionListItem {
  id: number;
  workout_date: DateString;
  status: SessionStatus;
  source: SessionSource;
  title: string | null;
  cycle_name: string | null;
  started_at: UtcDateTimeString;
  ended_at: UtcDateTimeString | null;
  duration_seconds: number;
  exercise_count: number;
  completed_exercise_count: number;
  completed_sets: number;
  cardio_minutes: number;
  exercise_names: string[];
}

export interface SessionList { items: SessionListItem[]; total: number; page: number; page_size: number }

export interface SessionRef { id: number; status: SessionStatus; workout_date: DateString; title: string | null }

export interface RecentSession {
  id: number;
  workout_date: DateString;
  title: string | null;
  cycle_name: string | null;
  ended_at: UtcDateTimeString;
  duration_seconds: number;
  completed_exercise_count: number;
  completed_sets: number;
  cardio_minutes: number;
}

export type StartInput =
  | { source: "plan"; cycle_id: number; week_number: number; day_of_week: number }
  | { source: "blank"; workout_date?: DateString };

/** PATCH bodies: only the keys present are changed on the server; null clears a value. */
export interface SetPatch { actual_reps?: number | null; actual_weight_kg?: number | null; rest_seconds?: number | null; status?: LogStatus; notes?: string | null }
export interface ExercisePatch { status?: LogStatus; notes?: string | null }
export interface CardioPatch {
  status?: LogStatus; duration_minutes?: number | null; distance_km?: number | null; calories?: number | null;
  speed_kmh?: number | null; resistance?: string | null; notes?: string | null;
}

export type HistoryStatus = "all" | "finished" | "completed" | "cancelled" | "in_progress";
export interface HistoryQuery { status: HistoryStatus; start?: DateString; end?: DateString; exercise?: string; page: number; page_size: number }
