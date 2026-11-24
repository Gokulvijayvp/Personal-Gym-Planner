"""Read-only analytics over completed workouts. Weights are kilograms and distances kilometres (canonical units);
the client converts for display. Nothing here is estimated: every number is counted from logged records."""
import datetime as dt

from pydantic import BaseModel, Field


class RangeInfo(BaseModel):
    start: dt.date | None = Field(description="First date counted (for 'all time': the first completed workout; null when there is none)")
    end: dt.date = Field(description="Last date counted: never later than today in Asia/Kolkata")
    days: int = Field(description="Calendar days from start to end, inclusive (0 when empty)")
    all_time: bool
    end_clamped: bool = Field(description="The requested end was in the future, so today was used")


# ---- overview -------------------------------------------------------------------------------

class Overview(BaseModel):
    range: RangeInfo
    workouts: int
    training_days: int = Field(description="Distinct dates with at least one completed workout")
    completed_sets: int
    volume_kg: float = Field(description="Sum of weight x reps over completed sets with an external load and reps")
    duration_seconds: int = Field(description="Sum of (ended - started) over completed workouts")
    average_duration_seconds: int | None = Field(description="duration / workouts; null with no workouts")
    training_days_per_week: float | None = Field(description="training days / (days / 7); null for ranges under 7 days")
    workouts_per_week: float | None


# ---- consistency ----------------------------------------------------------------------------

class Bucket(BaseModel):
    label: str
    start: dt.date
    end: dt.date
    workouts: int
    training_days: int
    partial: bool = Field(description="The selected range cuts this period, so it is not a full week / month")


class FrequencyBin(BaseModel):
    label: str
    weeks: int


class Consistency(BaseModel):
    range: RangeInfo
    workouts: int
    training_days: int
    average_workouts_per_week: float | None
    average_training_days_per_week: float | None
    weeks: list[Bucket]
    weeks_truncated: bool
    months: list[Bucket]
    frequency: list[FrequencyBin] = Field(description="How many full Monday-Sunday weeks had 0, 1, 2, 3 and 4+ training days")


# ---- exercises ------------------------------------------------------------------------------

class ExerciseOption(BaseModel):
    key: str = Field(description="'id:<exercise id>' or, for an exercise deleted from the library, 'name:<lower-case name>'")
    exercise_id: int | None
    name: str
    completed_sets: int
    sessions: int
    last_date: dt.date
    best_weight_kg: float | None


class ExerciseOptions(BaseModel):
    range: RangeInfo
    exercises: list[ExerciseOption]


class DayPoint(BaseModel):
    date: dt.date
    sets: int
    best_weight_kg: float | None = Field(description="Heaviest completed externally loaded set that day")
    reps_at_best_weight: int | None
    max_reps: int | None = Field(description="Most reps in a single completed set that day (any load, including bodyweight)")
    total_reps: int
    volume_kg: float


class RepsAtWeight(BaseModel):
    weight_kg: float
    best_reps: int
    date: dt.date


class Best(BaseModel):
    value: float
    date: dt.date


class Improvement(BaseModel):
    from_date: dt.date
    to_date: dt.date
    from_weight_kg: float
    to_weight_kg: float
    change_kg: float
    change_percent: float


class ExerciseProgress(BaseModel):
    range: RangeInfo
    key: str
    exercise_id: int | None
    name: str
    completed_sets: int
    sessions: int
    training_days: int
    sessions_per_week: float | None
    best_weight: Best | None = Field(description="Heaviest completed external load in range; the first date it was reached")
    best_reps: Best | None
    total_volume_kg: float
    series: list[DayPoint]
    reps_at_weight: list[RepsAtWeight]
    improvement: Improvement | None
    improvement_note: str | None = Field(description="Why no improvement figure is given")


# ---- volume ---------------------------------------------------------------------------------

class VolumeBucket(BaseModel):
    label: str
    start: dt.date
    end: dt.date
    volume_kg: float
    partial: bool


class VolumeShare(BaseModel):
    name: str
    key: str | None = None
    volume_kg: float
    completed_sets: int


class Volume(BaseModel):
    range: RangeInfo
    total_volume_kg: float
    counted_sets: int = Field(description="Completed sets with an external load and reps: the sets that make up the volume")
    excluded_sets: int = Field(description="Completed sets left out of volume (bodyweight, or no reps)")
    weeks: list[VolumeBucket]
    months: list[VolumeBucket]
    by_exercise: list[VolumeShare]
    by_muscle_group: list[VolumeShare]
    unassigned_kg: float


# ---- personal records -----------------------------------------------------------------------

class SetRecord(BaseModel):
    weight_kg: float
    reps: int | None
    volume_kg: float | None
    date: dt.date
    session_id: int
    in_range: bool


class RepsRecord(BaseModel):
    reps: int
    date: dt.date
    session_id: int
    in_range: bool


class WeightReps(BaseModel):
    weight_kg: float
    reps: int
    date: dt.date
    session_id: int
    in_range: bool


class ExerciseRecords(BaseModel):
    key: str
    exercise_id: int | None
    name: str
    max_weight: SetRecord | None
    max_set_volume: SetRecord | None
    reps_at_weight: list[WeightReps] = Field(description="Best reps at each of the heaviest weights used")
    max_bodyweight_reps: RepsRecord | None


class PersonalRecords(BaseModel):
    range: RangeInfo
    records: list[ExerciseRecords]
    new_in_range: int = Field(description="Records first reached inside the selected range")


# ---- muscle groups --------------------------------------------------------------------------

class MuscleGroupShare(BaseModel):
    name: str
    completed_sets: int
    percent_of_sets: float
    sessions: int
    exercises: int
    sessions_per_week: float | None


class MuscleGroups(BaseModel):
    range: RangeInfo
    total_sets: int
    groups: list[MuscleGroupShare]


# ---- cardio ---------------------------------------------------------------------------------

class CardioActivityStat(BaseModel):
    name: str
    entries: int
    minutes: int
    distance_km: float
    entries_with_distance: int
    last_date: dt.date


class CardioPoint(BaseModel):
    date: dt.date
    distance_km: float
    minutes: int | None


class Cardio(BaseModel):
    range: RangeInfo
    entries: int
    sessions: int
    total_minutes: int
    total_distance_km: float
    entries_with_distance: int
    calories_logged: int = Field(description="Sum of calories you typed in; entries without calories add nothing")
    calories_entries: int
    activities: list[CardioActivityStat]
    activity: str | None
    series: list[CardioPoint] = Field(description="Distance per day for the selected activity only")
