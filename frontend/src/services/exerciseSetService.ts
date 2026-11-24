import type { ExerciseSet, ExerciseSetInput, ImportResult, ShareCreated, SharedPreview } from "../types/exerciseSet";
import { api } from "./client";

export const exerciseSetService = {
  list: (signal?: AbortSignal) => api.get<ExerciseSet[]>("/exercise-sets", { signal }),
  create: (input: ExerciseSetInput) => api.post<ExerciseSet>("/exercise-sets", input),
  update: (id: number, input: ExerciseSetInput) => api.put<ExerciseSet>(`/exercise-sets/${id}`, input),
  remove: (id: number) => api.delete(`/exercise-sets/${id}`),
  /** A code for your whole list (a frozen copy). */
  share: () => api.post<ShareCreated>("/exercise-sets/share", {}),
  /** What a code contains. Changes nothing. */
  previewShared: (code: string) => api.post<SharedPreview>("/exercise-sets/shared/preview", { code }),
  /** DELETES your current sets and replaces them with the shared ones. Only call after the person confirmed. */
  importShared: (code: string) => api.post<ImportResult>("/exercise-sets/import", { code, confirm_replace: true }),
};
