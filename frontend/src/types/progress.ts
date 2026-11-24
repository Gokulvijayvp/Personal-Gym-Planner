/** Mirrors backend `app.schemas.progress`. Weights are kilograms and distances kilometres; the page converts for display. */
import type { DateString } from "./api";

export interface RangeInfo { start: DateString | null; end: DateString; days: number; all_time: boolean; end_clamped: boolean }

export interface Overview {
  range: RangeInfo;
  workouts: number;
  training_days: number;
  completed_sets: number;
  volume_kg: number;
  duration_seconds: number;
  average_duration_seconds: number | null;
  training_days_per_week: number | null;
  workouts_per_week: number | null;
}

export interface Bucket { label: string; start: DateString; end: DateString; workouts: number; training_days: number; partial: boolean }
export interface FrequencyBin { label: string; weeks: number }
export interface Consistency {
  range: RangeInfo;
  workouts: number;
  training_days: number;
  average_workouts_per_week: number | null;
  average_training_days_per_week: number | null;
  weeks: Bucket[];
  weeks_truncated: boolean;
  months: Bucket[];
  frequency: FrequencyBin[];
}

export interface ExerciseOption {
  key: string; exercise_id: number | null; name: string; completed_sets: number; sessions: number; last_date: DateString; best_weight_kg: number | null;
}
export interface ExerciseOptions { range: RangeInfo; exercises: ExerciseOption[] }

export interface DayPoint {
  date: DateString; sets: number; best_weight_kg: number | null; reps_at_best_weight: number | null; max_reps: number | null; total_reps: number; volume_kg: number;
}
export interface RepsAtWeight { weight_kg: number; best_reps: number; date: DateString }
export interface Best { value: number; date: DateString }
export interface Improvement {
  from_date: DateString; to_date: DateString; from_weight_kg: number; to_weight_kg: number; change_kg: number; change_percent: number;
}
export interface ExerciseProgress {
  range: RangeInfo; key: string; exercise_id: number | null; name: string; completed_sets: number; sessions: number; training_days: number;
  sessions_per_week: number | null; best_weight: Best | null; best_reps: Best | null; total_volume_kg: number; series: DayPoint[];
  reps_at_weight: RepsAtWeight[]; improvement: Improvement | null; improvement_note: string | null;
}

export interface VolumeBucket { label: string; start: DateString; end: DateString; volume_kg: number; partial: boolean }
export interface VolumeShare { name: string; key: string | null; volume_kg: number; completed_sets: number }
export interface Volume {
  range: RangeInfo; total_volume_kg: number; counted_sets: number; excluded_sets: number; weeks: VolumeBucket[]; months: VolumeBucket[];
  by_exercise: VolumeShare[]; by_muscle_group: VolumeShare[]; unassigned_kg: number;
}

export interface SetRecord { weight_kg: number; reps: number | null; volume_kg: number | null; date: DateString; session_id: number; in_range: boolean }
export interface RepsRecord { reps: number; date: DateString; session_id: number; in_range: boolean }
export interface WeightReps { weight_kg: number; reps: number; date: DateString; session_id: number; in_range: boolean }
export interface ExerciseRecords {
  key: string; exercise_id: number | null; name: string; max_weight: SetRecord | null; max_set_volume: SetRecord | null;
  reps_at_weight: WeightReps[]; max_bodyweight_reps: RepsRecord | null;
}
export interface PersonalRecords { range: RangeInfo; records: ExerciseRecords[]; new_in_range: number }

export interface MuscleGroupShare {
  name: string; completed_sets: number; percent_of_sets: number; sessions: number; exercises: number; sessions_per_week: number | null;
}
export interface MuscleGroups { range: RangeInfo; total_sets: number; groups: MuscleGroupShare[] }

export interface CardioActivityStat { name: string; entries: number; minutes: number; distance_km: number; entries_with_distance: number; last_date: DateString }
export interface CardioPoint { date: DateString; distance_km: number; minutes: number | null }
export interface Cardio {
  range: RangeInfo; entries: number; sessions: number; total_minutes: number; total_distance_km: number; entries_with_distance: number;
  calories_logged: number; calories_entries: number; activities: CardioActivityStat[]; activity: string | null; series: CardioPoint[];
}
