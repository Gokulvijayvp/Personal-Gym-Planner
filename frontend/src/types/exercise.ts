/** Mirrors backend `app.schemas.exercise` / `app.schemas.master_data`. */
import type { UtcDateTimeString } from "./api";
import type { ExerciseMasterRef } from "./exerciseMaster";

export interface MuscleGroupRef { id: number; name: string }

export interface TargetArea { id: number; name: string; muscle_group_id: number }

export interface MuscleGroup extends MuscleGroupRef {
  sort_order: number;
  target_areas: TargetArea[];
}

export interface WorkoutType { id: number; name: string }

export interface Exercise {
  id: number;
  name: string;
  description: string | null;
  muscle_group: MuscleGroupRef;
  secondary_muscle_groups: MuscleGroupRef[];
  target_area: TargetArea | null;
  workout_type: WorkoutType | null;
  /** The master entry (name + icon) this exercise is linked to. */
  exercise_master?: ExerciseMasterRef | null;
  instructions: string | null;
  media_url: string | null;
  is_active: boolean;
  /** Planned/logged references. > 0 means it can only be deactivated, not deleted. */
  usage_count: number;
  created_at: UtcDateTimeString;
  updated_at: UtcDateTimeString;
}

/** Body for POST /exercises and PUT /exercises/{id}. */
export interface ExerciseInput {
  name: string;
  description: string | null;
  muscle_group_id: number;
  secondary_muscle_group_ids: number[];
  target_area_id: number | null;
  workout_type_id: number | null;
  instructions: string | null;
  media_url: string | null;
  is_active: boolean;
}

export interface ExerciseListResponse {
  items: Exercise[];
  total: number;
  total_all: number;
  page: number;
  page_size: number;
  pages: number;
}

export type ExerciseSortField = "name" | "created_at" | "updated_at";
export type SortOrder = "asc" | "desc";

export interface ExerciseListQuery {
  search?: string;
  muscle_group_id?: number;
  target_area_id?: number;
  workout_type_id?: number;
  is_active?: boolean;
  sort: ExerciseSortField;
  order: SortOrder;
  page: number;
  page_size: number;
}
