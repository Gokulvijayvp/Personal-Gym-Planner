import type { CycleSummary, CardioInput, DayKind, ExerciseAssignmentInput, ScheduledCardio, ScheduledExercise } from "../../types/planner";

export const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

export const KIND_LABEL: Record<DayKind, string> = {
  empty: "Not planned", rest: "Rest day", strength: "Strength", cardio: "Cardio", mixed: "Strength + cardio",
};

/** Which cycle to show first: the active one, else the newest draft, else the newest of anything. */
export function defaultCycle(cycles: CycleSummary[]): CycleSummary | null {
  const byStart = (a: CycleSummary, b: CycleSummary) => b.start_date.localeCompare(a.start_date);
  const pick = (status: string) => cycles.filter((c) => c.status === status).sort(byStart)[0];
  return pick("active") ?? pick("draft") ?? [...cycles].sort(byStart)[0] ?? null;
}

export function clampWeek(week: number, totalWeeks: number): number {
  if (!Number.isInteger(week) || week < 1) return 1;
  return Math.min(week, totalWeeks);
}

// ---- exercise assignment form --------------------------------------------------------------

export interface AssignmentFormValues {
  exerciseId: number | null; sets: string; reps: string; weight: string; rest: string; notes: string;
}
export type AssignmentErrors = Partial<Record<
  "exercise_id" | "target_sets" | "target_reps" | "target_weight_kg" | "rest_seconds" | "notes", string>>;

export const EMPTY_ASSIGNMENT: AssignmentFormValues = { exerciseId: null, sets: "3", reps: "10", weight: "", rest: "", notes: "" };

export function assignmentFromItem(item: ScheduledExercise): AssignmentFormValues {
  return {
    exerciseId: item.exercise.id, sets: String(item.target_sets), reps: item.target_reps,
    weight: item.target_weight_kg === null ? "" : String(item.target_weight_kg),
    rest: item.rest_seconds === null ? "" : String(item.rest_seconds), notes: item.notes ?? "",
  };
}

/** Mirrors the backend: "10", a range "8-12", "AMRAP" or "Failure". Returns the normalised text or null. */
export function normaliseReps(raw: string): string | null {
  const v = raw.replace(/\s+/g, " ").trim();
  if (/^amrap$/i.test(v)) return "AMRAP";
  if (/^failure$/i.test(v)) return "Failure";
  if (/^\d{1,3}$/.test(v)) return Number(v) >= 1 ? String(Number(v)) : null;
  const m = /^(\d{1,3})\s*[-–]\s*(\d{1,3})$/.exec(v);
  if (m) {
    const lo = Number(m[1]), hi = Number(m[2]);
    return lo >= 1 && lo <= hi ? `${lo}-${hi}` : null;
  }
  return null;
}

const isWhole = (s: string) => /^\d+$/.test(s.trim());

export function validateAssignment(v: AssignmentFormValues): AssignmentErrors {
  const e: AssignmentErrors = {};
  if (v.exerciseId === null) e.exercise_id = "Choose an exercise from your library.";
  if (!isWhole(v.sets) || Number(v.sets) < 1 || Number(v.sets) > 20) e.target_sets = "Sets must be a whole number from 1 to 20.";
  if (normaliseReps(v.reps) === null) e.target_reps = "Use a number, a range like 8-12, AMRAP or Failure.";
  if (v.weight.trim() !== "") {
    const w = Number(v.weight);
    if (!Number.isFinite(w) || w < 0 || w > 1000) e.target_weight_kg = "Weight must be between 0 and 1000 kg.";
  }
  if (v.rest.trim() !== "" && (!isWhole(v.rest) || Number(v.rest) > 3600)) e.rest_seconds = "Rest must be whole seconds, up to 3600.";
  if (v.notes.trim().length > 500) e.notes = "Keep notes under 500 characters.";
  return e;
}

/** Call only after validateAssignment() returned no errors. */
export function toAssignmentInput(v: AssignmentFormValues): ExerciseAssignmentInput {
  return {
    exercise_id: v.exerciseId as number, target_sets: Number(v.sets), target_reps: normaliseReps(v.reps) as string,
    target_weight_kg: v.weight.trim() === "" ? null : Number(v.weight),
    rest_seconds: v.rest.trim() === "" ? null : Number(v.rest), notes: v.notes.trim() || null,
  };
}

/** New id order after moving the item at `index` by `delta` (-1 up, +1 down); null when it can't move. */
export function moveItem(ids: number[], index: number, delta: -1 | 1): number[] | null {
  const to = index + delta;
  if (index < 0 || index >= ids.length || to < 0 || to >= ids.length) return null;
  const next = [...ids];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

// ---- cardio form ---------------------------------------------------------------------------

export interface CardioFormValues { activityId: string; minutes: string; distance: string; notes: string }
export type CardioErrors = Partial<Record<"cardio_activity_id" | "duration_minutes" | "distance_km" | "notes", string>>;

export const EMPTY_CARDIO: CardioFormValues = { activityId: "", minutes: "30", distance: "", notes: "" };

export function cardioFromItem(c: ScheduledCardio): CardioFormValues {
  return {
    activityId: String(c.cardio_activity.id), minutes: String(c.duration_minutes),
    distance: c.distance_km === null ? "" : String(c.distance_km), notes: c.notes ?? "",
  };
}

export function validateCardio(v: CardioFormValues): CardioErrors {
  const e: CardioErrors = {};
  if (!v.activityId) e.cardio_activity_id = "Choose a cardio activity.";
  if (!isWhole(v.minutes) || Number(v.minutes) < 1 || Number(v.minutes) > 600) e.duration_minutes = "Duration must be 1 to 600 minutes.";
  if (v.distance.trim() !== "") {
    const d = Number(v.distance);
    if (!Number.isFinite(d) || d < 0 || d > 1000) e.distance_km = "Distance must be between 0 and 1000 km.";
  }
  if (v.notes.trim().length > 500) e.notes = "Keep notes under 500 characters.";
  return e;
}

export function toCardioInput(v: CardioFormValues): CardioInput {
  return {
    cardio_activity_id: Number(v.activityId), duration_minutes: Number(v.minutes),
    distance_km: v.distance.trim() === "" ? null : Number(v.distance), notes: v.notes.trim() || null,
  };
}

/** "3 × 8-12 @ 40 kg · rest 90s" */
export function describeAssignment(item: ScheduledExercise): string {
  const parts = [`${item.target_sets} × ${item.target_reps}`];
  if (item.target_weight_kg !== null) parts[0] += ` @ ${item.target_weight_kg} kg`;
  if (item.rest_seconds !== null) parts.push(`rest ${item.rest_seconds}s`);
  return parts.join(" · ");
}
