import { vi } from "vitest";
import { ApiError } from "../../services/apiError";
import type { workoutService } from "../../services/workoutService";
import type { LoggedCardio, LoggedExercise, LoggedSet, WorkoutSession } from "../../types/workout";
import { summarize } from "./sessionLogic";

let nextId = 1000;

export function makeSet(over: Partial<LoggedSet> & { id: number; set_number: number }): LoggedSet {
  return { status: "pending", target_reps: "6-8", target_weight_kg: 80, actual_reps: null, actual_weight_kg: null, rest_seconds: null, notes: null, ...over };
}

export function makeExercise(over: Partial<LoggedExercise> & { id: number }): LoggedExercise {
  return {
    position: 1, exercise_id: 100 + over.id, exercise_name: "Barbell Bench Press", muscle_group_name: "Chest", workout_type_name: "Barbell",
    status: "pending", from_plan: true, target_sets: 3, target_reps: "6-8", target_weight_kg: 80, target_rest_seconds: 120, plan_notes: null, notes: null,
    sets: [1, 2, 3].map((n) => makeSet({ id: over.id * 10 + n, set_number: n })), ...over,
  };
}

export function makeCardio(over: Partial<LoggedCardio> & { id: number }): LoggedCardio {
  return {
    position: 1, cardio_activity_id: 2, activity_name: "Running", status: "pending", from_plan: true, target_duration_minutes: 30, target_distance_km: 5,
    plan_notes: null, duration_minutes: null, distance_km: null, calories: null, speed_kmh: null, resistance: null, notes: null, ...over,
  };
}

/** A planned Thursday: Bench Press (3 sets), Cable Fly (2 sets) and a planned run. */
export function makeSession(over: Partial<WorkoutSession> = {}): WorkoutSession {
  const exercises = [
    makeExercise({ id: 1, position: 1 }),
    makeExercise({ id: 2, position: 2, exercise_name: "Cable Fly", target_sets: 2, target_reps: "12", target_weight_kg: null, target_rest_seconds: null,
      sets: [1, 2].map((n) => makeSet({ id: 20 + n, set_number: n, target_reps: "12", target_weight_kg: null })) }),
  ];
  const cardio = [makeCardio({ id: 1 })];
  const base: WorkoutSession = {
    id: 7, workout_date: "2026-11-19", status: "in_progress", source: "plan", title: "Push day", cycle_name: "Winter Block", week_number: 1,
    daily_schedule_id: 5, started_at: "2026-11-19T05:00:00Z", ended_at: null, duration_seconds: 600, notes: null, cancel_reason: null,
    summary: summarize({ exercises, cardio }), exercises, cardio, updated_at: "2026-11-19T05:10:00Z",
  };
  return { ...base, ...over };
}

type Svc = typeof workoutService;
type Mocked = { [K in keyof Svc]: ReturnType<typeof vi.fn> };

/**
 * An in-memory stand-in for the backend with the same rules as the real one (patch semantics, renumbering,
 * read-only once finished). Tests can still override any single method to simulate slowness or failure.
 */
export function installFakeServer(svc: Mocked, initial: WorkoutSession) {
  const state = { session: structuredClone(initial) };
  const out = () => { state.session.summary = summarize(state.session); state.session.updated_at = new Date().toISOString(); return structuredClone(state.session); };
  const guard = () => {
    if (state.session.status !== "in_progress") {
      throw new ApiError({ kind: "client", status: 409, code: "session_locked", message: "This workout is completed and can no longer be changed." });
    }
  };
  const findSet = (id: number) => state.session.exercises.flatMap((e) => e.sets).find((s) => s.id === id)!;
  const findEx = (id: number) => state.session.exercises.find((e) => e.id === id)!;
  const findCardio = (id: number) => state.session.cardio.find((c) => c.id === id)!;

  svc.get.mockImplementation(async () => out());
  svc.updateSet.mockImplementation(async (_sid: number, setId: number, patch: object) => { guard(); Object.assign(findSet(setId), patch); return out(); });
  svc.updateExercise.mockImplementation(async (_sid: number, id: number, patch: object) => { guard(); Object.assign(findEx(id), patch); return out(); });
  svc.updateCardio.mockImplementation(async (_sid: number, id: number, patch: object) => { guard(); Object.assign(findCardio(id), patch); return out(); });
  svc.addSet.mockImplementation(async (_sid: number, exerciseId: number) => {
    guard();
    const ex = findEx(exerciseId);
    ex.sets.push(makeSet({ id: nextId++, set_number: Math.max(0, ...ex.sets.map((s) => s.set_number)) + 1, target_reps: ex.target_reps, target_weight_kg: ex.target_weight_kg }));
    return out();
  });
  svc.removeSet.mockImplementation(async (_sid: number, setId: number) => {
    guard();
    for (const ex of state.session.exercises) { ex.sets = ex.sets.filter((s) => s.id !== setId); ex.sets.forEach((s, i) => { s.set_number = i + 1; }); }
    return out();
  });
  svc.removeExercise.mockImplementation(async (_sid: number, id: number) => {
    guard();
    state.session.exercises = state.session.exercises.filter((e) => e.id !== id);
    state.session.exercises.forEach((e, i) => { e.position = i + 1; });
    return out();
  });
  svc.reorderExercises.mockImplementation(async (_sid: number, ids: number[]) => {
    guard();
    state.session.exercises = ids.map((id, i) => ({ ...findEx(id), position: i + 1 }));
    return out();
  });
  svc.addExercise.mockImplementation(async (_sid: number, exerciseId: number) => {
    guard();
    const id = nextId++;
    state.session.exercises.push(makeExercise({ id, position: state.session.exercises.length + 1, exercise_id: exerciseId, exercise_name: "Lat Pulldown", muscle_group_name: "Back",
      workout_type_name: "Cable", from_plan: false, target_sets: null, target_reps: null, target_weight_kg: null, target_rest_seconds: null,
      sets: [makeSet({ id: id * 10 + 1, set_number: 1, target_reps: null, target_weight_kg: null })] }));
    return out();
  });
  svc.addCardio.mockImplementation(async (_sid: number, activityId: number) => {
    guard();
    state.session.cardio.push(makeCardio({ id: nextId++, position: state.session.cardio.length + 1, cardio_activity_id: activityId, activity_name: "Walking", from_plan: false,
      target_duration_minutes: null, target_distance_km: null }));
    return out();
  });
  svc.removeCardio.mockImplementation(async (_sid: number, id: number) => { guard(); state.session.cardio = state.session.cardio.filter((c) => c.id !== id); return out(); });
  svc.complete.mockImplementation(async (_sid: number, notes: string | null) => {
    guard();
    Object.assign(state.session, { status: "completed", ended_at: "2026-11-19T06:15:00Z", duration_seconds: 4500, notes });
    return out();
  });
  svc.cancel.mockImplementation(async (_sid: number, reason: string | null) => {
    guard();
    Object.assign(state.session, { status: "cancelled", ended_at: "2026-11-19T05:20:00Z", duration_seconds: 1200, cancel_reason: reason });
    return out();
  });
  return state;
}
