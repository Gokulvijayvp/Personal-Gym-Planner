"""Progress analytics: read-only, computed from the workout log, never stored.

Definitions (shared by every endpoint)
* Only **completed** workouts count: in-progress and cancelled sessions are excluded, and so is anything that was
  planned but never logged.
* Only **completed sets / cardio entries** count: pending and skipped ones inside a completed workout are ignored.
* **Dates** are the workout's local calendar date (Asia/Kolkata), grouped into Monday-first weeks and calendar months.
  The range never extends past today, so future days are never "missed".
* An **external load** is a completed set with a weight greater than zero. Bodyweight sets (no weight) still count as
  completed sets and reps but are left out of weight progression, volume and weight records.
* **Volume** = weight x reps summed over completed, externally loaded sets that have reps, in kilograms. Weights are
  summed as integer grams so the totals are exact (22.5 kg x 8 never picks up floating-point dust).
* An **exercise** is its library id (so a rename keeps its history together); an exercise deleted from the library is
  identified by its logged name.
* **Ties** for a record are broken by the *earliest* date the value was reached (a record is first set once).
"""
import calendar
from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy import Integer, String, and_, case, cast, distinct, func, literal, select
from sqlalchemy.orm import Session

from app.db.sqlfuncs import epoch_seconds
from app.core.errors import AppError
from app.core.timezone import start_of_week, today_local
from app.models import WorkoutSession as S, WorkoutSessionCardio as C, WorkoutSessionExercise as E, WorkoutSessionSet as T
from app.schemas.common import ErrorDetail
from app.schemas.progress import (
    Best, Bucket, Cardio, CardioActivityStat, CardioPoint, Consistency, DayPoint, ExerciseOption, ExerciseOptions,
    ExerciseProgress, ExerciseRecords, FrequencyBin, Improvement, MuscleGroups, MuscleGroupShare, Overview,
    PersonalRecords, RangeInfo, RepsAtWeight, RepsRecord, SetRecord, Volume, VolumeBucket, VolumeShare, WeightReps,
)

MIN_YEAR, MAX_YEAR = 2000, 2100
MAX_WEEK_BUCKETS = 104
UNASSIGNED = "Unassigned"


# ---- helpers ---------------------------------------------------------------------------------------

def _invalid(field: str, message: str) -> AppError:
    return AppError(422, "Some of the submitted values are invalid.", code="validation_error",
                    details=[ErrorDetail(field=field, message=message, type="value_error")])


def grams(col):
    """kg (3 decimals) -> integer grams. Exact, so sums of weights never pick up float error."""
    return cast(func.round(col * 1000), Integer)


def to_kg(g: int | None) -> float | None:
    return None if g is None else round(int(g) / 1000, 3)


KEY = case((E.exercise_id.is_not(None), literal("id:") + cast(E.exercise_id, String)), else_=literal("name:") + func.lower(E.exercise_name))
DONE_SET = T.status == "completed"
LOADED = and_(DONE_SET, T.actual_weight_kg.is_not(None), T.actual_weight_kg > 0)          # completed set with an external load
LOADED_VOL = and_(LOADED, T.actual_reps.is_not(None))
GROUP_NAME = func.coalesce(func.nullif(func.trim(E.muscle_group_name), ""), UNASSIGNED)


def _sets_from():
    return select().select_from(T).join(E, E.id == T.session_exercise_id).join(S, S.id == E.session_id)


class Range:
    def __init__(self, start: date | None, end: date, all_time: bool, clamped: bool):
        self.start, self.end, self.all_time, self.clamped = start, end, all_time, clamped
        self.empty = start is None or end < start
        self.days = 0 if self.empty else (end - start).days + 1

    @property
    def weeks(self) -> float:
        return self.days / 7

    def per_week(self, n: float) -> float | None:
        """A per-week average, only for ranges of at least a week (shorter spans would exaggerate it)."""
        return round(n / self.weeks, 2) if self.days >= 7 else None

    def info(self) -> RangeInfo:
        return RangeInfo(start=self.start, end=self.end, days=self.days, all_time=self.all_time, end_clamped=self.clamped)


def resolve_range(db: Session, start: date | None, end: date | None) -> Range:
    for name, value in (("start", start), ("end", end)):
        if value is not None and not MIN_YEAR <= value.year <= MAX_YEAR:
            raise _invalid(name, f"Date must be between the years {MIN_YEAR} and {MAX_YEAR}.")
    if start is not None and end is not None and end < start:
        raise _invalid("end", "End date must be on or after the start date.")
    today = today_local()
    eff_end = min(end, today) if end is not None else today
    clamped = end is not None and end > today
    if start is None:                                          # all time: from the first completed workout
        first = db.scalar(select(func.min(S.workout_date)).where(S.status == "completed", S.workout_date <= eff_end))
        return Range(first, eff_end, True, clamped)
    return Range(start, eff_end, False, clamped)


def _done(r: Range):
    return [S.status == "completed", S.workout_date >= r.start, S.workout_date <= r.end]


def _latest_names(db: Session, conds) -> dict[str, tuple[str, int | None]]:
    """key -> (most recent logged name, library id). The newest row per exercise (latest date, then latest entry),
    chosen with a window function so it behaves the same on SQLite and PostgreSQL."""
    rank = func.row_number().over(partition_by=KEY, order_by=(S.workout_date.desc(), E.id.desc())).label("rn")
    ranked = (select(KEY.label("k"), E.exercise_name.label("n"), E.exercise_id.label("i"), rank)
              .select_from(E).join(S, S.id == E.session_id).where(S.status == "completed", *conds).subquery())
    return {k: (name, eid) for k, name, eid in db.execute(select(ranked.c.k, ranked.c.n, ranked.c.i).where(ranked.c.rn == 1))}


def parse_key(key: str) -> tuple[int | None, str | None]:
    kind, _, value = key.partition(":")
    if kind == "id" and value.isdigit() and int(value) > 0:
        return int(value), None
    if kind == "name" and value.strip():
        return None, value.strip().lower()
    raise _invalid("key", "Use 'id:<exercise id>' or 'name:<exercise name>'.")


def _key_cond(exercise_id: int | None, name: str | None):
    return E.exercise_id == exercise_id if exercise_id is not None else and_(E.exercise_id.is_(None), func.lower(E.exercise_name) == name)


def _week_label(d: date) -> str:
    return d.isoformat()


def _month_end(d: date) -> date:
    return d.replace(day=calendar.monthrange(d.year, d.month)[1])


def _weeks(r: Range):
    """Monday-first weeks overlapping the range: (monday, sunday, first counted day, last counted day, partial)."""
    out, monday = [], start_of_week(r.start)
    while monday <= r.end:
        sunday = monday + timedelta(days=6)
        out.append((monday, sunday, max(monday, r.start), min(sunday, r.end), monday < r.start or sunday > r.end))
        monday += timedelta(days=7)
    return out


def _months(r: Range):
    out, first = [], r.start.replace(day=1)
    while first <= r.end:
        last = _month_end(first)
        out.append((first, last, max(first, r.start), min(last, r.end), first < r.start or last > r.end))
        first = last + timedelta(days=1)
    return out


def _sum_days(per_day: dict[date, int], lo: date, hi: date) -> int:
    return sum(v for d, v in per_day.items() if lo <= d <= hi)


# ---- overview ---------------------------------------------------------------------------------------

def overview(db: Session, start: date | None, end: date | None) -> Overview:
    r = resolve_range(db, start, end)
    if r.empty:
        return Overview(range=r.info(), workouts=0, training_days=0, completed_sets=0, volume_kg=0, duration_seconds=0,
                        average_duration_seconds=None, training_days_per_week=None, workouts_per_week=None)
    seconds = epoch_seconds(S.ended_at) - epoch_seconds(S.started_at)
    workouts, days, duration = db.execute(select(func.count(S.id), func.count(distinct(S.workout_date)), func.coalesce(func.sum(seconds), 0))
                                          .where(*_done(r))).one()
    sets, vol_g = db.execute(_sets_from().with_only_columns(
        func.count(T.id).filter(DONE_SET), func.coalesce(func.sum(case((LOADED_VOL, grams(T.actual_weight_kg) * T.actual_reps), else_=0)), 0)
    ).where(*_done(r))).one()
    return Overview(
        range=r.info(), workouts=workouts, training_days=days, completed_sets=sets, volume_kg=to_kg(vol_g) or 0,
        duration_seconds=int(duration), average_duration_seconds=round(duration / workouts) if workouts else None,
        training_days_per_week=r.per_week(days), workouts_per_week=r.per_week(workouts))


# ---- consistency ------------------------------------------------------------------------------------

def consistency(db: Session, start: date | None, end: date | None) -> Consistency:
    r = resolve_range(db, start, end)
    if r.empty:
        return Consistency(range=r.info(), workouts=0, training_days=0, average_workouts_per_week=None, average_training_days_per_week=None,
                           weeks=[], weeks_truncated=False, months=[], frequency=_frequency([]))
    per_day = {d: n for d, n in db.execute(select(S.workout_date, func.count(S.id)).where(*_done(r)).group_by(S.workout_date))}

    def bucket(label: str, lo: date, hi: date, partial: bool, first: date, last: date) -> Bucket:
        days = [d for d in per_day if first <= d <= last]
        return Bucket(label=label, start=lo, end=hi, workouts=sum(per_day[d] for d in days), training_days=len(days), partial=partial)

    weeks = [bucket(_week_label(m), m, s, p, a, b) for m, s, a, b, p in _weeks(r)]
    truncated = len(weeks) > MAX_WEEK_BUCKETS
    months = [bucket(f"{m:%Y-%m}", m, e, p, a, b) for m, e, a, b, p in _months(r)]
    total_workouts = sum(per_day.values())
    return Consistency(
        range=r.info(), workouts=total_workouts, training_days=len(per_day), average_workouts_per_week=r.per_week(total_workouts),
        average_training_days_per_week=r.per_week(len(per_day)), weeks=weeks[-MAX_WEEK_BUCKETS:], weeks_truncated=truncated,
        months=months, frequency=_frequency([w.training_days for w in weeks if not w.partial]))


def _frequency(full_week_days: list[int]) -> list[FrequencyBin]:
    labels = ["0", "1", "2", "3", "4+"]
    counts = [0] * 5
    for n in full_week_days:
        counts[min(n, 4)] += 1
    return [FrequencyBin(label=l, weeks=c) for l, c in zip(labels, counts)]


# ---- exercises --------------------------------------------------------------------------------------

def exercise_options(db: Session, start: date | None, end: date | None) -> ExerciseOptions:
    r = resolve_range(db, start, end)
    if r.empty:
        return ExerciseOptions(range=r.info(), exercises=[])
    rows = db.execute(_sets_from().with_only_columns(
        KEY, func.count(T.id), func.count(distinct(S.id)), func.max(S.workout_date), func.max(case((LOADED, grams(T.actual_weight_kg))))
    ).where(*_done(r), DONE_SET).group_by(KEY)).all()
    names = _latest_names(db, [S.workout_date >= r.start, S.workout_date <= r.end])
    items = [ExerciseOption(key=k, exercise_id=names[k][1], name=names[k][0], completed_sets=n, sessions=s, last_date=last, best_weight_kg=to_kg(best))
             for k, n, s, last, best in rows]
    return ExerciseOptions(range=r.info(), exercises=sorted(items, key=lambda x: x.name.lower()))


def exercise_progress(db: Session, key: str, start: date | None, end: date | None) -> ExerciseProgress:
    exercise_id, name = parse_key(key)
    r = resolve_range(db, start, end)
    cond = _key_cond(exercise_id, name)
    latest = db.execute(select(E.exercise_name, E.exercise_id).select_from(E).join(S, S.id == E.session_id)
                        .where(S.status == "completed", cond).order_by(S.workout_date.desc(), E.id.desc()).limit(1)).first()
    if latest is None:
        raise AppError(404, "No completed workouts include that exercise.", code="exercise_not_found")
    base = dict(range=r.info(), key=key, exercise_id=latest[1], name=latest[0])
    rows = [] if r.empty else db.execute(
        _sets_from().with_only_columns(S.workout_date, S.id, grams(T.actual_weight_kg), T.actual_reps)
        .where(*_done(r), DONE_SET, cond).order_by(S.workout_date, T.id)).all()
    if not rows:
        return ExerciseProgress(**base, completed_sets=0, sessions=0, training_days=0, sessions_per_week=None, best_weight=None, best_reps=None,
                                total_volume_kg=0, series=[], reps_at_weight=[], improvement=None,
                                improvement_note="No completed sets for this exercise in the selected range.")

    by_day: dict[date, list] = defaultdict(list)
    for d, session_id, g, reps in rows:
        loaded = g is not None and g > 0
        by_day[d].append((session_id, g if loaded else None, reps))
    series, volume_total = [], 0
    best_weight: tuple[int, date] | None = None
    best_reps: tuple[int, date] | None = None
    first_date = {}
    for d in sorted(by_day):
        sets = by_day[d]
        loaded = [(g, reps) for _, g, reps in sets if g is not None]
        reps_all = [reps for _, _, reps in sets if reps is not None]
        top = max((g for g, _ in loaded), default=None)
        at_top = [reps for g, reps in loaded if g == top and reps is not None]
        vol = sum(g * reps for g, reps in loaded if reps is not None)
        volume_total += vol
        series.append(DayPoint(date=d, sets=len(sets), best_weight_kg=to_kg(top), reps_at_best_weight=max(at_top, default=None),
                               max_reps=max(reps_all, default=None), total_reps=sum(reps_all), volume_kg=to_kg(vol) or 0))
        if top is not None and (best_weight is None or top > best_weight[0]):
            best_weight = (top, d)                                  # strictly greater: the first date a weight was reached wins ties
        if reps_all and (best_reps is None or max(reps_all) > best_reps[0]):
            best_reps = (max(reps_all), d)
        first_date.setdefault(d, d)

    reps_at: dict[int, tuple[int, date]] = {}
    for d, _, g, reps in rows:
        if g is None or g <= 0 or reps is None:
            continue
        cur = reps_at.get(g)
        if cur is None or reps > cur[0]:
            reps_at[g] = (reps, d)                                   # rows are date-ordered: the earliest date for a rep count is kept
    table = [RepsAtWeight(weight_kg=to_kg(g), best_reps=v[0], date=v[1]) for g, v in sorted(reps_at.items(), reverse=True)[:10]]

    weighted_dates = [p for p in series if p.best_weight_kg is not None]
    improvement, note = None, None
    if not weighted_dates:
        note = "No external weight was logged for this exercise in this range."
    elif len(weighted_dates) < 3 or (weighted_dates[-1].date - weighted_dates[0].date).days < 14:
        note = "Needs at least 3 training dates with a logged weight, spread over 14 days or more, before a change is shown."
    else:
        a, b = weighted_dates[0], weighted_dates[-1]
        improvement = Improvement(from_date=a.date, to_date=b.date, from_weight_kg=a.best_weight_kg, to_weight_kg=b.best_weight_kg,
                                  change_kg=round(b.best_weight_kg - a.best_weight_kg, 3),
                                  change_percent=round((b.best_weight_kg - a.best_weight_kg) / a.best_weight_kg * 100, 1))
    sessions = len({sid for _, sid, _, _ in rows})
    return ExerciseProgress(
        **base, completed_sets=len(rows), sessions=sessions, training_days=len(by_day), sessions_per_week=r.per_week(sessions),
        best_weight=Best(value=to_kg(best_weight[0]), date=best_weight[1]) if best_weight else None,
        best_reps=Best(value=best_reps[0], date=best_reps[1]) if best_reps else None,
        total_volume_kg=to_kg(volume_total) or 0, series=series, reps_at_weight=table, improvement=improvement, improvement_note=note)


# ---- volume -----------------------------------------------------------------------------------------

def volume(db: Session, start: date | None, end: date | None) -> Volume:
    r = resolve_range(db, start, end)
    if r.empty:
        return Volume(range=r.info(), total_volume_kg=0, counted_sets=0, excluded_sets=0, weeks=[], months=[], by_exercise=[], by_muscle_group=[], unassigned_kg=0)
    vol = grams(T.actual_weight_kg) * T.actual_reps
    per_day = {d: int(v) for d, v in db.execute(_sets_from().with_only_columns(S.workout_date, func.sum(vol)).where(*_done(r), LOADED_VOL).group_by(S.workout_date))}
    counted = db.scalar(_sets_from().with_only_columns(func.count(T.id)).where(*_done(r), LOADED_VOL)) or 0
    completed = db.scalar(_sets_from().with_only_columns(func.count(T.id)).where(*_done(r), DONE_SET)) or 0

    by_ex = db.execute(_sets_from().with_only_columns(KEY, func.sum(vol), func.count(T.id)).where(*_done(r), LOADED_VOL).group_by(KEY)
                       .order_by(func.sum(vol).desc()).limit(50)).all()
    names = _latest_names(db, [S.workout_date >= r.start, S.workout_date <= r.end])
    by_group = db.execute(_sets_from().with_only_columns(GROUP_NAME, func.sum(vol), func.count(T.id)).where(*_done(r), LOADED_VOL)
                          .group_by(GROUP_NAME).order_by(func.sum(vol).desc())).all()
    groups = [VolumeShare(name=n, volume_kg=to_kg(v) or 0, completed_sets=c) for n, v, c in by_group if n != UNASSIGNED]
    unassigned = next((to_kg(v) or 0 for n, v, _ in by_group if n == UNASSIGNED), 0)
    return Volume(
        range=r.info(), total_volume_kg=to_kg(sum(per_day.values())) or 0, counted_sets=counted, excluded_sets=completed - counted,
        weeks=[VolumeBucket(label=m.isoformat(), start=m, end=e, volume_kg=to_kg(_sum_days(per_day, a, b)) or 0, partial=p) for m, e, a, b, p in _weeks(r)][-MAX_WEEK_BUCKETS:],
        months=[VolumeBucket(label=f"{m:%Y-%m}", start=m, end=e, volume_kg=to_kg(_sum_days(per_day, a, b)) or 0, partial=p) for m, e, a, b, p in _months(r)],
        by_exercise=[VolumeShare(name=names[k][0], key=k, volume_kg=to_kg(v) or 0, completed_sets=c) for k, v, c in by_ex],
        by_muscle_group=groups, unassigned_kg=unassigned)


# ---- personal records -------------------------------------------------------------------------------

def personal_records(db: Session, start: date | None, end: date | None) -> PersonalRecords:
    """Records are all-time up to the range's end (a PR is a PR whatever the filter); `in_range` marks the new ones.

    One aggregate row per distinct (exercise, weight, reps) keeps the work small; ties go to the earliest date.
    """
    r = resolve_range(db, start, end)
    if r.empty:
        return PersonalRecords(range=r.info(), records=[], new_in_range=0)
    upto = [S.status == "completed", S.workout_date <= r.end]
    wg = grams(T.actual_weight_kg)

    combos: dict[str, list[tuple[int, int | None, date, int]]] = defaultdict(list)       # key -> (grams, reps, first date, session id)
    seen_combo: set[tuple] = set()
    for k, g, reps, d, sid in db.execute(_sets_from().with_only_columns(KEY, wg, T.actual_reps, S.workout_date, S.id)
                                         .where(*upto, LOADED).order_by(S.workout_date, S.id)):
        if (k, g, reps) not in seen_combo:                       # the first row per combination is its earliest
            seen_combo.add((k, g, reps))
            combos[k].append((g, reps, d, sid))
    bodyweight: dict[str, tuple[int, date, int]] = {}
    seen_bw: set[tuple] = set()
    for k, reps, d, sid in db.execute(_sets_from().with_only_columns(KEY, T.actual_reps, S.workout_date, S.id)
                                      .where(*upto, DONE_SET, T.actual_reps.is_not(None), func.coalesce(T.actual_weight_kg, 0) <= 0)
                                      .order_by(S.workout_date, S.id)):
        if (k, reps) in seen_bw:
            continue
        seen_bw.add((k, reps))
        cur = bodyweight.get(k)
        if cur is None or (reps, -d.toordinal(), -sid) > (cur[0], -cur[1].toordinal(), -cur[2]):
            bodyweight[k] = (reps, d, sid)

    names = _latest_names(db, [S.workout_date <= r.end])
    fresh = lambda d: d >= r.start
    records = []
    for k in sorted(set(combos) | set(bodyweight), key=lambda x: names[x][0].lower()):
        rows = combos.get(k, [])
        max_weight = max_volume = None
        by_weight: dict[int, tuple[int, date, int]] = {}
        if rows:
            top = max(g for g, *_ in rows)
            at_top = [(reps if reps is not None else -1, -d.toordinal(), -sid, reps, d, sid) for g, reps, d, sid in rows if g == top]
            _, _, _, reps, d, sid = max(at_top)
            max_weight = SetRecord(weight_kg=to_kg(top), reps=reps, volume_kg=to_kg(top * reps) if reps is not None else None,
                                   date=d, session_id=sid, in_range=fresh(d))
            with_reps = [(g * reps, -d.toordinal(), -sid, g, reps, d, sid) for g, reps, d, sid in rows if reps is not None]
            if with_reps:
                v, _, _, g, reps, d, sid = max(with_reps)
                max_volume = SetRecord(weight_kg=to_kg(g), reps=reps, volume_kg=to_kg(v), date=d, session_id=sid, in_range=fresh(d))
            for g, reps, d, sid in rows:
                if reps is None:
                    continue
                cur = by_weight.get(g)
                if cur is None or (reps, -d.toordinal(), -sid) > (cur[0], -cur[1].toordinal(), -cur[2]):
                    by_weight[g] = (reps, d, sid)
        bw = bodyweight.get(k)
        records.append(ExerciseRecords(
            key=k, exercise_id=names[k][1], name=names[k][0], max_weight=max_weight, max_set_volume=max_volume,
            reps_at_weight=[WeightReps(weight_kg=to_kg(g), reps=v[0], date=v[1], session_id=v[2], in_range=fresh(v[1]))
                            for g, v in sorted(by_weight.items(), reverse=True)[:5]],
            max_bodyweight_reps=RepsRecord(reps=bw[0], date=bw[1], session_id=bw[2], in_range=fresh(bw[1])) if bw else None))
    new = sum(1 for rec in records for x in (rec.max_weight, rec.max_set_volume, rec.max_bodyweight_reps) if x is not None and x.in_range)
    return PersonalRecords(range=r.info(), records=records, new_in_range=new)


# ---- muscle groups ----------------------------------------------------------------------------------

def muscle_groups(db: Session, start: date | None, end: date | None) -> MuscleGroups:
    """Primary muscle group as logged with each exercise; anything without one is 'Unassigned' (never guessed)."""
    r = resolve_range(db, start, end)
    if r.empty:
        return MuscleGroups(range=r.info(), total_sets=0, groups=[])
    rows = db.execute(_sets_from().with_only_columns(GROUP_NAME, func.count(T.id), func.count(distinct(S.id)), func.count(distinct(KEY)))
                      .where(*_done(r), DONE_SET).group_by(GROUP_NAME)).all()
    total = sum(n for _, n, _, _ in rows)
    groups = [MuscleGroupShare(name=name, completed_sets=n, percent_of_sets=round(n / total * 100, 1), sessions=sessions, exercises=ex,
                               sessions_per_week=r.per_week(sessions)) for name, n, sessions, ex in rows]
    groups.sort(key=lambda g: (g.name == UNASSIGNED, -g.completed_sets, g.name))
    return MuscleGroups(range=r.info(), total_sets=total, groups=groups)


# ---- cardio -----------------------------------------------------------------------------------------

def cardio(db: Session, start: date | None, end: date | None, activity: str | None) -> Cardio:
    r = resolve_range(db, start, end)
    if r.empty:
        return Cardio(range=r.info(), entries=0, sessions=0, total_minutes=0, total_distance_km=0, entries_with_distance=0,
                      calories_logged=0, calories_entries=0, activities=[], activity=activity, series=[])
    done = [*_done(r), C.status == "completed"]
    meters = grams(C.distance_km)
    base = select().select_from(C).join(S, S.id == C.session_id)
    entries, sessions, minutes, dist_m, with_dist, cal, cal_n = db.execute(base.with_only_columns(
        func.count(C.id), func.count(distinct(S.id)), func.coalesce(func.sum(C.duration_minutes), 0), func.coalesce(func.sum(meters), 0),
        func.count(C.distance_km), func.coalesce(func.sum(C.calories), 0), func.count(C.calories)).where(*done)).one()
    name = func.lower(C.activity_name)
    per = db.execute(base.with_only_columns(func.max(C.activity_name), func.count(C.id), func.coalesce(func.sum(C.duration_minutes), 0),
                                            func.coalesce(func.sum(meters), 0), func.count(C.distance_km), func.max(S.workout_date))
                     .where(*done).group_by(name).order_by(func.sum(C.duration_minutes).desc())).all()
    series = []
    if activity:
        series = [CardioPoint(date=d, distance_km=to_kg(m) or 0, minutes=int(mins) if mins is not None else None)
                  for d, m, mins in db.execute(base.with_only_columns(S.workout_date, func.sum(meters), func.sum(C.duration_minutes))
                                               .where(*done, name == activity.strip().lower(), C.distance_km.is_not(None))
                                               .group_by(S.workout_date).order_by(S.workout_date))]
    return Cardio(
        range=r.info(), entries=entries, sessions=sessions, total_minutes=int(minutes), total_distance_km=to_kg(dist_m) or 0,
        entries_with_distance=with_dist, calories_logged=int(cal), calories_entries=cal_n,
        activities=[CardioActivityStat(name=n, entries=e, minutes=int(m), distance_km=to_kg(dm) or 0, entries_with_distance=de, last_date=last)
                    for n, e, m, dm, de, last in per],
        activity=activity, series=series)
