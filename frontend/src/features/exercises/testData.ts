import type { Exercise, ExerciseListResponse, MuscleGroup, WorkoutType } from "../../types/exercise";

/** Test fixtures shaped like the real seeded master data (subset). */
export const MUSCLE_GROUPS: MuscleGroup[] = [
  { id: 1, name: "Chest", sort_order: 1, target_areas: [
    { id: 1, name: "Upper Chest", muscle_group_id: 1 }, { id: 2, name: "Middle Chest", muscle_group_id: 1 },
    { id: 3, name: "Lower Chest", muscle_group_id: 1 }, { id: 4, name: "Inner Chest", muscle_group_id: 1 },
  ] },
  { id: 2, name: "Back", sort_order: 2, target_areas: [
    { id: 5, name: "Upper Back", muscle_group_id: 2 }, { id: 8, name: "Lats", muscle_group_id: 2 },
  ] },
  { id: 3, name: "Shoulders", sort_order: 3, target_areas: [
    { id: 9, name: "Front Delts", muscle_group_id: 3 }, { id: 10, name: "Side Delts", muscle_group_id: 3 },
  ] },
  { id: 4, name: "Biceps", sort_order: 4, target_areas: [{ id: 12, name: "Biceps", muscle_group_id: 4 }] },
  { id: 5, name: "Triceps", sort_order: 5, target_areas: [{ id: 13, name: "Triceps", muscle_group_id: 5 }] },
];

export const WORKOUT_TYPES: WorkoutType[] = [
  { id: 1, name: "Barbell" }, { id: 2, name: "Dumbbell" }, { id: 4, name: "Cable" },
];

export function makeExercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: 1, name: "Barbell Bench Press", description: "Classic press.",
    muscle_group: { id: 1, name: "Chest" },
    secondary_muscle_groups: [{ id: 5, name: "Triceps" }],
    target_area: { id: 2, name: "Middle Chest", muscle_group_id: 1 },
    workout_type: { id: 1, name: "Barbell" },
    instructions: null, media_url: null, is_active: true, usage_count: 0,
    created_at: "2026-11-18T10:00:00Z", updated_at: "2026-11-18T10:00:00Z",
    ...overrides,
  };
}

export function makeList(items: Exercise[], extra: Partial<ExerciseListResponse> = {}): ExerciseListResponse {
  return { items, total: items.length, total_all: items.length, page: 1, page_size: 12, pages: 1, ...extra };
}
