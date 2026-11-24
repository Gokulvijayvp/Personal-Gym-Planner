/** Mirrors backend `app.schemas.exercise_master`. */
import type { UtcDateTimeString } from "./api";

export interface ExerciseMasterRef { id: number; name: string; icon_motion: string }

export interface ExerciseMaster extends ExerciseMasterRef {
  is_active: boolean;
  /** Library exercises linked to this master. */
  usage_count: number;
  created_at: UtcDateTimeString;
  updated_at: UtcDateTimeString;
}

export interface ExerciseMasterList {
  items: ExerciseMaster[];
  /** Allowed icon motions: key -> label. */
  motions: Record<string, string>;
}

export interface ExerciseMasterInput {
  name: string;
  /** Left out on create = guessed from the name; left out on update = unchanged. */
  icon_motion?: string;
}

export interface CardioActivity { id: number; name: string }
