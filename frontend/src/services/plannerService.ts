import type {
  CardioActivity, CardioInput, CopyResult, CycleDetail, CycleInput, CycleStatus, CycleSummary, DayDetail,
  DayUpsertInput, ExerciseAssignmentInput, WeekDetail,
} from "../types/planner";
import { api } from "./client";

export const cycleService = {
  list: (status?: CycleStatus, signal?: AbortSignal) => api.get<CycleSummary[]>("/cycles", { query: { status }, signal }),
  get: (id: number, signal?: AbortSignal) => api.get<CycleDetail>(`/cycles/${id}`, { signal }),
  create: (input: CycleInput) => api.post<CycleDetail>("/cycles", input),
  update: (id: number, input: CycleInput) => api.put<CycleDetail>(`/cycles/${id}`, input),
  remove: (id: number) => api.delete(`/cycles/${id}`),
  activate: (id: number) => api.post<CycleDetail>(`/cycles/${id}/activate`),
  complete: (id: number) => api.post<CycleDetail>(`/cycles/${id}/complete`),
  archive: (id: number) => api.post<CycleDetail>(`/cycles/${id}/archive`),
};

const dayPath = (cycleId: number, week: number, day: number) => `/cycles/${cycleId}/weeks/${week}/days/${day}`;

export const plannerService = {
  getWeek: (cycleId: number, week: number, signal?: AbortSignal) =>
    api.get<WeekDetail>(`/cycles/${cycleId}/weeks/${week}`, { signal }),
  getDay: (cycleId: number, week: number, day: number, signal?: AbortSignal) =>
    api.get<DayDetail>(dayPath(cycleId, week, day), { signal }),
  putDay: (cycleId: number, week: number, day: number, input: DayUpsertInput) =>
    api.put<DayDetail>(dayPath(cycleId, week, day), input),
  clearDay: (cycleId: number, week: number, day: number) => api.delete(dayPath(cycleId, week, day)),
  clearWeek: (cycleId: number, week: number) => api.delete(`/cycles/${cycleId}/weeks/${week}/days`),

  addMuscleGroup: (cycleId: number, week: number, day: number, muscleGroupId: number) =>
    api.post<DayDetail>(`${dayPath(cycleId, week, day)}/muscle-groups`, { muscle_group_id: muscleGroupId }),
  removeMuscleGroup: (cycleId: number, week: number, day: number, muscleGroupId: number) =>
    api.delete<DayDetail>(`${dayPath(cycleId, week, day)}/muscle-groups/${muscleGroupId}`),

  addExercise: (cycleId: number, week: number, day: number, muscleGroupId: number, input: ExerciseAssignmentInput) =>
    api.post<DayDetail>(`${dayPath(cycleId, week, day)}/muscle-groups/${muscleGroupId}/exercises`, input),
  updateExercise: (itemId: number, input: ExerciseAssignmentInput) =>
    api.put<DayDetail>(`/schedule-exercises/${itemId}`, input),
  removeExercise: (itemId: number) => api.delete<DayDetail>(`/schedule-exercises/${itemId}`),
  reorderExercises: (cycleId: number, week: number, day: number, muscleGroupId: number, ids: number[]) =>
    api.put<DayDetail>(`${dayPath(cycleId, week, day)}/muscle-groups/${muscleGroupId}/exercises/order`,
      { schedule_exercise_ids: ids }),

  addCardio: (cycleId: number, week: number, day: number, input: CardioInput) =>
    api.post<DayDetail>(`${dayPath(cycleId, week, day)}/cardio`, input),
  updateCardio: (itemId: number, input: CardioInput) => api.put<DayDetail>(`/schedule-cardio/${itemId}`, input),
  removeCardio: (itemId: number) => api.delete<DayDetail>(`/schedule-cardio/${itemId}`),

  copyDay: (cycleId: number, week: number, day: number, targetWeek: number, targetDay: number, overwrite: boolean) =>
    api.post<DayDetail>(`${dayPath(cycleId, week, day)}/copy`,
      { target_week_number: targetWeek, target_day_of_week: targetDay, overwrite }),
  copyWeek: (cycleId: number, week: number, targetWeeks: number[], overwrite: boolean) =>
    api.post<CopyResult>(`/cycles/${cycleId}/weeks/${week}/copy`, { target_week_numbers: targetWeeks, overwrite }),
};

export const planningMasterData = {
  cardioActivities: (signal?: AbortSignal) => api.get<CardioActivity[]>("/cardio-activities", { signal }),
};
