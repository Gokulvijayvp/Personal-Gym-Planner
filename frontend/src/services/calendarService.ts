import type { DateString } from "../types/api";
import type { CalendarResponse } from "../types/calendar";
import { api } from "./client";

/** Read-only. The calendar never creates or changes plans; editing stays in the Weekly Planner. */
export const calendarService = {
  get: (start: DateString, end: DateString, signal?: AbortSignal) =>
    api.get<CalendarResponse>("/calendar", { query: { start, end }, signal }),
};
