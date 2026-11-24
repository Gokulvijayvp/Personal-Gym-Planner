import type { Exercise, ExerciseInput, MuscleGroup } from "../../types/exercise";
import { areaBelongsToGroup } from "./exerciseFilters";

export const LIMITS = { name: { min: 2, max: 160 }, description: 2000, instructions: 5000, mediaUrl: 500 } as const;

export interface ExerciseFormValues {
  name: string;
  description: string;
  muscleGroupId: string;
  secondaryIds: number[];
  targetAreaId: string;
  workoutTypeId: string;
  instructions: string;
  mediaUrl: string;
  isActive: boolean;
}

/** Keys match the backend field names so server errors map straight onto inputs. */
export type FormErrors = Partial<Record<
  "name" | "description" | "muscle_group_id" | "secondary_muscle_group_ids" | "target_area_id"
  | "workout_type_id" | "instructions" | "media_url", string>>;

export const EMPTY_FORM: ExerciseFormValues = {
  name: "", description: "", muscleGroupId: "", secondaryIds: [], targetAreaId: "", workoutTypeId: "",
  instructions: "", mediaUrl: "", isActive: true,
};

export function valuesFromExercise(e: Exercise): ExerciseFormValues {
  return {
    name: e.name,
    description: e.description ?? "",
    muscleGroupId: String(e.muscle_group.id),
    secondaryIds: e.secondary_muscle_groups.map((g) => g.id),
    targetAreaId: e.target_area ? String(e.target_area.id) : "",
    workoutTypeId: e.workout_type ? String(e.workout_type.id) : "",
    instructions: e.instructions ?? "",
    mediaUrl: e.media_url ?? "",
    isActive: e.is_active,
  };
}

export const normaliseName = (name: string) => name.replace(/\s+/g, " ").trim();

/**
 * Changing the primary muscle group keeps the form consistent:
 * the target area is cleared unless it belongs to the new group, and the new primary
 * is removed from the secondary list.
 */
export function withPrimaryMuscle(
  values: ExerciseFormValues, muscleGroupId: string, groups: MuscleGroup[],
): ExerciseFormValues {
  return {
    ...values,
    muscleGroupId,
    targetAreaId: areaBelongsToGroup(groups, values.targetAreaId, muscleGroupId) ? values.targetAreaId : "",
    secondaryIds: values.secondaryIds.filter((id) => String(id) !== muscleGroupId),
  };
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (u.protocol === "http:" || u.protocol === "https:") && u.host.length > 0;
  } catch {
    return false;
  }
}

/** Mirrors the backend rules so most mistakes are caught before a request is sent. */
export function validateForm(v: ExerciseFormValues, groups: MuscleGroup[]): FormErrors {
  const errors: FormErrors = {};
  const name = normaliseName(v.name);
  if (!name) errors.name = "Enter an exercise name.";
  else if (name.length < LIMITS.name.min) errors.name = `Name must be at least ${LIMITS.name.min} characters.`;
  else if (name.length > LIMITS.name.max) errors.name = `Name must be at most ${LIMITS.name.max} characters.`;

  if (!v.muscleGroupId) errors.muscle_group_id = "Choose a primary muscle group.";
  else if (v.targetAreaId && !areaBelongsToGroup(groups, v.targetAreaId, v.muscleGroupId)) {
    errors.target_area_id = "This target area doesn't belong to the selected muscle group.";
  }
  if (v.description.trim().length > LIMITS.description) errors.description = `Keep the description under ${LIMITS.description} characters.`;
  if (v.instructions.trim().length > LIMITS.instructions) errors.instructions = `Keep the instructions under ${LIMITS.instructions} characters.`;

  const url = v.mediaUrl.trim();
  if (url) {
    if (url.length > LIMITS.mediaUrl) errors.media_url = `URL must be under ${LIMITS.mediaUrl} characters.`;
    else if (!isHttpUrl(url)) errors.media_url = "Enter a valid web address starting with http:// or https://";
  }
  return errors;
}

const blankToNull = (s: string) => (s.trim() ? s.trim() : null);

/** Form values -> API body. Call only after validateForm() returned no errors. */
export function toInput(v: ExerciseFormValues): ExerciseInput {
  return {
    name: normaliseName(v.name),
    description: blankToNull(v.description),
    muscle_group_id: Number(v.muscleGroupId),
    secondary_muscle_group_ids: v.secondaryIds,
    target_area_id: v.targetAreaId ? Number(v.targetAreaId) : null,
    workout_type_id: v.workoutTypeId ? Number(v.workoutTypeId) : null,
    instructions: blankToNull(v.instructions),
    media_url: blankToNull(v.mediaUrl),
    is_active: v.isActive,
  };
}
