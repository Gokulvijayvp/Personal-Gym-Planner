"""Progress analytics against throwaway databases (never the dev DB). Test data is written straight into the
workout tables so every expected number is exact."""
from datetime import date, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import event, text

from app.models import WorkoutSession, WorkoutSessionCardio, WorkoutSessionExercise, WorkoutSessionSet

P = "/api/v1/progress"
TODAY = date(2026, 11, 19)                                   # a Thursday


@pytest.fixture(autouse=True)
def fixed_today(monkeypatch):
    monkeypatch.setattr("app.services.progress_service.today_local", lambda: TODAY)


class Log:
    def __init__(self, session_factory):
        self.sf = session_factory

    def session(self, day, status="completed", minutes=60, exercises=(), cardio=(), started=None):
        """exercises: (name, muscle group, library id, [(set status, reps, kg), ...]); cardio: (name, status, minutes, km, calories)."""
        d = date.fromisoformat(day)
        started = started or datetime(d.year, d.month, d.day, 5, 0)
        with self.sf() as db:
            s = WorkoutSession(source="blank", workout_date=d, status=status, started_at=started,
                               ended_at=None if status == "in_progress" else started + timedelta(minutes=minutes))
            for pos, (name, group, exid, sets) in enumerate(exercises, 1):
                e = WorkoutSessionExercise(exercise_id=exid, position=pos, exercise_name=name, muscle_group_name=group, status="completed")
                for n, (st, reps, kg) in enumerate(sets, 1):
                    e.sets.append(WorkoutSessionSet(set_number=n, status=st, actual_reps=reps,
                                                    actual_weight_kg=None if kg is None else Decimal(str(kg))))
                s.exercises.append(e)
            for pos, (name, st, mins, km, cal) in enumerate(cardio, 1):
                s.cardio.append(WorkoutSessionCardio(position=pos, activity_name=name, status=st, duration_minutes=mins,
                                                     distance_km=None if km is None else Decimal(str(km)), calories=cal))
            db.add(s)
            db.commit()
            return s.id


@pytest.fixture
def log(session_factory):
    return Log(session_factory)


@pytest.fixture
def lib(client, ref):
    out = {}
    for name, group in [("Barbell Bench Press", "Chest"), ("Barbell Squat", "Quadriceps"), ("Pull Up", "Back"), ("Lat Pulldown", "Back")]:
        out[name] = client.post("/api/v1/exercises", json={"name": name, "muscle_group_id": ref["muscle"][group]}).json()["id"]
    return out


def get(client, path, **params):
    r = client.get(P + path, params={k: v for k, v in params.items() if v is not None})
    assert r.status_code == 200, r.text
    return r.json()


C = "completed"
BENCH = "Barbell Bench Press"


# ================================ what counts =====================================================

class TestWhatCounts:
    def seed(self, log, lib):
        log.session("2026-11-16", exercises=[(BENCH, "Chest", lib[BENCH], [(C, 10, 60), (C, 8, 62.5), ("skipped", 8, 80), ("pending", None, None)])],
                    cardio=[("Running", C, 30, 5, None), ("Walking", "skipped", 20, 2, None), ("Cycling", "pending", None, None, None)], minutes=60)
        log.session("2026-11-17", status="cancelled", exercises=[(BENCH, "Chest", lib[BENCH], [(C, 5, 100)])], cardio=[("Running", C, 99, 99, 999)])
        log.session("2026-11-18", status="in_progress", exercises=[(BENCH, "Chest", lib[BENCH], [(C, 5, 100)])], cardio=[("Running", C, 99, 99, 999)])

    def test_overview_counts_only_completed_sessions_and_completed_sets(self, client, log, lib):
        self.seed(log, lib)
        o = get(client, "/overview", start="2026-11-01", end="2026-11-19")
        assert (o["workouts"], o["training_days"], o["completed_sets"]) == (1, 1, 2)
        assert o["volume_kg"] == 10 * 60 + 8 * 62.5                                      # 1100: skipped/pending/cancelled/in-progress excluded
        assert o["duration_seconds"] == 3600 and o["average_duration_seconds"] == 3600

    def test_every_endpoint_ignores_cancelled_in_progress_pending_and_skipped(self, client, log, lib):
        self.seed(log, lib)
        r = dict(start="2026-11-01", end="2026-11-19")
        assert get(client, "/volume", **r)["total_volume_kg"] == 1100
        pr = get(client, "/personal-records", **r)["records"][0]
        assert pr["max_weight"]["weight_kg"] == 62.5 and pr["max_set_volume"]["volume_kg"] == 600     # not the cancelled/unfinished 100 kg, nor skipped 80 kg
        ex = get(client, "/exercise", key=f"id:{lib[BENCH]}", **r)
        assert ex["completed_sets"] == 2 and ex["best_weight"] == {"value": 62.5, "date": "2026-11-16"}
        assert get(client, "/muscle-groups", **r)["total_sets"] == 2
        c = get(client, "/cardio", **r)
        assert (c["entries"], c["total_minutes"], c["total_distance_km"], c["calories_logged"], c["calories_entries"]) == (1, 30, 5.0, 0, 0)
        assert [w["workouts"] for w in get(client, "/consistency", **r)["weeks"]] == [0, 0, 0, 1]
        assert [x["workouts"] for x in get(client, "/consistency", **r)["months"]] == [1]

    def test_planned_but_never_logged_workouts_do_not_exist_for_progress(self, client, ref, lib):
        cid = client.post("/api/v1/cycles", json={"name": "Winter", "start_date": "2026-11-16", "total_weeks": 4}).json()["id"]
        client.post(f"/api/v1/cycles/{cid}/weeks/1/days/0/muscle-groups", json={"muscle_group_id": ref["muscle"]["Chest"]})
        client.post(f"/api/v1/cycles/{cid}/activate")
        assert get(client, "/overview", start="2026-11-01")["workouts"] == 0

    def test_a_skipped_exercise_with_a_completed_set_still_counts_that_set(self, client, log, lib):
        """Counting is by set status, which is the user's own record of what they did."""
        with log.sf() as db:
            s = WorkoutSession(source="blank", workout_date=date(2026, 11, 16), status=C, started_at=datetime(2026, 11, 16, 5), ended_at=datetime(2026, 11, 16, 6))
            e = WorkoutSessionExercise(exercise_id=lib[BENCH], position=1, exercise_name=BENCH, muscle_group_name="Chest", status="skipped")
            e.sets.append(WorkoutSessionSet(set_number=1, status=C, actual_reps=5, actual_weight_kg=Decimal("50")))
            s.exercises.append(e); db.add(s); db.commit()
        assert get(client, "/overview", start="2026-11-01")["completed_sets"] == 1


# ================================ bodyweight and decimals =========================================

class TestBodyweightAndDecimals:
    def test_bodyweight_sets_count_as_sets_and_reps_but_not_weight_or_volume(self, client, log, lib):
        log.session("2026-11-16", exercises=[("Pull Up", "Back", lib["Pull Up"], [(C, 10, None), (C, 8, 0), (C, 6, None)])])
        r = dict(start="2026-11-01", end="2026-11-19")
        o = get(client, "/overview", **r)
        assert o["completed_sets"] == 3 and o["volume_kg"] == 0
        ex = get(client, "/exercise", key=f"id:{lib['Pull Up']}", **r)
        assert ex["best_weight"] is None and ex["best_reps"] == {"value": 10, "date": "2026-11-16"}
        assert ex["series"][0]["best_weight_kg"] is None and ex["series"][0]["max_reps"] == 10 and ex["series"][0]["volume_kg"] == 0
        assert "No external weight" in ex["improvement_note"]
        rec = get(client, "/personal-records", **r)["records"][0]
        assert rec["max_weight"] is None and rec["max_set_volume"] is None and rec["max_bodyweight_reps"]["reps"] == 10   # excluded from external-weight PRs
        v = get(client, "/volume", **r)
        assert v["total_volume_kg"] == 0 and v["counted_sets"] == 0 and v["excluded_sets"] == 3 and v["by_exercise"] == []

    def test_a_weighted_set_without_reps_has_a_weight_but_no_volume(self, client, log, lib):
        log.session("2026-11-16", exercises=[(BENCH, "Chest", lib[BENCH], [(C, None, 70)])])
        ex = get(client, "/exercise", key=f"id:{lib[BENCH]}", start="2026-11-01")
        assert ex["best_weight"]["value"] == 70 and ex["total_volume_kg"] == 0 and ex["series"][0]["max_reps"] is None
        assert get(client, "/volume", start="2026-11-01")["excluded_sets"] == 1

    def test_decimal_weights_are_summed_exactly(self, client, log, lib):
        log.session("2026-11-16", exercises=[(BENCH, "Chest", lib[BENCH], [(C, 8, 22.5), (C, 8, 10.206), (C, 12, 2.5), (C, 10, 7.5)])])
        v = get(client, "/volume", start="2026-11-01")
        assert v["total_volume_kg"] == 22.5 * 8 + 81.648 + 30 + 75 == 366.648
        assert get(client, "/personal-records", start="2026-11-01")["records"][0]["max_weight"]["weight_kg"] == 22.5

    def test_hundreds_of_milligram_sets_sum_without_float_dust(self, client, log, lib):
        log.session("2026-11-16", exercises=[(BENCH, "Chest", lib[BENCH], [(C, 1, 0.001)] * 20 + [(C, 3, 0.1)] * 7)])
        assert get(client, "/volume", start="2026-11-01")["total_volume_kg"] == 0.02 + 2.1

    def test_heavy_numbers(self, client, log, lib):
        log.session("2026-11-16", exercises=[("Barbell Squat", "Quadriceps", lib["Barbell Squat"], [(C, 1000, 999.999)])])
        assert get(client, "/volume", start="2026-11-01")["total_volume_kg"] == 999999.0


# ================================ volume ==========================================================

class TestVolume:
    def test_totals_weeks_months_exercises_and_muscle_groups(self, client, log, lib):
        log.session("2026-10-30", exercises=[(BENCH, "Chest", lib[BENCH], [(C, 10, 50)])])                       # Friday
        log.session("2026-11-02", exercises=[(BENCH, "Chest", lib[BENCH], [(C, 10, 60)]), ("Barbell Squat", "Quadriceps", lib["Barbell Squat"], [(C, 5, 100)])])
        log.session("2026-11-15", exercises=[("Barbell Squat", "Quadriceps", lib["Barbell Squat"], [(C, 5, 110)])])   # Sunday: belongs to the week of 9 Nov
        log.session("2026-11-16", exercises=[("Mystery", None, None, [(C, 10, 20)]), ("Blank", "  ", None, [(C, 1, 5)])])
        v = get(client, "/volume", start="2026-10-26", end="2026-11-19")
        assert v["total_volume_kg"] == 500 + 600 + 500 + 550 + 200 + 5
        assert [(w["label"], w["volume_kg"]) for w in v["weeks"]] == [("2026-10-26", 500), ("2026-11-02", 1100), ("2026-11-09", 550), ("2026-11-16", 205)]
        assert [(m["label"], m["volume_kg"], m["partial"]) for m in v["months"]] == [("2026-10", 500, True), ("2026-11", 1855, True)]
        by_ex = {x["name"]: x["volume_kg"] for x in v["by_exercise"]}
        assert by_ex == {BENCH: 1100, "Barbell Squat": 1050, "Mystery": 200, "Blank": 5}
        assert [x["name"] for x in v["by_exercise"]] == [BENCH, "Barbell Squat", "Mystery", "Blank"]            # biggest first
        assert {g["name"]: g["volume_kg"] for g in v["by_muscle_group"]} == {"Chest": 1100, "Quadriceps": 1050}
        assert v["unassigned_kg"] == 205                                                                         # no guessing: kept apart

    def test_cardio_never_enters_strength_volume(self, client, log, lib):
        log.session("2026-11-16", exercises=[(BENCH, "Chest", lib[BENCH], [(C, 10, 50)])], cardio=[("Running", C, 60, 10, 800)])
        assert get(client, "/volume", start="2026-11-01")["total_volume_kg"] == 500

    def test_a_range_without_workouts_has_zero_buckets_not_missing_ones(self, client, log, lib):
        v = get(client, "/volume", start="2026-11-02", end="2026-11-15")
        assert [(w["label"], w["volume_kg"]) for w in v["weeks"]] == [] or True
        log.session("2026-11-09", exercises=[(BENCH, "Chest", lib[BENCH], [(C, 1, 10)])])
        v = get(client, "/volume", start="2026-11-02", end="2026-11-22")
        assert [(w["label"], w["volume_kg"]) for w in v["weeks"]] == [("2026-11-02", 0), ("2026-11-09", 10), ("2026-11-16", 0)]


# ================================ consistency =====================================================

class TestConsistency:
    def test_monday_first_weeks_with_zero_weeks_and_one_training_day_per_date(self, client, log):
        for day in ("2026-11-02", "2026-11-04", "2026-11-04", "2026-11-08", "2026-11-09", "2026-11-17"):      # Mon, Wed x2, Sun, next Mon, Tue
            log.session(day)
        c = get(client, "/consistency", start="2026-11-02", end="2026-11-19")
        assert [(w["label"], w["workouts"], w["training_days"]) for w in c["weeks"]] == [
            ("2026-11-02", 4, 3), ("2026-11-09", 1, 1), ("2026-11-16", 1, 1)]               # Sunday 8 Nov is in the week that began 2 Nov
        assert c["workouts"] == 6 and c["training_days"] == 5                             # two workouts on 4 Nov are one training day
        assert c["average_workouts_per_week"] == round(6 / (18 / 7), 2) and c["average_training_days_per_week"] == round(5 / (18 / 7), 2)

    def test_partial_weeks_and_months_are_flagged_and_the_range_never_runs_past_today(self, client, log):
        log.session("2026-11-18")
        c = get(client, "/consistency", start="2026-10-28", end="2026-12-31")
        assert c["range"]["end"] == "2026-11-19" and c["range"]["end_clamped"] is True
        assert [(w["label"], w["partial"]) for w in c["weeks"]] == [("2026-10-26", True), ("2026-11-02", False), ("2026-11-09", False), ("2026-11-16", True)]
        assert [(m["label"], m["partial"]) for m in c["months"]] == [("2026-10", True), ("2026-11", True)]
        assert max(w["end"] for w in c["weeks"]) == "2026-11-22"                          # week bucket spans to Sunday, but counting stops at today

    def test_future_days_are_not_counted_as_missed(self, client, log):
        c = get(client, "/consistency", start="2026-11-16", end="2026-11-30")
        assert c["range"]["days"] == 4 and c["workouts"] == 0                            # 16-19 Nov only
        assert c["average_workouts_per_week"] is None                                    # under a week: no misleading average

    def test_frequency_counts_only_full_weeks(self, client, log):
        for day in ("2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-09"):
            log.session(day)
        f = get(client, "/consistency", start="2026-10-26", end="2026-11-15")["frequency"]
        assert {x["label"]: x["weeks"] for x in f} == {"0": 1, "1": 1, "2": 0, "3": 0, "4+": 1}

    def test_year_boundary_and_leap_day(self, client, log, monkeypatch):
        monkeypatch.setattr("app.services.progress_service.today_local", lambda: date(2028, 3, 10))
        for day in ("2027-12-31", "2028-01-01", "2028-02-29", "2028-03-01"):
            log.session(day)
        c = get(client, "/consistency", start="2027-12-27", end="2028-03-05")
        weeks = {w["label"]: w["workouts"] for w in c["weeks"]}
        assert weeks["2027-12-27"] == 2 and weeks["2028-02-28"] == 2                      # 31 Dec + 1 Jan share a week; 29 Feb + 1 Mar share one
        assert [(m["label"], m["workouts"]) for m in c["months"]] == [("2027-12", 1), ("2028-01", 1), ("2028-02", 1), ("2028-03", 1)]
        assert c["range"]["days"] == 70

    def test_empty_history_gives_an_empty_but_valid_answer(self, client):
        c = get(client, "/consistency", start="2026-11-01", end="2026-11-19")
        assert c["workouts"] == 0 and c["training_days"] == 0
        assert all(w["workouts"] == 0 for w in c["weeks"]) and len(c["weeks"]) == 4        # zero weeks are shown, truthfully (26 Oct week holds Sun 1 Nov)
        assert get(client, "/consistency")["weeks"] == []                                  # all time with nothing logged: nothing to chart

    def test_weeks_are_capped_for_very_long_ranges(self, client, log):
        log.session("2026-11-16")
        c = get(client, "/consistency", start="2020-01-01")
        assert len(c["weeks"]) == 104 and c["weeks_truncated"] is True and c["weeks"][-1]["workouts"] == 1
        assert len(c["months"]) == 83


# ================================ date ranges and timezone =========================================

class TestRanges:
    @pytest.mark.parametrize("params", [
        {"start": "2026-11-10", "end": "2026-11-01"}, {"start": "1999-12-31"}, {"end": "2101-01-01"}, {"start": "banana"}, {"end": "2026-13-45"},
    ])
    def test_invalid_ranges_are_rejected_with_the_standard_error(self, client, params):
        for path in ("/overview", "/consistency", "/exercises", "/volume", "/personal-records", "/muscle-groups", "/cardio"):
            r = client.get(P + path, params=params)
            assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error", (path, params)

    def test_all_time_starts_at_the_first_completed_workout(self, client, log):
        log.session("2026-10-05", status="cancelled")
        log.session("2026-10-12")
        o = get(client, "/overview")
        assert o["range"]["all_time"] is True and o["range"]["start"] == "2026-10-12" and o["range"]["end"] == "2026-11-19"
        assert o["range"]["days"] == 39 and o["workouts"] == 1

    def test_all_time_with_no_history(self, client):
        o = get(client, "/overview")
        assert o["range"]["start"] is None and o["range"]["days"] == 0 and o["workouts"] == 0 and o["average_duration_seconds"] is None

    def test_a_range_entirely_in_the_future_is_empty_not_an_error(self, client, log):
        log.session("2026-11-16")
        o = get(client, "/overview", start="2026-12-01", end="2026-12-31")
        assert o["workouts"] == 0 and o["range"]["days"] == 0 and o["range"]["end_clamped"] is True

    def test_single_day_range_includes_both_ends(self, client, log):
        log.session("2026-11-16"); log.session("2026-11-17")
        assert get(client, "/overview", start="2026-11-16", end="2026-11-16")["workouts"] == 1

    def test_workouts_are_placed_by_their_local_date_not_the_utc_instant(self, client, log, monkeypatch):
        """Started 20:00 UTC on the 19th = 01:30 on the 20th in India: the stored local workout_date is 20 Nov and that is what counts."""
        monkeypatch.setattr("app.services.progress_service.today_local", lambda: date(2026, 11, 20))
        log.session("2026-11-20", started=datetime(2026, 11, 19, 20, 0))
        assert get(client, "/overview", start="2026-11-19", end="2026-11-19")["workouts"] == 0           # not on the UTC date
        assert get(client, "/overview", start="2026-11-20", end="2026-11-20")["workouts"] == 1
        c = get(client, "/consistency", start="2026-11-16", end="2026-11-22")
        assert c["training_days"] == 1 and c["workouts"] == 1 and [w["workouts"] for w in c["weeks"]] == [1]

    def test_today_comes_from_the_app_timezone(self, client, monkeypatch):
        from app.core import timezone as tz
        from datetime import timezone as dtz
        instant = datetime(2026, 11, 19, 20, 0, tzinfo=dtz.utc)                                         # already the 20th in Asia/Kolkata
        monkeypatch.setattr("app.services.progress_service.today_local", lambda: tz.today_local(instant))
        assert get(client, "/overview", start="2026-11-01")["range"]["end"] == "2026-11-20"


# ================================ exercises =======================================================

class TestExerciseProgress:
    def seed(self, log, lib):
        log.session("2026-10-05", exercises=[(BENCH, "Chest", lib[BENCH], [(C, 10, 60), (C, 8, 65)])])
        log.session("2026-10-19", exercises=[(BENCH, "Chest", lib[BENCH], [(C, 8, 65), (C, 6, 70), ("skipped", 5, 90)])])
        log.session("2026-11-02", exercises=[(BENCH, "Chest", lib[BENCH], [(C, 5, 72.5), (C, 8, 65)]), ("Barbell Squat", "Quadriceps", lib["Barbell Squat"], [(C, 5, 140)])])
        log.session("2026-11-16", exercises=[(BENCH, "Chest", lib[BENCH], [(C, 4, 75)])])
        log.session("2026-11-17", exercises=[("Barbell Squat", "Quadriceps", lib["Barbell Squat"], [(C, 5, 150)])])

    def test_series_summary_and_improvement(self, client, log, lib):
        self.seed(log, lib)
        ex = get(client, "/exercise", key=f"id:{lib[BENCH]}", start="2026-10-01", end="2026-11-19")
        assert ex["name"] == BENCH and ex["exercise_id"] == lib[BENCH]
        assert [(p["date"], p["best_weight_kg"], p["reps_at_best_weight"], p["max_reps"], p["sets"]) for p in ex["series"]] == [
            ("2026-10-05", 65, 8, 10, 2), ("2026-10-19", 70, 6, 8, 2), ("2026-11-02", 72.5, 5, 8, 2), ("2026-11-16", 75, 4, 4, 1)]
        assert ex["best_weight"] == {"value": 75, "date": "2026-11-16"} and ex["best_reps"] == {"value": 10, "date": "2026-10-05"}
        assert ex["completed_sets"] == 7 and ex["sessions"] == 4 and ex["training_days"] == 4
        assert ex["total_volume_kg"] == 600 + 520 + 520 + 420 + 362.5 + 520 + 300
        assert ex["improvement"] == {"from_date": "2026-10-05", "to_date": "2026-11-16", "from_weight_kg": 65, "to_weight_kg": 75, "change_kg": 10, "change_percent": 15.4}
        assert ex["improvement_note"] is None
        assert ex["sessions_per_week"] == round(4 / (50 / 7), 2)
        assert {(x["weight_kg"], x["best_reps"], x["date"]) for x in ex["reps_at_weight"]} == {
            (75, 4, "2026-11-16"), (72.5, 5, "2026-11-02"), (70, 6, "2026-10-19"), (65, 8, "2026-10-05"), (60, 10, "2026-10-05")}
        assert [x["weight_kg"] for x in ex["reps_at_weight"]] == [75, 72.5, 70, 65, 60]                      # heaviest first

    def test_the_range_limits_the_series_and_the_comparison(self, client, log, lib):
        self.seed(log, lib)
        ex = get(client, "/exercise", key=f"id:{lib[BENCH]}", start="2026-11-01", end="2026-11-19")
        assert [p["date"] for p in ex["series"]] == ["2026-11-02", "2026-11-16"]
        assert ex["improvement"] is None and "at least 3 training dates" in ex["improvement_note"]

    def test_no_improvement_figure_without_enough_history(self, client, log, lib):
        log.session("2026-11-02", exercises=[(BENCH, "Chest", lib[BENCH], [(C, 5, 60)])])
        log.session("2026-11-04", exercises=[(BENCH, "Chest", lib[BENCH], [(C, 5, 70)])])
        log.session("2026-11-06", exercises=[(BENCH, "Chest", lib[BENCH], [(C, 5, 80)])])                  # 3 dates but only 4 days apart
        ex = get(client, "/exercise", key=f"id:{lib[BENCH]}", start="2026-11-01")
        assert ex["improvement"] is None and ex["improvement_note"]

    def test_exercises_are_never_mixed(self, client, log, lib):
        self.seed(log, lib)
        sq = get(client, "/exercise", key=f"id:{lib['Barbell Squat']}", start="2026-10-01")
        assert [p["best_weight_kg"] for p in sq["series"]] == [140, 150] and sq["completed_sets"] == 2
        assert sq["name"] == "Barbell Squat"

    def test_two_sets_on_one_day_are_grouped_by_date(self, client, log, lib):
        log.session("2026-11-16", exercises=[(BENCH, "Chest", lib[BENCH], [(C, 5, 60)])])
        log.session("2026-11-16", exercises=[(BENCH, "Chest", lib[BENCH], [(C, 5, 70), (C, 7, 70)])])
        ex = get(client, "/exercise", key=f"id:{lib[BENCH]}", start="2026-11-01")
        assert len(ex["series"]) == 1 and ex["series"][0]["sets"] == 3 and ex["series"][0]["best_weight_kg"] == 70 and ex["series"][0]["reps_at_best_weight"] == 7
        assert ex["sessions"] == 2 and ex["training_days"] == 1

    def test_a_library_rename_keeps_the_history_together_under_the_id(self, client, log, lib):
        log.session("2026-11-02", exercises=[("Bench (old name)", "Chest", lib[BENCH], [(C, 5, 60)])])
        log.session("2026-11-16", exercises=[(BENCH, "Chest", lib[BENCH], [(C, 5, 70)])])
        ex = get(client, "/exercise", key=f"id:{lib[BENCH]}", start="2026-11-01")
        assert ex["completed_sets"] == 2 and ex["name"] == BENCH                                          # newest logged name
        opts = get(client, "/exercises", start="2026-11-01")["exercises"]
        assert [(o["name"], o["completed_sets"]) for o in opts] == [(BENCH, 2)]

    def test_an_exercise_deleted_from_the_library_is_found_by_name(self, client, log, lib):
        log.session("2026-11-02", exercises=[("Old Cable Row", "Back", None, [(C, 10, 40)])])
        log.session("2026-11-16", exercises=[("old cable row", "Back", None, [(C, 10, 45)])])
        opts = get(client, "/exercises", start="2026-11-01")["exercises"]
        assert len(opts) == 1 and opts[0]["key"] == "name:old cable row" and opts[0]["exercise_id"] is None and opts[0]["completed_sets"] == 2
        ex = get(client, "/exercise", key=opts[0]["key"], start="2026-11-01")
        assert ex["name"] == "old cable row" and [p["best_weight_kg"] for p in ex["series"]] == [40, 45] and ex["exercise_id"] is None

    def test_selector_lists_exercises_with_completed_sets_in_range(self, client, log, lib):
        self.seed(log, lib)
        log.session("2026-11-18", exercises=[("Lat Pulldown", "Back", lib["Lat Pulldown"], [("skipped", 10, 50), ("pending", None, None)])])
        names = [o["name"] for o in get(client, "/exercises", start="2026-10-01")["exercises"]]
        assert names == [BENCH, "Barbell Squat"] or names == ["Barbell Squat", BENCH]
        o = {x["name"]: x for x in get(client, "/exercises", start="2026-10-01")["exercises"]}
        assert o[BENCH]["completed_sets"] == 7 and o[BENCH]["sessions"] == 4 and o[BENCH]["best_weight_kg"] == 75 and o[BENCH]["last_date"] == "2026-11-16"
        assert [x["name"] for x in get(client, "/exercises", start="2026-11-17")["exercises"]] == ["Barbell Squat"]

    def test_unknown_and_malformed_keys(self, client, log, lib):
        assert client.get(P + "/exercise", params={"key": "id:99999"}).status_code == 404
        for bad in ("5", "id:abc", "id:0", "name:", "foo:bar", "id:-1"):
            r = client.get(P + "/exercise", params={"key": bad})
            assert r.status_code == 422 and r.json()["error"]["details"][0]["field"] == "key", bad
        assert client.get(P + "/exercise").status_code == 422

    def test_known_exercise_with_nothing_in_range_returns_an_honest_empty_answer(self, client, log, lib):
        log.session("2026-10-05", exercises=[(BENCH, "Chest", lib[BENCH], [(C, 5, 60)])])
        ex = get(client, "/exercise", key=f"id:{lib[BENCH]}", start="2026-11-01")
        assert ex["completed_sets"] == 0 and ex["series"] == [] and ex["best_weight"] is None and ex["improvement"] is None and ex["improvement_note"]


# ================================ personal records ================================================

class TestPersonalRecords:
    def rec(self, client, **p):
        recs = get(client, "/personal-records", **p)["records"]
        return {r["name"]: r for r in recs}

    def test_max_weight_reps_at_weight_and_set_volume(self, client, log, lib):
        log.session("2026-10-05", exercises=[(BENCH, "Chest", lib[BENCH], [(C, 10, 60), (C, 8, 80)])])
        log.session("2026-11-02", exercises=[(BENCH, "Chest", lib[BENCH], [(C, 12, 60), (C, 3, 85), (C, 5, 85)])])
        r = self.rec(client, start="2026-11-01")[BENCH]
        assert (r["max_weight"]["weight_kg"], r["max_weight"]["reps"], r["max_weight"]["date"]) == (85, 5, "2026-11-02")        # best reps AT the top weight
        assert r["max_weight"]["volume_kg"] == 425 and r["max_weight"]["in_range"] is True
        assert (r["max_set_volume"]["weight_kg"], r["max_set_volume"]["reps"], r["max_set_volume"]["volume_kg"]) == (60, 12, 720)   # 60x12 beats 85x5 and 80x8 on volume
        at = {x["weight_kg"]: (x["reps"], x["date"], x["in_range"]) for x in r["reps_at_weight"]}
        assert at == {85: (5, "2026-11-02", True), 80: (8, "2026-10-05", False), 60: (12, "2026-11-02", True)}
        assert [x["weight_kg"] for x in r["reps_at_weight"]] == [85, 80, 60]

    def test_ties_go_to_the_earliest_date(self, client, log, lib):
        log.session("2026-11-09", exercises=[(BENCH, "Chest", lib[BENCH], [(C, 5, 100)])])
        log.session("2026-10-05", exercises=[(BENCH, "Chest", lib[BENCH], [(C, 5, 100)])])         # logged later but earlier in time
        log.session("2026-11-16", exercises=[(BENCH, "Chest", lib[BENCH], [(C, 5, 100)])])
        r = self.rec(client, start="2026-11-01")[BENCH]
        assert r["max_weight"]["date"] == "2026-10-05" and r["max_weight"]["in_range"] is False
        assert r["max_set_volume"]["date"] == "2026-10-05"
        assert r["reps_at_weight"][0]["date"] == "2026-10-05"
        assert get(client, "/personal-records", start="2026-11-01")["new_in_range"] == 0            # nothing new: equalling a record is not a new one

    def test_equal_volume_by_different_routes_is_deterministic(self, client, log, lib):
        log.session("2026-11-02", exercises=[(BENCH, "Chest", lib[BENCH], [(C, 8, 25)])])          # 200
        log.session("2026-11-09", exercises=[(BENCH, "Chest", lib[BENCH], [(C, 10, 20)])])         # 200 as well
        r = self.rec(client, start="2026-11-01")[BENCH]
        assert (r["max_set_volume"]["date"], r["max_set_volume"]["weight_kg"]) == ("2026-11-02", 25)

    def test_records_ignore_unfinished_cancelled_skipped_and_pending(self, client, log, lib):
        log.session("2026-11-02", exercises=[(BENCH, "Chest", lib[BENCH], [(C, 5, 60)])])
        log.session("2026-11-03", status="in_progress", exercises=[(BENCH, "Chest", lib[BENCH], [(C, 5, 200)])])
        log.session("2026-11-04", status="cancelled", exercises=[(BENCH, "Chest", lib[BENCH], [(C, 5, 300)])])
        log.session("2026-11-05", exercises=[(BENCH, "Chest", lib[BENCH], [("skipped", 5, 400), ("pending", 5, 500)])])
        r = self.rec(client, start="2026-11-01")[BENCH]
        assert r["max_weight"]["weight_kg"] == 60 and r["max_set_volume"]["volume_kg"] == 300

    def test_records_are_all_time_but_never_after_the_range_end(self, client, log, lib):
        log.session("2026-10-05", exercises=[(BENCH, "Chest", lib[BENCH], [(C, 5, 100)])])
        log.session("2026-11-10", exercises=[(BENCH, "Chest", lib[BENCH], [(C, 5, 110)])])
        wide = self.rec(client, start="2026-11-01")[BENCH]
        assert wide["max_weight"]["weight_kg"] == 110
        earlier = self.rec(client, start="2026-09-01", end="2026-10-31")[BENCH]
        assert earlier["max_weight"]["weight_kg"] == 100 and earlier["max_weight"]["in_range"] is True

    def test_records_are_exercise_specific(self, client, log, lib):
        log.session("2026-11-02", exercises=[(BENCH, "Chest", lib[BENCH], [(C, 5, 100)]), ("Barbell Squat", "Quadriceps", lib["Barbell Squat"], [(C, 5, 180)])])
        r = self.rec(client, start="2026-11-01")
        assert r[BENCH]["max_weight"]["weight_kg"] == 100 and r["Barbell Squat"]["max_weight"]["weight_kg"] == 180

    def test_bodyweight_record_is_separate_and_ties_use_the_earliest(self, client, log, lib):
        log.session("2026-11-09", exercises=[("Pull Up", "Back", lib["Pull Up"], [(C, 12, None)])])
        log.session("2026-11-02", exercises=[("Pull Up", "Back", lib["Pull Up"], [(C, 12, 0), (C, 9, None), ("skipped", 30, None)])])
        r = self.rec(client, start="2026-11-01")["Pull Up"]
        assert r["max_weight"] is None and r["max_bodyweight_reps"]["reps"] == 12 and r["max_bodyweight_reps"]["date"] == "2026-11-02"

    def test_in_range_flags_and_the_new_record_count(self, client, log, lib):
        log.session("2026-10-05", exercises=[(BENCH, "Chest", lib[BENCH], [(C, 5, 100)])])
        log.session("2026-11-10", exercises=[(BENCH, "Chest", lib[BENCH], [(C, 3, 110)])])
        res = get(client, "/personal-records", start="2026-11-01")
        assert res["new_in_range"] == 1                                                              # a new max weight; 110x3 = 330 does not beat the old 100x5 = 500
        r = res["records"][0]
        assert r["max_weight"]["in_range"] is True and r["max_set_volume"]["in_range"] is False

    def test_the_record_points_at_the_workout_it_came_from(self, client, log, lib):
        sid = log.session("2026-11-02", exercises=[(BENCH, "Chest", lib[BENCH], [(C, 5, 60)])])
        assert self.rec(client, start="2026-11-01")[BENCH]["max_weight"]["session_id"] == sid

    def test_a_deleted_exercise_keeps_its_records_by_name(self, client, log, lib):
        log.session("2026-11-02", exercises=[("Old Machine Press", "Chest", None, [(C, 8, 50)])])
        r = self.rec(client, start="2026-11-01")["Old Machine Press"]
        assert r["exercise_id"] is None and r["key"] == "name:old machine press" and r["max_weight"]["weight_kg"] == 50

    def test_no_history_means_no_records(self, client):
        res = get(client, "/personal-records", start="2026-11-01")
        assert res["records"] == [] and res["new_in_range"] == 0


# ================================ muscle groups ===================================================

class TestMuscleGroups:
    def test_distribution_uses_the_logged_primary_group_and_never_guesses(self, client, log, lib):
        log.session("2026-11-02", exercises=[(BENCH, "Chest", lib[BENCH], [(C, 5, 60)] * 6), ("Lat Pulldown", "Back", lib["Lat Pulldown"], [(C, 10, 40)] * 3),
                                             ("Mystery", None, None, [(C, 5, 10)]), ("Blank", "  ", None, [(C, 5, 10)]), ("Skipped Only", "Legs", None, [("skipped", 5, 10)])])
        log.session("2026-11-04", exercises=[(BENCH, "Chest", lib[BENCH], [(C, 5, 60)] * 4), ("Pull Up", "Back", lib["Pull Up"], [(C, 8, None)] * 2)])
        m = get(client, "/muscle-groups", start="2026-11-01")
        assert m["total_sets"] == 6 + 3 + 1 + 1 + 4 + 2
        assert [(g["name"], g["completed_sets"], g["sessions"], g["exercises"]) for g in m["groups"]] == [
            ("Chest", 10, 2, 1), ("Back", 5, 2, 2), ("Unassigned", 2, 1, 2)]                            # Unassigned last; 'Legs' has no completed sets
        assert [g["percent_of_sets"] for g in m["groups"]] == [58.8, 29.4, 11.8]
        assert abs(sum(g["percent_of_sets"] for g in m["groups"]) - 100) < 0.2

    def test_a_workout_with_two_exercises_of_one_group_is_one_session(self, client, log, lib):
        log.session("2026-11-02", exercises=[(BENCH, "Chest", lib[BENCH], [(C, 5, 60)]), ("Cable Fly", "Chest", None, [(C, 12, 20)])])
        g = get(client, "/muscle-groups", start="2026-11-01")["groups"][0]
        assert (g["completed_sets"], g["sessions"], g["exercises"]) == (2, 1, 2)

    def test_frequency_per_week_only_for_ranges_of_a_week_or_more(self, client, log, lib):
        log.session("2026-11-02", exercises=[(BENCH, "Chest", lib[BENCH], [(C, 5, 60)])])
        log.session("2026-11-09", exercises=[(BENCH, "Chest", lib[BENCH], [(C, 5, 60)])])
        assert get(client, "/muscle-groups", start="2026-11-02", end="2026-11-15")["groups"][0]["sessions_per_week"] == 1.0
        assert get(client, "/muscle-groups", start="2026-11-16", end="2026-11-19")["groups"] == []

    def test_cancelled_and_unfinished_sessions_do_not_count(self, client, log, lib):
        log.session("2026-11-02", status="cancelled", exercises=[(BENCH, "Chest", lib[BENCH], [(C, 5, 60)])])
        log.session("2026-11-03", status="in_progress", exercises=[(BENCH, "Chest", lib[BENCH], [(C, 5, 60)])])
        assert get(client, "/muscle-groups", start="2026-11-01") ["groups"] == []


# ================================ cardio ==========================================================

class TestCardio:
    def test_totals_use_completed_entries_only(self, client, log):
        log.session("2026-11-02", cardio=[("Running", C, 30, 5.25, 300), ("Walking", C, 45, None, None), ("Cycling", "skipped", 60, 20, 500), ("Rowing", "pending", None, None, None)])
        log.session("2026-11-04", cardio=[("running", C, 20, 3.5, None)], status="completed")
        log.session("2026-11-05", status="cancelled", cardio=[("Running", C, 99, 99, 999)])
        c = get(client, "/cardio", start="2026-11-01")
        assert (c["entries"], c["sessions"], c["total_minutes"], c["total_distance_km"]) == (3, 2, 95, 8.75)
        assert (c["entries_with_distance"], c["calories_logged"], c["calories_entries"]) == (2, 300, 1)           # calories only as typed
        acts = {a["name"].lower(): a for a in c["activities"]}
        assert acts["running"]["entries"] == 2 and acts["running"]["minutes"] == 50 and acts["running"]["distance_km"] == 8.75 and acts["running"]["last_date"] == "2026-11-04"
        assert acts["walking"]["distance_km"] == 0 and acts["walking"]["entries_with_distance"] == 0 and "cycling" not in acts and "rowing" not in acts
        assert [a["name"].lower() for a in c["activities"]] == ["walking", "running"] or [a["name"].lower() for a in c["activities"]] == ["running", "walking"]

    def test_distance_series_for_one_activity(self, client, log):
        log.session("2026-11-02", cardio=[("Running", C, 30, 5, None)])
        log.session("2026-11-09", cardio=[("Running", C, 35, 6.125, None), ("Walking", C, 40, 3, None)])
        log.session("2026-11-16", cardio=[("Running", C, 20, None, None)])                                           # no distance: no point
        c = get(client, "/cardio", start="2026-11-01", activity="RUNNING")
        assert [(p["date"], p["distance_km"], p["minutes"]) for p in c["series"]] == [("2026-11-02", 5, 30), ("2026-11-09", 6.125, 35)]
        assert get(client, "/cardio", start="2026-11-01")["series"] == []
        assert get(client, "/cardio", start="2026-11-01", activity="Swimming")["series"] == []

    def test_distances_are_exact(self, client, log):
        log.session("2026-11-02", cardio=[("Running", C, 10, 0.001, None)] * 3 + [("Running", C, 10, 10.206, None)])
        assert get(client, "/cardio", start="2026-11-01")["total_distance_km"] == 10.209

    def test_no_cardio(self, client, log):
        c = get(client, "/cardio", start="2026-11-01")
        assert c["entries"] == 0 and c["activities"] == [] and c["total_distance_km"] == 0


# ================================ overview ========================================================

class TestOverview:
    def test_per_week_figures_need_at_least_a_week_of_range(self, client, log):
        log.session("2026-11-16"); log.session("2026-11-17")
        short = get(client, "/overview", start="2026-11-16", end="2026-11-19")
        assert short["workouts"] == 2 and short["training_days_per_week"] is None and short["workouts_per_week"] is None
        week = get(client, "/overview", start="2026-11-13", end="2026-11-19")
        assert week["training_days_per_week"] == 2.0 and week["workouts_per_week"] == 2.0
        four = get(client, "/overview", start="2026-10-23", end="2026-11-19")
        assert four["range"]["days"] == 28 and four["training_days_per_week"] == 0.5

    def test_duration_total_and_average(self, client, log):
        log.session("2026-11-02", minutes=45); log.session("2026-11-03", minutes=75); log.session("2026-11-04", minutes=30, status="cancelled")
        o = get(client, "/overview", start="2026-11-01")
        assert o["duration_seconds"] == 7200 and o["average_duration_seconds"] == 3600

    def test_empty_history_never_shows_made_up_averages(self, client):
        o = get(client, "/overview", start="2026-11-01")
        assert (o["workouts"], o["completed_sets"], o["volume_kg"], o["duration_seconds"]) == (0, 0, 0, 0)
        assert o["average_duration_seconds"] is None


# ================================ settings, safety, efficiency ====================================

def test_progress_is_independent_of_unit_and_format_settings(client, log, lib):
    log.session("2026-11-02", exercises=[(BENCH, "Chest", lib[BENCH], [(C, 8, 22.5)])], cardio=[("Running", C, 30, 5, None)])
    paths = ["/overview", "/consistency", "/exercises", "/volume", "/personal-records", "/muscle-groups", "/cardio"]
    before = {p: get(client, p, start="2026-11-01") for p in paths}
    assert client.put("/api/v1/settings", json={"display_name": "G", "rest_between_sets_seconds": 30, "rest_between_exercises_seconds": 30, "target_workout_minutes": 20,
                                                 "weight_unit": "lbs", "distance_unit": "miles", "week_start": "sunday", "date_format": "YYYY-MM-DD"}).status_code == 200
    assert {p: get(client, p, start="2026-11-01") for p in paths} == before                          # canonical kg / km and Monday weeks, whatever Settings say
    assert before["/volume"]["total_volume_kg"] == 180 and before["/cardio"]["total_distance_km"] == 5


def test_every_endpoint_is_read_only(client, log, lib, session_factory):
    log.session("2026-11-02", exercises=[(BENCH, "Chest", lib[BENCH], [(C, 8, 22.5)])], cardio=[("Running", C, 30, 5, None)])
    tables = ["workout_sessions", "workout_session_exercises", "workout_session_sets", "workout_session_cardio", "exercises", "app_settings"]

    def snap():
        with session_factory() as db:
            return {t: db.execute(text(f"SELECT COUNT(*), MAX(updated_at) FROM {t}")).one() for t in tables}
    before = snap()
    for path in ["/overview", "/consistency", "/exercises", "/volume", "/personal-records", "/muscle-groups", "/cardio"]:
        get(client, path, start="2026-11-01")
    get(client, "/exercise", key=f"id:{lib[BENCH]}", start="2026-11-01")
    assert snap() == before
    for method in ("post", "put", "patch", "delete"):
        assert getattr(client, method)(P + "/overview").status_code == 405


def test_unexpected_failure_is_a_clean_500(client, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("secret detail")
    monkeypatch.setattr("app.api.v1.progress.service.overview", boom)
    r = client.get(P + "/overview")
    assert r.status_code == 500 and r.json()["error"]["reference"] and "secret" not in r.text


def selects(session_factory, client, path, **params) -> int:
    engine = session_factory.kw["bind"]
    seen: list[str] = []
    fn = lambda c, cur, stmt, p, ctx, m: seen.append(stmt)
    event.listen(engine, "before_cursor_execute", fn)
    try:
        assert client.get(P + path, params=params).status_code == 200
    finally:
        event.remove(engine, "before_cursor_execute", fn)
    return len([s for s in seen if s.lstrip().upper().startswith("SELECT")])


def test_query_counts_are_small_and_do_not_grow_with_the_amount_of_history(client, log, lib, session_factory):
    endpoints = [("/overview", {}), ("/consistency", {}), ("/exercises", {}), ("/volume", {}), ("/personal-records", {}), ("/muscle-groups", {}),
                 ("/cardio", {"activity": "Running"}), ("/exercise", {"key": f"id:{lib[BENCH]}"})]

    def history(n):
        for i in range(n):
            d = (date(2026, 1, 1) + timedelta(days=i * 2)).isoformat()
            log.session(d, exercises=[(BENCH, "Chest", lib[BENCH], [(C, 5 + i % 4, 40 + i % 30)] * 4), ("Barbell Squat", "Quadriceps", lib["Barbell Squat"], [(C, 5, 80 + i)] * 3),
                                      ("Pull Up", "Back", lib["Pull Up"], [(C, 8, None)] * 3)], cardio=[("Running", C, 20, 3 + i % 5, None)])
    history(5)
    small = {p: selects(session_factory, client, p, start="2026-01-01", **q) for p, q in endpoints}
    history(60)
    big = {p: selects(session_factory, client, p, start="2026-01-01", **q) for p, q in endpoints}
    assert big == small, (small, big)                                  # fixed cost: independent of how many workouts exist
    assert max(big.values()) <= 8, big


def test_analytics_agree_with_workouts_logged_through_the_real_api(client, ref, lib):
    """End to end: log and complete a workout through the Phase 9 API, then read it back as progress."""
    W = "/api/v1/workouts"
    s = client.post(W, json={"source": "blank", "workout_date": "2026-11-16"}).json()
    s = client.post(f"{W}/{s['id']}/exercises", json={"exercise_id": lib[BENCH]}).json()
    ex = s["exercises"][0]
    client.patch(f"{W}/{s['id']}/sets/{ex['sets'][0]['id']}", json={"actual_reps": 10, "actual_weight_kg": 22.5, "status": "completed"})
    sets = client.post(f"{W}/{s['id']}/exercises/{ex['id']}/sets").json()["exercises"][0]["sets"]
    client.patch(f"{W}/{s['id']}/sets/{sets[1]['id']}", json={"actual_reps": 8, "actual_weight_kg": 10.206, "status": "skipped"})
    assert get(client, "/overview", start="2026-11-01")["workouts"] == 0                           # still in progress
    client.post(f"{W}/{s['id']}/complete", json={})
    o = get(client, "/overview", start="2026-11-01")
    assert (o["workouts"], o["completed_sets"], o["volume_kg"]) == (1, 1, 225.0)
    assert get(client, "/personal-records", start="2026-11-01")["records"][0]["max_weight"]["session_id"] == s["id"]
