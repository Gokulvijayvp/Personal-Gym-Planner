import type { UtcDateTimeString } from "./api";

/** Mirrors backend `app.schemas.app_settings`. */
export type WeightUnit = "kg" | "lbs";
export type DistanceUnit = "km" | "miles";
export type WeekStart = "monday" | "sunday";
export type DateFormat = "DD/MM/YYYY" | "DD MMM YYYY" | "YYYY-MM-DD";
export type ResetSection = "workout" | "calendar" | "personal" | "all";

export interface SettingsValues {
  display_name: string | null;
  rest_between_sets_seconds: number;
  rest_between_exercises_seconds: number;
  target_workout_minutes: number;
  weight_unit: WeightUnit;
  distance_unit: DistanceUnit;
  week_start: WeekStart;
  date_format: DateFormat;
}

export interface Settings extends SettingsValues {
  updated_at: UtcDateTimeString;
}

export interface DataInfo {
  /** The signed-in user's OWN numbers (everyone gets them). */
  counts: { exercises: number; cycles: number; planned_days: number; workout_sessions: number };
  /** Server facts: only the Admin receives them. Everyone else gets null / empty. */
  application: string | null;
  api_version: string | null;
  environment: string | null;
  timezone: string | null;
  database_engine: string | null;
  schema_version: string | null;
  database_size_bytes: number | null;
  backup_includes: string[];
}
