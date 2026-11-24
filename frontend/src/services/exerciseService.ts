import type {
  Exercise, ExerciseInput, ExerciseListQuery, ExerciseListResponse, MuscleGroup, WorkoutType,
} from "../types/exercise";
import { api } from "./client";

export const exerciseService = {
  list: (query: ExerciseListQuery, signal?: AbortSignal) =>
    api.get<ExerciseListResponse>("/exercises", { query: { ...query }, signal }),
  get: (id: number) => api.get<Exercise>(`/exercises/${id}`),
  create: (input: ExerciseInput) => api.post<Exercise>("/exercises", input),
  update: (id: number, input: ExerciseInput) => api.put<Exercise>(`/exercises/${id}`, input),
  setActive: (id: number, isActive: boolean) =>
    api.patch<Exercise>(`/exercises/${id}/status`, { is_active: isActive }),
  remove: (id: number) => api.delete(`/exercises/${id}`),
};

export const masterDataService = {
  muscleGroups: (signal?: AbortSignal) => api.get<MuscleGroup[]>("/muscle-groups", { signal }),
  workoutTypes: (signal?: AbortSignal) => api.get<WorkoutType[]>("/workout-types", { signal }),
};
