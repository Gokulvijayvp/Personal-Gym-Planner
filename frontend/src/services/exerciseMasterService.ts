import type { CardioActivity, ExerciseMaster, ExerciseMasterInput, ExerciseMasterList } from "../types/exerciseMaster";
import { api } from "./client";

export const exerciseMasterService = {
  list: (signal?: AbortSignal) => api.get<ExerciseMasterList>("/exercise-masters", { signal }),
  guess: (name: string, signal?: AbortSignal) =>
    api.get<{ icon_motion: string; label: string }>("/exercise-masters/guess", { query: { name }, signal }),
  create: (input: ExerciseMasterInput) => api.post<ExerciseMaster>("/exercise-masters", input),
  update: (id: number, input: ExerciseMasterInput) => api.put<ExerciseMaster>(`/exercise-masters/${id}`, input),
  remove: (id: number) => api.delete(`/exercise-masters/${id}`),
  cardioActivities: (signal?: AbortSignal) => api.get<CardioActivity[]>("/cardio-activities", { signal }),
};
