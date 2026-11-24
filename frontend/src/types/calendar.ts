/** Mirrors backend `app.schemas.calendar`. */
import type { DateString } from "./api";
import type { CycleBrief, DayDetail } from "./planner";
import type { SessionRef } from "./workout";

export interface CalendarDay {
  date: DateString;
  day_of_week: number;                 // Monday=0 .. Sunday=6
  cycle: CycleBrief | null;            // the cycle shown for this date
  week_number: number | null;          // 1-based week of that cycle
  also_covered_by: CycleBrief[];       // other cycles whose dates include this date
  plan: DayDetail | null;              // null when no cycle covers the date
  workout: SessionRef | null;          // the logged workout for this date (unfinished, else completed)
}

export interface CalendarResponse {
  start: DateString;
  end: DateString;
  timezone: string;
  today: DateString;
  days: CalendarDay[];
}
