/**
 * Quick edits of one planned day. Everything goes through the existing Weekly Planner API
 * (`plannerService`); this file only strings those calls together into one-tap actions and can
 * put a day back exactly as it was (the basis of Undo).
 */
import { ApiError } from "../../services/apiError";
import { plannerService } from "../../services/plannerService";
import type {
  DayDetail, ExerciseAssignmentInput, ScheduledExercise, ScheduledMuscleGroup,
} from "../../types/planner";

export interface DayRef { cycleId: number; week: number; day: number }

export const DEFAULT_ASSIGNMENT = { target_sets: 3, target_reps: "10", target_weight_kg: null, rest_seconds: null, notes: null } as const;

/** A day must be a planned workout day before exercises can go into it (rest and empty days are switched). */
async function ensurePlanned(ref: DayRef, day: DayDetail): Promise<DayDetail> {
  if (day.status === "planned") return day;
  return plannerService.putDay(ref.cycleId, ref.week, ref.day, { status: "planned", title: null, notes: null });
}

/** Adds an exercise to the day, creating the muscle-group section it belongs to when needed. */
export async function addExercise(
  ref: DayRef, day: DayDetail, exercise: { id: number; muscleGroupId: number },
  values: Partial<ExerciseAssignmentInput> = {},
): Promise<DayDetail> {
  let current = await ensurePlanned(ref, day);
  if (!current.strength.some((g) => g.muscle_group.id === exercise.muscleGroupId)) {
    current = await plannerService.addMuscleGroup(ref.cycleId, ref.week, ref.day, exercise.muscleGroupId);
  }
  return plannerService.addExercise(ref.cycleId, ref.week, ref.day, exercise.muscleGroupId,
    { ...DEFAULT_ASSIGNMENT, ...values, exercise_id: exercise.id });
}

export async function removeExercise(item: ScheduledExercise): Promise<DayDetail> {
  return plannerService.removeExercise(item.id);
}

/** Swaps one exercise for another, keeping sets / reps / weight / rest and the place in the list. */
export async function replaceExercise(
  ref: DayRef, day: DayDetail, group: ScheduledMuscleGroup, old: ScheduledExercise,
  next: { id: number; muscleGroupId: number },
): Promise<DayDetail> {
  const keep = {
    target_sets: old.target_sets, target_reps: old.target_reps, target_weight_kg: old.target_weight_kg,
    rest_seconds: old.rest_seconds, notes: old.notes,
  };
  const position = group.exercises.findIndex((e) => e.id === old.id);
  const added = await addExercise(ref, day, next, keep);        // add first: if it fails, nothing was lost
  let after = await plannerService.removeExercise(old.id);
  if (next.muscleGroupId === group.muscle_group.id) {
    const g = after.strength.find((s) => s.muscle_group.id === group.muscle_group.id);
    const ids = g?.exercises.map((e) => e.id) ?? [];
    const newId = added.strength.find((s) => s.muscle_group.id === next.muscleGroupId)
      ?.exercises.find((e) => e.exercise.id === next.id)?.id ?? ids[ids.length - 1];
    if (g && newId !== undefined && ids.length > 1 && position >= 0 && position < ids.length - 1) {
      const order = ids.filter((i) => i !== newId);
      order.splice(position, 0, newId);
      after = await plannerService.reorderExercises(ref.cycleId, ref.week, ref.day, group.muscle_group.id, order);
    }
  }
  return after;
}

/** Moves an exercise one place up or down inside its muscle-group section. */
export async function moveExercise(ref: DayRef, group: ScheduledMuscleGroup, itemId: number, delta: -1 | 1): Promise<DayDetail | null> {
  const ids = group.exercises.map((e) => e.id);
  const from = ids.indexOf(itemId), to = from + delta;
  if (from < 0 || to < 0 || to >= ids.length) return null;
  [ids[from], ids[to]] = [ids[to], ids[from]];
  return plannerService.reorderExercises(ref.cycleId, ref.week, ref.day, group.muscle_group.id, ids);
}

export async function markRest(ref: DayRef): Promise<DayDetail> {
  return plannerService.putDay(ref.cycleId, ref.week, ref.day, { status: "rest", title: null, notes: null, clear_workout: true });
}

export async function clearDay(ref: DayRef): Promise<void> {
  await plannerService.clearDay(ref.cycleId, ref.week, ref.day);
}

/** Copies a day onto another (replacing it if `overwrite`). Returns the new target day. */
export async function copyDay(from: DayRef, to: { week: number; day: number }, overwrite: boolean): Promise<DayDetail> {
  return plannerService.copyDay(from.cycleId, from.week, from.day, to.week, to.day, overwrite);
}

/** Copy, then empty the source. If the copy fails the source is untouched. */
export async function moveDay(from: DayRef, to: { week: number; day: number }, overwrite: boolean): Promise<DayDetail> {
  const copied = await copyDay(from, to, overwrite);
  await clearDay(from);
  return copied;
}

const isNotFound = (e: unknown) => e instanceof ApiError && e.status === 404;

/** Puts a day back exactly as the snapshot was taken: status, title, sections, exercises (in order) and cardio. */
export async function restoreDay(ref: DayRef, snap: DayDetail): Promise<void> {
  try { await plannerService.clearDay(ref.cycleId, ref.week, ref.day); } catch (e) { if (!isNotFound(e)) throw e; }
  if (snap.status === "unplanned") return;
  if (snap.status === "rest") {
    await plannerService.putDay(ref.cycleId, ref.week, ref.day, { status: "rest", title: snap.title, notes: snap.notes });
    return;
  }
  await plannerService.putDay(ref.cycleId, ref.week, ref.day, { status: "planned", title: snap.title, notes: snap.notes });
  for (const group of snap.strength) {
    await plannerService.addMuscleGroup(ref.cycleId, ref.week, ref.day, group.muscle_group.id);
    for (const item of group.exercises) {
      await plannerService.addExercise(ref.cycleId, ref.week, ref.day, group.muscle_group.id, {
        exercise_id: item.exercise.id, target_sets: item.target_sets, target_reps: item.target_reps,
        target_weight_kg: item.target_weight_kg, rest_seconds: item.rest_seconds, notes: item.notes,
      });
    }
  }
  for (const c of snap.cardio) {
    await plannerService.addCardio(ref.cycleId, ref.week, ref.day, {
      cardio_activity_id: c.cardio_activity.id, duration_minutes: c.duration_minutes, distance_km: c.distance_km, notes: c.notes,
    });
  }
}

/** A short "3 × 10 · 20 kg" style line for an exercise row. */
export function describeTarget(e: ScheduledExercise): string {
  const base = `${e.target_sets} × ${e.target_reps}`;
  return e.target_weight_kg ? `${base} · ${e.target_weight_kg} kg` : base;
}
