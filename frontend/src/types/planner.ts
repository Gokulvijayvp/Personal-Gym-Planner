/** Mirrors backend `app.schemas.cycle` / `app.schemas.planner`. */
import type { DateString, UtcDateTimeString } from "./api";
import type { MuscleGroupRef, TargetArea, WorkoutType } from "./exercise";

export type CycleStatus = "draft" | "active" | "completed" | "archived";

export interface CycleBrief {
  id: number; name: string; status: CycleStatus; start_date: DateString; end_date: DateString; total_weeks: number;
}

export interface CycleSummary extends CycleBrief {
  description: string | null;
  planned_days: number;
  rest_days: number;
  exercise_count: number;
  cardio_count: number;
  created_at: UtcDateTimeString;
  updated_at: UtcDateTimeString;
}

export interface WeekStats {
  id: number; week_number: number; name: string | null; notes: string | null;
  start_date: DateString; end_date: DateString;
  planned_days: number; rest_days: number; exercise_count: number; cardio_count: number;
}

export interface CycleDetail extends CycleSummary { weeks: WeekStats[] }

/** Body for POST /cycles and PUT /cycles/{id}. */
export interface CycleInput {
  name: string; description: string | null; start_date: DateString; total_weeks: number;
}

export interface CardioActivity { id: number; name: string }

export type DayKind = "empty" | "rest" | "strength" | "cardio" | "mixed";
export type DayStatus = "unplanned" | "planned" | "rest";

export interface DaySummary {
  day_of_week: number;            // Monday=0 .. Sunday=6
  date: DateString;
  schedule_id: number | null;
  status: DayStatus;
  kind: DayKind;
  title: string | null;
  display_title: string | null;
  notes: string | null;
  muscle_groups: MuscleGroupRef[];
  exercise_count: number;
  cardio_count: number;
}

export interface ExerciseRef {
  id: number; name: string; is_active: boolean;
  muscle_group: MuscleGroupRef; target_area: TargetArea | null; workout_type: WorkoutType | null;
}

export interface ScheduledExercise {
  id: number; order: number; exercise: ExerciseRef;
  target_sets: number; target_reps: string; target_weight_kg: number | null; rest_seconds: number | null;
  notes: string | null;
}

export interface ScheduledMuscleGroup {
  id: number; muscle_group: MuscleGroupRef; notes: string | null; exercises: ScheduledExercise[];
}

export interface ScheduledCardio {
  id: number; cardio_activity: CardioActivity; duration_minutes: number; distance_km: number | null;
  notes: string | null;
}

export interface DayDetail extends DaySummary {
  cycle_id: number; week_number: number; strength: ScheduledMuscleGroup[]; cardio: ScheduledCardio[];
}

export interface WeekDetail {
  cycle: CycleBrief; week_id: number; week_number: number; name: string | null; notes: string | null;
  start_date: DateString; end_date: DateString; days: DaySummary[];
}

export interface DayUpsertInput {
  status: "planned" | "rest"; title: string | null; notes: string | null; clear_workout?: boolean;
}

export interface ExerciseAssignmentInput {
  exercise_id: number; target_sets: number; target_reps: string;
  target_weight_kg: number | null; rest_seconds: number | null; notes: string | null;
}

export interface CardioInput {
  cardio_activity_id: number; duration_minutes: number; distance_km: number | null; notes: string | null;
}

export interface CopyResult { copied_days: number; target_week_numbers: number[] }
