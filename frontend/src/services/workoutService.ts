import type {
  CardioPatch, ExercisePatch, HistoryQuery, SessionList, SessionRef, SetPatch, StartInput, WorkoutSession,
} from "../types/workout";
import { api } from "./client";

const base = (id: number) => `/workouts/${id}`;

/** Every mutation answers with the whole updated session, so the page always shows exactly what the server holds. */
export const workoutService = {
  start: (input: StartInput) => api.post<WorkoutSession>("/workouts", input),
  current: (signal?: AbortSignal) => api.get<SessionRef | null>("/workouts/current", { signal }),
  list: (query: HistoryQuery, signal?: AbortSignal) => api.get<SessionList>("/workouts", { query: { ...query }, signal }),
  get: (id: number, signal?: AbortSignal) => api.get<WorkoutSession>(base(id), { signal }),
  complete: (id: number, notes: string | null) => api.post<WorkoutSession>(`${base(id)}/complete`, { notes }),
  cancel: (id: number, reason: string | null) => api.post<WorkoutSession>(`${base(id)}/cancel`, { reason }),

  addExercise: (id: number, exerciseId: number) => api.post<WorkoutSession>(`${base(id)}/exercises`, { exercise_id: exerciseId }),
  updateExercise: (id: number, exerciseId: number, patch: ExercisePatch) => api.patch<WorkoutSession>(`${base(id)}/exercises/${exerciseId}`, patch),
  removeExercise: (id: number, exerciseId: number) => api.delete<WorkoutSession>(`${base(id)}/exercises/${exerciseId}`),
  reorderExercises: (id: number, exerciseIds: number[]) => api.put<WorkoutSession>(`${base(id)}/exercises/order`, { exercise_ids: exerciseIds }),

  addSet: (id: number, exerciseId: number) => api.post<WorkoutSession>(`${base(id)}/exercises/${exerciseId}/sets`),
  updateSet: (id: number, setId: number, patch: SetPatch) => api.patch<WorkoutSession>(`${base(id)}/sets/${setId}`, patch),
  removeSet: (id: number, setId: number) => api.delete<WorkoutSession>(`${base(id)}/sets/${setId}`),

  addCardio: (id: number, activityId: number) => api.post<WorkoutSession>(`${base(id)}/cardio`, { cardio_activity_id: activityId }),
  updateCardio: (id: number, cardioId: number, patch: CardioPatch) => api.patch<WorkoutSession>(`${base(id)}/cardio/${cardioId}`, patch),
  removeCardio: (id: number, cardioId: number) => api.delete<WorkoutSession>(`${base(id)}/cardio/${cardioId}`),
};
