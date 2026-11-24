import type { DateString } from "../types/api";
import type {
  Cardio, Consistency, ExerciseOptions, ExerciseProgress, MuscleGroups, Overview, PersonalRecords, Volume,
} from "../types/progress";
import { api } from "./client";

export interface RangeQuery { start?: DateString; end?: DateString }

/** Read-only analytics. Nothing here writes. */
export const progressService = {
  overview: (q: RangeQuery, signal?: AbortSignal) => api.get<Overview>("/progress/overview", { query: { ...q }, signal }),
  consistency: (q: RangeQuery, signal?: AbortSignal) => api.get<Consistency>("/progress/consistency", { query: { ...q }, signal }),
  exercises: (q: RangeQuery, signal?: AbortSignal) => api.get<ExerciseOptions>("/progress/exercises", { query: { ...q }, signal }),
  exercise: (key: string, q: RangeQuery, signal?: AbortSignal) => api.get<ExerciseProgress>("/progress/exercise", { query: { key, ...q }, signal }),
  volume: (q: RangeQuery, signal?: AbortSignal) => api.get<Volume>("/progress/volume", { query: { ...q }, signal }),
  records: (q: RangeQuery, signal?: AbortSignal) => api.get<PersonalRecords>("/progress/personal-records", { query: { ...q }, signal }),
  muscleGroups: (q: RangeQuery, signal?: AbortSignal) => api.get<MuscleGroups>("/progress/muscle-groups", { query: { ...q }, signal }),
  cardio: (q: RangeQuery, activity: string | undefined, signal?: AbortSignal) => api.get<Cardio>("/progress/cardio", { query: { ...q, activity }, signal }),
};
