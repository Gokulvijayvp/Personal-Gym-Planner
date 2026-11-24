/** Mirrors backend `app.schemas.exercise_set`. */
export interface ExerciseSetExercise { key: string; name: string; equipment: string; icon_motion: string }

export interface ExerciseSet {
  id: number;
  name: string;
  muscle_group: string;
  exercises: ExerciseSetExercise[];
  created_at: string;
}

export interface ExerciseSetInput { name: string; muscle_group: string; exercise_keys: string[] }

export interface ShareCreated { code: string; sets_count: number; expires_at: string }
export interface SharedPreview { sets_count: number; sets: { name: string; muscle_group: string; exercise_count: number }[]; expires_at: string }
export interface ImportResult { removed: number; imported: number; sets: ExerciseSet[] }
