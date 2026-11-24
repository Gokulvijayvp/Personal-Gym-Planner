/** Mirrors backend `app.schemas.plan_share`. */
export type ShareKind = "day" | "week";

export interface PlanShareCreated { code: string; kind: ShareKind; days_count: number; expires_at: string }

export interface PlanShareDay {
  day_of_week: number;
  name: string;
  status: string;
  title: string | null;
  muscle_groups: string[];
  exercise_count: number;
  cardio_count: number;
}

export interface PlanSharePreview { kind: ShareKind; days: PlanShareDay[]; new_exercises: string[]; expires_at: string }

export interface PlanImportRequest {
  code: string;
  cycle_id: number;
  week_number: number;
  day_of_week?: number | null;
  confirm_replace?: boolean;
}

export interface PlanImportResult { kind: ShareKind; replaced_days: number; imported_days: number; added_exercises: string[] }
