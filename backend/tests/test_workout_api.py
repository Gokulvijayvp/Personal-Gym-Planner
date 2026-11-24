"""Workout logging API against throwaway databases (never the dev DB)."""
import threading
from datetime import date, datetime

import pytest
from sqlalchemy import event, text
from sqlalchemy.exc import DataError, IntegrityError

from dbhelpers import as_text, fk_violations

from app.core.timezone import today_local
from app.models import WorkoutSession

W = "/api/v1/workouts"
CY = "/api/v1/cycles"
TODAY = "2026-11-19"          # a Thursday: week 1, day 3 of the cycle below


@pytest.fixture(autouse=True)
def fixed_today(monkeypatch):
    monkeypatch.setattr("app.services.workout_service.today_local", lambda: date.fromisoformat(TODAY))
    monkeypatch.setattr("app.services.dashboard_service.today_local", lambda: date.fromisoformat(TODAY))


def day_url(c, w, d):
    return f"{CY}/{c}/weeks/{w}/days/{d}"


@pytest.fixture
def plan(client, ref):
    """An active cycle (16 Nov, 8 weeks). Thursday: chest + triceps + running; Monday: one exercise; Tuesday: rest."""
    ex = {}
    for name, group, wtype in [("Barbell Bench Press", "Chest", "Barbell"), ("Cable Fly", "Chest", "Cable"),
                               ("Triceps Pushdown", "Triceps", "Cable"), ("Lat Pulldown", "Back", "Cable"), ("Plank", "Abs / Core", "Bodyweight")]:
        r = client.post("/api/v1/exercises", json={"name": name, "muscle_group_id": ref["muscle"][group], "workout_type_id": ref["type"][wtype]})
        assert r.status_code == 201, r.text
        ex[name] = r.json()["id"]
    cid = client.post(CY, json={"name": "Winter Block", "start_date": "2026-11-16", "total_weeks": 8}).json()["id"]

    def add(d, group, name, **kw):
        client.post(day_url(cid, 1, d) + "/muscle-groups", json={"muscle_group_id": ref["muscle"][group]})
        assert client.post(day_url(cid, 1, d) + f"/muscle-groups/{ref['muscle'][group]}/exercises", json={"exercise_id": ex[name], **kw}).status_code == 201

    client.put(day_url(cid, 1, 3), json={"status": "planned", "title": "Push day", "notes": "Heavy."})
    add(3, "Chest", "Barbell Bench Press", target_sets=4, target_reps="6-8", target_weight_kg=80, rest_seconds=120, notes="Pause on chest")
    add(3, "Chest", "Cable Fly", target_sets=3, target_reps="12")
    add(3, "Triceps", "Triceps Pushdown", target_sets=3, target_reps="10", target_weight_kg=22.5)
    client.post(day_url(cid, 1, 3) + "/cardio", json={"cardio_activity_id": 2, "duration_minutes": 30, "distance_km": 5, "notes": "Easy"})
    add(0, "Back", "Lat Pulldown", target_sets=3, target_reps="10")
    client.put(day_url(cid, 1, 1), json={"status": "rest"})
    add(4, "Abs / Core", "Plank", target_sets=2, target_reps="10")              # Friday = tomorrow
    assert client.post(f"{CY}/{cid}/activate").status_code == 200
    return {"cid": cid, "ex": ex}


def start_plan(client, plan, week=1, dow=3):
    return client.post(W, json={"source": "plan", "cycle_id": plan["cid"], "week_number": week, "day_of_week": dow})


def start_blank(client, **kw):
    return client.post(W, json={"source": "blank", **kw})


@pytest.fixture
def session(client, plan):
    r = start_plan(client, plan)
    assert r.status_code == 201, r.text
    return r.json()


def ex_named(s, name):
    return next(e for e in s["exercises"] if e["exercise_name"] == name)


def planner_snapshot(client, cid):
    """Everything stored by the planner and the library. (`usage_count` is derived: logging legitimately raises it.)"""
    library = client.get("/api/v1/exercises").json()["items"]
    for item in library:
        item.pop("usage_count")
    return [client.get(day_url(cid, 1, d)).json() for d in range(7)] + [library]


# ================================ starting ======================================================

class TestStartFromPlan:
    def test_copies_the_plan_in_planner_order_with_independent_records(self, session):
        s = session
        assert s["status"] == "in_progress" and s["source"] == "plan" and s["workout_date"] == TODAY
        assert (s["title"], s["cycle_name"], s["week_number"]) == ("Push day", "Winter Block", 1)
        assert [e["exercise_name"] for e in s["exercises"]] == ["Barbell Bench Press", "Cable Fly", "Triceps Pushdown"]
        assert [e["position"] for e in s["exercises"]] == [1, 2, 3]
        assert [e["muscle_group_name"] for e in s["exercises"]] == ["Chest", "Chest", "Triceps"]
        bench = ex_named(s, "Barbell Bench Press")
        assert (bench["target_sets"], bench["target_reps"], bench["target_weight_kg"], bench["target_rest_seconds"], bench["plan_notes"]) == (4, "6-8", 80.0, 120, "Pause on chest")
        assert bench["from_plan"] and bench["workout_type_name"] == "Barbell" and bench["status"] == "pending"
        assert [x["set_number"] for x in bench["sets"]] == [1, 2, 3, 4]
        assert all(x["target_reps"] == "6-8" and x["target_weight_kg"] == 80.0 for x in bench["sets"])
        assert all(x["actual_reps"] is None and x["actual_weight_kg"] is None and x["status"] == "pending" for x in bench["sets"])
        assert len(ex_named(s, "Cable Fly")["sets"]) == 3 and ex_named(s, "Cable Fly")["target_weight_kg"] is None
        assert ex_named(s, "Triceps Pushdown")["target_weight_kg"] == 22.5
        run = s["cardio"][0]
        assert (run["activity_name"], run["target_duration_minutes"], run["target_distance_km"], run["plan_notes"]) == ("Running", 30, 5.0, "Easy")
        assert run["duration_minutes"] is None and run["distance_km"] is None and run["status"] == "pending" and run["from_plan"]

    def test_starting_never_changes_the_plan_or_the_library(self, client, plan):
        before = planner_snapshot(client, plan["cid"])
        assert start_plan(client, plan).status_code == 201
        assert planner_snapshot(client, plan["cid"]) == before

    def test_logging_actuals_never_overwrites_planned_values(self, client, plan, session):
        before = planner_snapshot(client, plan["cid"])
        bench = ex_named(session, "Barbell Bench Press")
        for sid, reps, kg in [(bench["sets"][0]["id"], 12, 20), (bench["sets"][1]["id"], 10, 22.5), (bench["sets"][2]["id"], 8, 22.5)]:
            r = client.patch(f"{W}/{session['id']}/sets/{sid}", json={"actual_reps": reps, "actual_weight_kg": kg, "status": "completed"})
            assert r.status_code == 200
        after = client.get(f"{W}/{session['id']}").json()
        b = ex_named(after, "Barbell Bench Press")
        assert [(x["actual_reps"], x["actual_weight_kg"]) for x in b["sets"][:3]] == [(12, 20.0), (10, 22.5), (8, 22.5)]
        assert all(x["target_reps"] == "6-8" and x["target_weight_kg"] == 80.0 for x in b["sets"])        # targets untouched
        assert (b["target_sets"], b["target_reps"], b["target_weight_kg"]) == (4, "6-8", 80.0)
        assert planner_snapshot(client, plan["cid"]) == before

    def test_planned_cardio_and_targets_are_not_performance(self, session):
        s = session["summary"]
        assert (s["completed_exercises"], s["completed_sets"], s["cardio_completed"], s["cardio_minutes"]) == (0, 0, 0, 0)
        assert (s["total_exercises"], s["total_sets"], s["cardio_entries"]) == (3, 10, 1)

    def test_repeated_start_returns_the_same_unfinished_session(self, client, plan, session):
        again = start_plan(client, plan)
        assert again.status_code == 200 and again.json()["id"] == session["id"]
        assert again.headers["location"].endswith(f"/workouts/{session['id']}")
        assert client.get(W).json()["total"] == 1

    def test_a_different_start_on_the_same_day_is_refused_with_the_existing_id(self, client, plan, session):
        r = start_blank(client)
        assert r.status_code == 409
        err = r.json()["error"]
        assert err["code"] == "session_in_progress"
        assert {"field": "session_id", "message": str(session["id"]), "type": "existing_session"} in err["details"]
        assert client.get(W).json()["total"] == 1

    def test_parallel_starts_create_one_session(self, client, plan):
        results = []
        barrier = threading.Barrier(5)

        def go():
            barrier.wait()
            results.append(start_plan(client, plan))

        threads = [threading.Thread(target=go) for _ in range(5)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        assert all(r.status_code in (200, 201) for r in results), [r.text for r in results]
        assert sum(r.status_code == 201 for r in results) == 1
        assert len({r.json()["id"] for r in results}) == 1
        assert client.get(W).json()["total"] == 1

    def test_earlier_planned_day_can_be_logged_retroactively(self, client, plan):
        r = start_plan(client, plan, dow=0)
        assert r.status_code == 201 and r.json()["workout_date"] == "2026-11-16"

    def test_future_day_rejected(self, client, plan):
        r = start_plan(client, plan, dow=4)
        assert r.status_code == 422 and r.json()["error"]["details"][0]["field"] == "workout_date"

    def test_rest_and_empty_days_have_nothing_to_start(self, client, plan):
        for dow in (1, 2):
            r = start_plan(client, plan, dow=dow)
            assert r.status_code == 422 and r.json()["error"]["code"] == "nothing_to_start"
        assert client.get(W).json()["total"] == 0

    def test_unknown_cycle_week_and_draft_cycle(self, client, plan):
        assert client.post(W, json={"source": "plan", "cycle_id": 999, "week_number": 1, "day_of_week": 3}).status_code == 404
        assert start_plan(client, plan, week=9).status_code == 422
        draft = client.post(CY, json={"name": "Idea", "start_date": "2026-11-16", "total_weeks": 2}).json()["id"]
        r = client.post(W, json={"source": "plan", "cycle_id": draft, "week_number": 1, "day_of_week": 3})
        assert r.status_code == 409 and r.json()["error"]["code"] == "cycle_not_usable"

    @pytest.mark.parametrize("body", [
        {"source": "plan"}, {"source": "plan", "cycle_id": 1, "week_number": 1},
        {"source": "plan", "cycle_id": 1, "week_number": 1, "day_of_week": 3, "workout_date": TODAY},
        {"source": "blank", "cycle_id": 1}, {"source": "other"}, {"source": "plan", "cycle_id": 1, "week_number": 1, "day_of_week": 9},
        {"source": "blank", "extra": 1}, {"source": "blank", "workout_date": "not-a-date"},
    ])
    def test_invalid_start_bodies(self, client, plan, body):
        assert client.post(W, json=body).status_code == 422


class TestStartBlank:
    def test_blank_session_is_empty_and_dated_today(self, client):
        r = start_blank(client)
        assert r.status_code == 201
        s = r.json()
        assert (s["source"], s["workout_date"], s["daily_schedule_id"], s["exercises"], s["cardio"]) == ("blank", TODAY, None, [], [])
        assert s["summary"]["total_exercises"] == 0

    def test_blank_start_is_idempotent_and_future_dates_rejected(self, client):
        a = start_blank(client)
        b = start_blank(client)
        assert b.status_code == 200 and b.json()["id"] == a.json()["id"]
        assert start_blank(client, workout_date="2026-11-20").status_code == 422

    def test_backdated_blank_workout(self, client):
        r = start_blank(client, workout_date="2026-11-10")
        assert r.status_code == 201 and r.json()["workout_date"] == "2026-11-10"

    def test_default_date_is_the_india_date(self, client, monkeypatch):
        monkeypatch.undo()                                   # use the real clock for this one
        r = start_blank(client)
        assert r.json()["workout_date"] == today_local().isoformat()


# ================================ exercises =====================================================

class TestExercises:
    def test_add_from_library_snapshots_names_and_adds_one_set(self, client, plan):
        s = start_blank(client).json()
        r = client.post(f"{W}/{s['id']}/exercises", json={"exercise_id": plan["ex"]["Lat Pulldown"]})
        assert r.status_code == 201
        e = r.json()["exercises"][0]
        assert (e["exercise_name"], e["muscle_group_name"], e["workout_type_name"], e["position"], e["status"]) == ("Lat Pulldown", "Back", "Cable", 1, "pending")
        assert e["from_plan"] is False and e["target_sets"] is None and e["target_weight_kg"] is None
        assert [(x["set_number"], x["status"], x["target_reps"]) for x in e["sets"]] == [(1, "pending", None)]

    def test_add_to_a_planned_workout_marks_it_as_unplanned(self, client, plan, session):
        r = client.post(f"{W}/{session['id']}/exercises", json={"exercise_id": plan["ex"]["Plank"]})
        e = r.json()["exercises"][-1]
        assert e["exercise_name"] == "Plank" and e["from_plan"] is False and e["position"] == 4

    def test_unknown_and_inactive_exercises_rejected(self, client, plan):
        s = start_blank(client).json()
        assert client.post(f"{W}/{s['id']}/exercises", json={"exercise_id": 999}).status_code == 404
        client.patch(f"/api/v1/exercises/{plan['ex']['Plank']}/status", json={"is_active": False})
        r = client.post(f"{W}/{s['id']}/exercises", json={"exercise_id": plan["ex"]["Plank"]})
        assert r.status_code == 422

    def test_status_and_notes_patch_only_what_is_sent(self, client, session):
        eid = session["exercises"][0]["id"]
        r = client.patch(f"{W}/{session['id']}/exercises/{eid}", json={"status": "skipped"})
        e = r.json()["exercises"][0]
        assert e["status"] == "skipped" and e["notes"] is None
        r = client.patch(f"{W}/{session['id']}/exercises/{eid}", json={"notes": "  Shoulder hurt  "})
        e = r.json()["exercises"][0]
        assert e["status"] == "skipped" and e["notes"] == "Shoulder hurt"
        assert client.patch(f"{W}/{session['id']}/exercises/{eid}", json={"notes": ""}).json()["exercises"][0]["notes"] is None
        assert client.patch(f"{W}/{session['id']}/exercises/{eid}", json={"status": "bogus"}).status_code == 422
        assert client.patch(f"{W}/{session['id']}/exercises/{eid}", json={"status": None}).status_code == 422
        assert client.patch(f"{W}/{session['id']}/exercises/{eid}", json={"target_reps": "99"}).status_code == 422

    def test_remove_renumbers_positions_and_drops_its_sets(self, client, session, session_factory):
        ids = [e["id"] for e in session["exercises"]]
        r = client.delete(f"{W}/{session['id']}/exercises/{ids[0]}")
        assert [(e["exercise_name"], e["position"]) for e in r.json()["exercises"]] == [("Cable Fly", 1), ("Triceps Pushdown", 2)]
        with session_factory() as db:
            assert db.execute(text("SELECT COUNT(*) FROM workout_session_sets")).scalar() == 6
        assert client.delete(f"{W}/{session['id']}/exercises/{ids[0]}").status_code == 404

    def test_reorder(self, client, session):
        ids = [e["id"] for e in session["exercises"]]
        r = client.put(f"{W}/{session['id']}/exercises/order", json={"exercise_ids": [ids[2], ids[0], ids[1]]})
        assert [e["exercise_name"] for e in r.json()["exercises"]] == ["Triceps Pushdown", "Barbell Bench Press", "Cable Fly"]
        assert [e["position"] for e in r.json()["exercises"]] == [1, 2, 3]
        assert [e["exercise_name"] for e in client.get(f"{W}/{session['id']}").json()["exercises"]][0] == "Triceps Pushdown"

    @pytest.mark.parametrize("make", [lambda ids: ids[:2], lambda ids: ids + [ids[0]], lambda ids: [ids[0], ids[0], ids[1]], lambda ids: ids + [9999]])
    def test_reorder_must_be_an_exact_permutation(self, client, session, make):
        ids = [e["id"] for e in session["exercises"]]
        assert client.put(f"{W}/{session['id']}/exercises/order", json={"exercise_ids": make(ids)}).status_code == 422
        assert [e["id"] for e in client.get(f"{W}/{session['id']}").json()["exercises"]] == ids


# ================================ sets ==========================================================

class TestSets:
    def sid(self, session, name="Barbell Bench Press", i=0):
        return ex_named(session, name)["sets"][i]["id"]

    def test_add_set_continues_numbering_and_copies_targets(self, client, session):
        eid = ex_named(session, "Cable Fly")["id"]
        r = client.post(f"{W}/{session['id']}/exercises/{eid}/sets")
        sets = ex_named(r.json(), "Cable Fly")["sets"]
        assert [x["set_number"] for x in sets] == [1, 2, 3, 4]
        assert sets[-1]["target_reps"] == "12" and sets[-1]["status"] == "pending" and sets[-1]["actual_reps"] is None

    def test_exercises_can_have_different_set_counts(self, client, session):
        bench = ex_named(session, "Barbell Bench Press")
        client.post(f"{W}/{session['id']}/exercises/{bench['id']}/sets")
        client.delete(f"{W}/{session['id']}/sets/{ex_named(session, 'Cable Fly')['sets'][0]['id']}")
        s = client.get(f"{W}/{session['id']}").json()
        assert [len(e["sets"]) for e in s["exercises"]] == [5, 2, 3]

    def test_double_tap_adds_two_distinct_sets_never_a_duplicate_number(self, client, session):
        eid = ex_named(session, "Cable Fly")["id"]
        client.post(f"{W}/{session['id']}/exercises/{eid}/sets")
        client.post(f"{W}/{session['id']}/exercises/{eid}/sets")
        nums = [x["set_number"] for x in ex_named(client.get(f"{W}/{session['id']}").json(), "Cable Fly")["sets"]]
        assert nums == [1, 2, 3, 4, 5]

    def test_parallel_adds_never_duplicate_a_set_number(self, client, session):
        eid = ex_named(session, "Cable Fly")["id"]
        codes, barrier = [], threading.Barrier(6)

        def go():
            barrier.wait()
            codes.append(client.post(f"{W}/{session['id']}/exercises/{eid}/sets").status_code)

        threads = [threading.Thread(target=go) for _ in range(6)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        assert all(c in (201, 409) for c in codes), codes
        nums = [x["set_number"] for x in ex_named(client.get(f"{W}/{session['id']}").json(), "Cable Fly")["sets"]]
        assert nums == list(range(1, len(nums) + 1)) and len(nums) == 3 + codes.count(201)

    def test_set_limit(self, client, session):
        eid = ex_named(session, "Cable Fly")["id"]
        for _ in range(27):
            assert client.post(f"{W}/{session['id']}/exercises/{eid}/sets").status_code == 201
        r = client.post(f"{W}/{session['id']}/exercises/{eid}/sets")
        assert r.status_code == 409 and r.json()["error"]["code"] == "limit_reached"

    def test_decimal_weights_round_trip_exactly(self, client, session, session_factory):
        sid = self.sid(session)
        for value in (2.5, 7.5, 22.5, 10.206, 0.001, 100.125, 1000):
            r = client.patch(f"{W}/{session['id']}/sets/{sid}", json={"actual_weight_kg": value})
            assert r.status_code == 200
            assert ex_named(r.json(), "Barbell Bench Press")["sets"][0]["actual_weight_kg"] == value
        with session_factory() as db:
            assert db.execute(text("SELECT actual_weight_kg FROM workout_session_sets WHERE id=:i"), {"i": sid}).scalar() == 1000

    def test_bodyweight_set_has_no_weight(self, client, plan):
        s = start_blank(client).json()
        s = client.post(f"{W}/{s['id']}/exercises", json={"exercise_id": plan["ex"]["Plank"]}).json()
        sid = s["exercises"][0]["sets"][0]["id"]
        r = client.patch(f"{W}/{s['id']}/sets/{sid}", json={"actual_reps": 45, "status": "completed"})
        got = r.json()["exercises"][0]["sets"][0]
        assert got["actual_weight_kg"] is None and got["actual_reps"] == 45 and got["status"] == "completed"

    def test_only_sent_fields_change_and_null_clears(self, client, session):
        sid = self.sid(session)
        base = f"{W}/{session['id']}/sets/{sid}"
        client.patch(base, json={"actual_reps": 10, "actual_weight_kg": 22.5, "rest_seconds": 90, "notes": "felt ok"})
        r = client.patch(base, json={"actual_reps": 9})
        got = ex_named(r.json(), "Barbell Bench Press")["sets"][0]
        assert (got["actual_reps"], got["actual_weight_kg"], got["rest_seconds"], got["notes"]) == (9, 22.5, 90, "felt ok")
        r = client.patch(base, json={"actual_weight_kg": None, "notes": None})
        got = ex_named(r.json(), "Barbell Bench Press")["sets"][0]
        assert (got["actual_reps"], got["actual_weight_kg"], got["notes"]) == (9, None, None)

    def test_skip_and_complete_a_set(self, client, session):
        a, b = self.sid(session, i=0), self.sid(session, i=1)
        client.patch(f"{W}/{session['id']}/sets/{a}", json={"status": "completed", "actual_reps": 6})
        r = client.patch(f"{W}/{session['id']}/sets/{b}", json={"status": "skipped"})
        sets = ex_named(r.json(), "Barbell Bench Press")["sets"]
        assert [x["status"] for x in sets] == ["completed", "skipped", "pending", "pending"]
        assert r.json()["summary"]["completed_sets"] == 1

    @pytest.mark.parametrize("body", [
        {"actual_reps": -1}, {"actual_reps": 1001}, {"actual_reps": 9.5}, {"actual_reps": "10"}, {"actual_reps": True},
        {"actual_weight_kg": -0.5}, {"actual_weight_kg": 1000.001}, {"actual_weight_kg": 22.5555}, {"actual_weight_kg": "abc"},
        {"rest_seconds": -1}, {"rest_seconds": 7201}, {"rest_seconds": 1.5},
        {"status": "done"}, {"status": None}, {"notes": "x" * 2001},
        {"target_reps": "5"}, {"target_weight_kg": 10}, {"set_number": 9}, {"id": 5},
    ])
    def test_invalid_values_rejected_and_nothing_saved(self, client, session, body):
        sid = self.sid(session)
        r = client.patch(f"{W}/{session['id']}/sets/{sid}", json=body)
        assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"
        assert ex_named(client.get(f"{W}/{session['id']}").json(), "Barbell Bench Press")["sets"][0]["actual_reps"] is None

    def test_remove_set_renumbers_the_rest(self, client, session):
        bench = ex_named(session, "Barbell Bench Press")
        client.patch(f"{W}/{session['id']}/sets/{bench['sets'][3]['id']}", json={"actual_reps": 4})
        r = client.delete(f"{W}/{session['id']}/sets/{bench['sets'][1]['id']}")
        sets = ex_named(r.json(), "Barbell Bench Press")["sets"]
        assert [x["set_number"] for x in sets] == [1, 2, 3]
        assert sets[2]["actual_reps"] == 4                         # the old set 4 kept its data
        r = client.post(f"{W}/{session['id']}/exercises/{bench['id']}/sets")
        assert [x["set_number"] for x in ex_named(r.json(), "Barbell Bench Press")["sets"]] == [1, 2, 3, 4]

    def test_a_set_of_another_session_is_not_reachable(self, client, session, plan):
        other = start_blank(client, workout_date="2026-11-10").json()
        r = client.patch(f"{W}/{other['id']}/sets/{self.sid(session)}", json={"actual_reps": 1})
        assert r.status_code == 404


# ================================ cardio ========================================================

class TestCardio:
    def test_log_planned_cardio(self, client, session):
        cid = session["cardio"][0]["id"]
        r = client.patch(f"{W}/{session['id']}/cardio/{cid}", json={
            "status": "completed", "duration_minutes": 28, "distance_km": 4.75, "calories": 310, "speed_kmh": 10.2,
            "resistance": "Incline 2", "notes": "Felt good"})
        c = r.json()["cardio"][0]
        assert (c["status"], c["duration_minutes"], c["distance_km"], c["calories"], c["speed_kmh"], c["resistance"], c["notes"]) == (
            "completed", 28, 4.75, 310, 10.2, "Incline 2", "Felt good")
        assert (c["target_duration_minutes"], c["target_distance_km"]) == (30, 5.0)                    # plan untouched
        assert r.json()["summary"]["cardio_minutes"] == 28

    def test_calories_are_never_invented(self, client, session):
        cid = session["cardio"][0]["id"]
        r = client.patch(f"{W}/{session['id']}/cardio/{cid}", json={"status": "completed", "duration_minutes": 30})
        assert r.json()["cardio"][0]["calories"] is None

    def test_additional_cardio_and_cardio_only_session(self, client):
        s = start_blank(client).json()
        r = client.post(f"{W}/{s['id']}/cardio", json={"cardio_activity_id": 1})
        c = r.json()["cardio"][0]
        assert (c["activity_name"], c["from_plan"], c["status"], c["position"]) == ("Walking", False, "pending", 1)
        client.patch(f"{W}/{s['id']}/cardio/{c['id']}", json={"status": "completed", "duration_minutes": 20})
        done = client.post(f"{W}/{s['id']}/complete", json={}).json()
        assert done["status"] == "completed" and done["exercises"] == [] and done["summary"]["cardio_minutes"] == 20

    def test_mixed_session(self, client, session):
        r = client.post(f"{W}/{session['id']}/cardio", json={"cardio_activity_id": 3})
        assert [c["activity_name"] for c in r.json()["cardio"]] == ["Running", "Treadmill"]
        assert len(r.json()["exercises"]) == 3

    def test_skip_and_remove(self, client, session):
        cid = session["cardio"][0]["id"]
        assert client.patch(f"{W}/{session['id']}/cardio/{cid}", json={"status": "skipped"}).json()["cardio"][0]["status"] == "skipped"
        assert client.delete(f"{W}/{session['id']}/cardio/{cid}").json()["cardio"] == []
        assert client.post(f"{W}/{session['id']}/cardio", json={"cardio_activity_id": 999}).status_code == 404

    @pytest.mark.parametrize("body", [{"duration_minutes": -1}, {"duration_minutes": 1441}, {"duration_minutes": 20.5}, {"distance_km": -1},
                                      {"distance_km": 1001}, {"distance_km": 1.2345}, {"calories": -5}, {"calories": 20001}, {"calories": 99.5},
                                      {"speed_kmh": 201}, {"speed_kmh": 10.123}, {"resistance": "x" * 41}, {"status": "nope"}, {"target_duration_minutes": 5}])
    def test_invalid_cardio_values(self, client, session, body):
        cid = session["cardio"][0]["id"]
        assert client.patch(f"{W}/{session['id']}/cardio/{cid}", json=body).status_code == 422


# ================================ lifecycle =====================================================

MUTATIONS = [
    ("POST", "/exercises", {"exercise_id": 1}), ("PUT", "/exercises/order", {"exercise_ids": [1]}),
    ("PATCH", "/exercises/{ex}", {"status": "completed"}), ("DELETE", "/exercises/{ex}", None),
    ("POST", "/exercises/{ex}/sets", None), ("PATCH", "/sets/{set}", {"actual_reps": 5}), ("DELETE", "/sets/{set}", None),
    ("POST", "/cardio", {"cardio_activity_id": 1}), ("PATCH", "/cardio/{cardio}", {"duration_minutes": 5}), ("DELETE", "/cardio/{cardio}", None),
    ("POST", "/complete", {}), ("POST", "/cancel", {}),
]


class TestLifecycle:
    def test_complete_with_notes(self, client, session):
        r = client.post(f"{W}/{session['id']}/complete", json={"notes": "  Great session  "})
        assert r.status_code == 200
        s = r.json()
        assert s["status"] == "completed" and s["notes"] == "Great session" and s["ended_at"].endswith("Z") and s["cancel_reason"] is None

    def test_cancel_with_reason_and_without(self, client, session, plan):
        r = client.post(f"{W}/{session['id']}/cancel", json={"reason": "Felt unwell"})
        assert r.json()["status"] == "cancelled" and r.json()["cancel_reason"] == "Felt unwell" and r.json()["ended_at"]
        s2 = start_blank(client, workout_date="2026-11-10").json()
        assert client.post(f"{W}/{s2['id']}/cancel", json={}).json()["cancel_reason"] is None

    @pytest.mark.parametrize("finish", ["complete", "cancel"])
    def test_finished_sessions_reject_every_change(self, client, session, finish):
        ids = dict(ex=session["exercises"][0]["id"], set=session["exercises"][0]["sets"][0]["id"], cardio=session["cardio"][0]["id"])
        assert client.post(f"{W}/{session['id']}/{finish}", json={}).status_code == 200
        frozen = client.get(f"{W}/{session['id']}").json()
        for method, path, body in MUTATIONS:
            r = client.request(method, f"{W}/{session['id']}" + path.format(**ids), json=body)
            assert r.status_code == 409 and r.json()["error"]["code"] == "session_locked", (method, path, r.text)
        assert client.get(f"{W}/{session['id']}").json() == frozen

    def test_finished_session_is_still_readable(self, client, session):
        client.post(f"{W}/{session['id']}/complete", json={})
        assert client.get(f"{W}/{session['id']}").status_code == 200
        assert client.get(f"{W}/999").status_code == 404

    def test_resume_after_a_reload(self, client, session):
        sid = session["exercises"][0]["sets"][0]["id"]
        client.patch(f"{W}/{session['id']}/sets/{sid}", json={"actual_reps": 7, "actual_weight_kg": 21, "status": "completed"})
        cur = client.get(f"{W}/current").json()
        assert cur["id"] == session["id"] and cur["status"] == "in_progress" and cur["workout_date"] == TODAY
        again = client.get(f"{W}/{cur['id']}").json()
        assert again["exercises"][0]["sets"][0]["actual_reps"] == 7 and again["exercises"][0]["sets"][0]["actual_weight_kg"] == 21.0
        client.post(f"{W}/{session['id']}/complete", json={})
        assert client.get(f"{W}/current").json() is None

    def test_current_picks_the_unfinished_session_of_any_date(self, client):
        old = start_blank(client, workout_date="2026-11-10").json()
        assert client.get(f"{W}/current").json()["id"] == old["id"]

    def test_a_new_session_can_follow_a_finished_one_on_the_same_day(self, client, plan, session):
        client.post(f"{W}/{session['id']}/complete", json={})
        r = start_plan(client, plan)
        assert r.status_code == 201 and r.json()["id"] != session["id"]
        assert client.get(W, params={"status": "completed"}).json()["total"] == 1

    def test_summary_counts_only_what_was_logged(self, client, session):
        s = session
        bench, fly = ex_named(s, "Barbell Bench Press"), ex_named(s, "Cable Fly")
        for x in bench["sets"][:3]:
            client.patch(f"{W}/{s['id']}/sets/{x['id']}", json={"status": "completed", "actual_reps": 8})
        client.patch(f"{W}/{s['id']}/sets/{bench['sets'][3]['id']}", json={"status": "skipped"})
        client.patch(f"{W}/{s['id']}/exercises/{bench['id']}", json={"status": "completed"})
        client.patch(f"{W}/{s['id']}/exercises/{fly['id']}", json={"status": "skipped"})
        client.patch(f"{W}/{s['id']}/cardio/{s['cardio'][0]['id']}", json={"status": "completed", "duration_minutes": 25})
        got = client.get(f"{W}/{s['id']}").json()["summary"]
        assert got == {"total_exercises": 3, "completed_exercises": 1, "skipped_exercises": 1, "total_sets": 10, "completed_sets": 3,
                       "cardio_entries": 1, "cardio_completed": 1, "cardio_minutes": 25}


# ================================ time ==========================================================

class TestTime:
    def test_timestamps_are_naive_utc_in_the_database_and_z_in_the_api(self, client, monkeypatch, session_factory):
        monkeypatch.setattr("app.services.workout_service.utc_now_naive", lambda: datetime(2026, 11, 19, 4, 30))
        s = start_blank(client).json()
        assert s["started_at"] == "2026-11-19T04:30:00Z"
        with session_factory() as db:
            stored = db.execute(text("SELECT started_at FROM workout_sessions WHERE id=:i"), {"i": s["id"]}).scalar()
            assert as_text(stored).startswith("2026-11-19 04:30")       # text on SQLite, a datetime on PostgreSQL: both mean 04:30 UTC

    def test_duration_comes_from_stored_timestamps_not_a_browser_timer(self, client, monkeypatch):
        clock = {"now": datetime(2026, 11, 19, 4, 30)}
        monkeypatch.setattr("app.services.workout_service.utc_now_naive", lambda: clock["now"])
        s = start_blank(client).json()
        clock["now"] = datetime(2026, 11, 19, 5, 0)
        assert client.get(f"{W}/{s['id']}").json()["duration_seconds"] == 1800          # still running: now - start
        clock["now"] = datetime(2026, 11, 19, 6, 0)
        done = client.post(f"{W}/{s['id']}/complete", json={}).json()
        assert done["duration_seconds"] == 5400 and done["ended_at"] == "2026-11-19T06:00:00Z"
        clock["now"] = datetime(2026, 11, 20, 6, 0)
        assert client.get(f"{W}/{s['id']}").json()["duration_seconds"] == 5400          # finished sessions stop counting

    def test_workout_date_is_the_india_date_across_the_utc_midnight(self, client, monkeypatch):
        """20:00 UTC on the 19th is already the 20th in India: dates follow the app timezone, not UTC."""
        monkeypatch.undo()
        from app.core import timezone as tz
        instant = datetime(2026, 11, 19, 20, 0, tzinfo=tz.UTC)
        assert tz.today_local(instant).isoformat() == "2026-11-20"
        monkeypatch.setattr("app.services.workout_service.today_local", lambda: tz.today_local(instant))
        assert start_blank(client).json()["workout_date"] == "2026-11-20"


# ================================ history =======================================================

@pytest.fixture
def history(client, plan):
    """Four finished sessions on different days plus one unfinished."""
    def make(day, exercises, finish, cardio_minutes=None):
        s = start_blank(client, workout_date=day).json()
        for name in exercises:
            s = client.post(f"{W}/{s['id']}/exercises", json={"exercise_id": plan["ex"][name]}).json()
        for e in s["exercises"]:
            client.patch(f"{W}/{s['id']}/sets/{e['sets'][0]['id']}", json={"status": "completed", "actual_reps": 10})
            client.patch(f"{W}/{s['id']}/exercises/{e['id']}", json={"status": "completed"})
        if cardio_minutes:
            c = client.post(f"{W}/{s['id']}/cardio", json={"cardio_activity_id": 1}).json()["cardio"][0]
            client.patch(f"{W}/{s['id']}/cardio/{c['id']}", json={"status": "completed", "duration_minutes": cardio_minutes})
        if finish:
            client.post(f"{W}/{s['id']}/{finish}", json={})
        return s["id"]
    ids = {
        "a": make("2026-11-02", ["Barbell Bench Press", "Cable Fly"], "complete"),
        "b": make("2026-11-05", ["Lat Pulldown"], "complete", cardio_minutes=15),
        "c": make("2026-11-09", ["Barbell Bench Press"], "cancel"),
        "d": make("2026-11-12", ["Plank"], "complete"),
        "live": make("2026-11-18", ["Triceps Pushdown"], None),
    }
    return ids


class TestHistory:
    def ids(self, client, **params):
        r = client.get(W, params=params)
        assert r.status_code == 200, r.text
        return [i["id"] for i in r.json()["items"]]

    def test_newest_first_and_status_filters(self, client, history):
        h = history
        assert self.ids(client) == [h["live"], h["d"], h["c"], h["b"], h["a"]]
        assert self.ids(client, status="completed") == [h["d"], h["b"], h["a"]]
        assert self.ids(client, status="cancelled") == [h["c"]]
        assert self.ids(client, status="in_progress") == [h["live"]]
        assert self.ids(client, status="finished") == [h["d"], h["c"], h["b"], h["a"]]
        assert client.get(W, params={"status": "weird"}).status_code == 422

    def test_date_range_is_inclusive(self, client, history):
        h = history
        assert self.ids(client, start="2026-11-05", end="2026-11-12", status="finished") == [h["d"], h["c"], h["b"]]
        assert self.ids(client, start="2026-11-06") == [h["live"], h["d"], h["c"]]
        assert self.ids(client, end="2026-11-02") == [h["a"]]
        assert self.ids(client, start="2026-12-01") == []
        assert client.get(W, params={"start": "2026-11-10", "end": "2026-11-01"}).status_code == 422

    def test_exercise_filter_is_case_insensitive_contains_and_safe(self, client, history):
        h = history
        assert self.ids(client, exercise="bench") == [h["c"], h["a"]]
        assert self.ids(client, exercise="LAT PULL") == [h["b"]]
        assert self.ids(client, exercise="bench", status="completed") == [h["a"]]
        assert self.ids(client, exercise="nothing like this") == []
        assert self.ids(client, exercise="%") == [] and self.ids(client, exercise="_") == []          # wildcards are literal
        assert self.ids(client, exercise="bench", start="2026-11-05", status="finished") == [h["c"]]

    def test_items_show_date_duration_and_counts_from_actual_records(self, client, history):
        items = {i["id"]: i for i in client.get(W).json()["items"]}
        a, b = items[history["a"]], items[history["b"]]
        assert (a["workout_date"], a["status"], a["exercise_count"], a["completed_exercise_count"], a["completed_sets"], a["cardio_minutes"]) == ("2026-11-02", "completed", 2, 2, 2, 0)
        assert (b["completed_exercise_count"], b["cardio_minutes"]) == (1, 15)
        assert a["exercise_names"] == ["Barbell Bench Press", "Cable Fly"] and isinstance(a["duration_seconds"], int) and a["ended_at"].endswith("Z")

    def test_pagination(self, client, history):
        r = client.get(W, params={"page": 2, "page_size": 2}).json()
        assert (r["total"], r["page"], r["page_size"], len(r["items"])) == (5, 2, 2, 2)
        assert client.get(W, params={"page_size": 101}).status_code == 422

    def test_list_query_count_does_not_grow_with_sessions(self, client, history, session_factory):
        engine = session_factory.kw["bind"]

        def selects():
            seen = []
            fn = lambda c, cur, stmt, p, ctx, m: seen.append(stmt)
            event.listen(engine, "before_cursor_execute", fn)
            try:
                client.get(W, params={"page_size": 100})
            finally:
                event.remove(engine, "before_cursor_execute", fn)
            return len([s for s in seen if s.lstrip().upper().startswith("SELECT")])
        before = selects()
        for day in ("2026-10-01", "2026-10-02", "2026-10-03"):
            start_blank(client, workout_date=day)
            client.post(f"{W}/current")  # no-op route probe
        assert selects() == before <= 6


# ================================ history survives library changes ================================

class TestHistorySurvivesLibraryChanges:
    def test_deactivated_exercise_stays_in_history(self, client, plan, history):
        client.patch(f"/api/v1/exercises/{plan['ex']['Barbell Bench Press']}/status", json={"is_active": False})
        s = client.get(f"{W}/{history['a']}").json()
        assert [e["exercise_name"] for e in s["exercises"]] == ["Barbell Bench Press", "Cable Fly"]
        assert s["exercises"][0]["exercise_id"] == plan["ex"]["Barbell Bench Press"]

    def test_deleted_exercise_keeps_its_name_and_data(self, client, plan, ref, session_factory):
        eid = client.post("/api/v1/exercises", json={"name": "Hanging Leg Raise", "muscle_group_id": ref["muscle"]["Abs / Core"]}).json()["id"]
        s = start_blank(client, workout_date="2026-11-12").json()
        s = client.post(f"{W}/{s['id']}/exercises", json={"exercise_id": eid}).json()
        client.patch(f"{W}/{s['id']}/sets/{s['exercises'][0]['sets'][0]['id']}", json={"status": "completed", "actual_reps": 10})
        client.patch(f"{W}/{s['id']}/exercises/{s['exercises'][0]['id']}", json={"status": "completed"})
        client.post(f"{W}/{s['id']}/complete", json={})
        with session_factory() as db:                          # bypass the API's "in use" guard: prove the schema is safe
            db.execute(text("DELETE FROM exercises WHERE id = :i"), {"i": eid})
            db.commit()
            assert fk_violations(db) == []
        got = client.get(f"{W}/{s['id']}").json()
        e = got["exercises"][0]
        assert (e["exercise_name"], e["exercise_id"], e["muscle_group_name"], e["status"]) == ("Hanging Leg Raise", None, "Abs / Core", "completed")
        assert e["sets"][0]["actual_reps"] == 10
        assert [i["id"] for i in client.get(W, params={"exercise": "leg raise"}).json()["items"]] == [s["id"]]

    def test_deleting_a_cardio_activity_keeps_the_entry(self, client, history, session_factory):
        with session_factory() as db:
            db.execute(text("DELETE FROM cardio_activities WHERE id = 1"))
            db.commit()
        c = client.get(f"{W}/{history['b']}").json()["cardio"][0]
        assert (c["activity_name"], c["cardio_activity_id"], c["duration_minutes"]) == ("Walking", None, 15)

    def test_renaming_a_library_exercise_does_not_rewrite_history(self, client, plan, history):
        eid = plan["ex"]["Lat Pulldown"]
        lib = client.get(f"/api/v1/exercises/{eid}").json()
        body = {k: lib[k] for k in ("name", "description", "instructions", "media_url", "is_active")}
        body.update(name="Wide Grip Pulldown", muscle_group_id=lib["muscle_group"]["id"], secondary_muscle_group_ids=[],
                    target_area_id=lib["target_area"]["id"] if lib["target_area"] else None,
                    workout_type_id=lib["workout_type"]["id"] if lib["workout_type"] else None)
        assert client.put(f"/api/v1/exercises/{eid}", json=body).status_code == 200
        assert client.get(f"{W}/{history['b']}").json()["exercises"][0]["exercise_name"] == "Lat Pulldown"

    def test_deleting_the_planned_day_keeps_the_session(self, client, plan, session, session_factory):
        with session_factory() as db:
            db.execute(text("DELETE FROM daily_schedules")); db.commit()
        s = client.get(f"{W}/{session['id']}").json()
        assert s["daily_schedule_id"] is None and s["cycle_name"] == "Winter Block" and s["title"] == "Push day"
        assert [e["exercise_name"] for e in s["exercises"]][0] == "Barbell Bench Press" and s["exercises"][0]["target_weight_kg"] == 80.0


# ================================ settings: units are presentation only ==========================

def test_changing_unit_preferences_never_changes_stored_records(client, session):
    sid = session["exercises"][0]["sets"][0]["id"]
    client.patch(f"{W}/{session['id']}/sets/{sid}", json={"actual_weight_kg": 22.5})
    before = client.get(f"{W}/{session['id']}").json()
    r = client.put("/api/v1/settings", json={"display_name": None, "rest_between_sets_seconds": 90, "rest_between_exercises_seconds": 120,
                                              "target_workout_minutes": 60, "weight_unit": "lbs", "distance_unit": "miles",
                                              "week_start": "monday", "date_format": "DD MMM YYYY"})
    assert r.status_code == 200
    assert client.get(f"{W}/{session['id']}").json() == before                       # still kilograms / kilometres


# ================================ database guarantees ============================================

class TestDatabase:
    def test_only_one_unfinished_session_per_date(self, session_factory):
        with session_factory() as db:
            def new(status="in_progress", day=date(2026, 11, 19)):
                ended = None if status == "in_progress" else datetime(2026, 11, 19, 6, 0)
                return WorkoutSession(source="blank", workout_date=day, status=status, started_at=datetime(2026, 11, 19, 5, 0), ended_at=ended)
            db.add(new()); db.commit()
            db.add(new("completed")); db.add(new(day=date(2026, 11, 18))); db.commit()          # finished / other day: fine
            db.add(new())
            with pytest.raises(IntegrityError):
                db.commit()

    def test_status_and_end_time_must_agree(self, session_factory):
        with session_factory() as db:
            db.add(WorkoutSession(source="blank", workout_date=date(2026, 11, 19), status="completed", started_at=datetime(2026, 11, 19, 5, 0)))
            with pytest.raises(IntegrityError):
                db.commit()
            db.rollback()
            db.add(WorkoutSession(source="blank", workout_date=date(2026, 11, 19), status="in_progress",
                                  started_at=datetime(2026, 11, 19, 5, 0), ended_at=datetime(2026, 11, 19, 6, 0)))
            with pytest.raises(IntegrityError):
                db.commit()

    def test_duplicate_set_numbers_and_bad_values_are_refused_by_the_database(self, client, session, session_factory):
        sid = session["exercises"][0]["sets"][0]["id"]
        eid = session["exercises"][0]["id"]
        with session_factory() as db:
            # a second set number 1 for the same exercise (valid timestamps, so the ONLY thing wrong is the duplicate)
            with pytest.raises(IntegrityError):
                db.execute(text("INSERT INTO workout_session_sets (session_exercise_id,set_number,status,created_at,updated_at) "
                                "VALUES (:e,1,'pending','2026-11-19 05:00:00','2026-11-19 05:00:00')"), {"e": eid})
            db.rollback()
            # numbers that break a CHECK rule: refused as an IntegrityError on both engines
            for bad in ("UPDATE workout_session_sets SET actual_reps=-1", "UPDATE workout_session_sets SET actual_weight_kg=5000",
                        "UPDATE workout_session_sets SET rest_seconds=-3"):
                with pytest.raises(IntegrityError):
                    db.execute(text(bad))
                db.rollback()
            # a status that is not allowed: a CHECK failure on SQLite, an invalid enum value (DataError) on PostgreSQL
            with pytest.raises((IntegrityError, DataError)):
                db.execute(text("UPDATE workout_session_sets SET status='bogus'"))
            db.rollback()
            assert fk_violations(db) == []

    def test_a_failure_while_starting_leaves_nothing_behind(self, client, plan, monkeypatch, session_factory):
        from app.services import workout_service
        from app.models import WorkoutSessionExercise
        real = workout_service._copy_plan

        def boom(session, day):
            session.exercises.append(WorkoutSessionExercise(position=1, exercise_name="Half copied"))
            raise RuntimeError("disk on fire")
        monkeypatch.setattr(workout_service, "_copy_plan", boom)
        assert start_plan(client, plan).status_code == 500
        monkeypatch.setattr(workout_service, "_copy_plan", real)
        with session_factory() as db:
            assert db.execute(text("SELECT COUNT(*) FROM workout_sessions")).scalar() == 0
            assert db.execute(text("SELECT COUNT(*) FROM workout_session_exercises")).scalar() == 0
        assert start_plan(client, plan).status_code == 201            # and a clean retry works

    def test_a_failed_update_does_not_partly_apply(self, client, session):
        sid = session["exercises"][0]["sets"][0]["id"]
        client.patch(f"{W}/{session['id']}/sets/{sid}", json={"actual_reps": 5})
        r = client.patch(f"{W}/{session['id']}/sets/{sid}", json={"actual_reps": 8, "actual_weight_kg": -1})
        assert r.status_code == 422
        assert ex_named(client.get(f"{W}/{session['id']}").json(), "Barbell Bench Press")["sets"][0]["actual_reps"] == 5

    def test_deleting_a_session_removes_its_children(self, session_factory, client, session):
        with session_factory() as db:
            db.execute(text("DELETE FROM workout_sessions")); db.commit()
            for t in ("workout_session_exercises", "workout_session_sets", "workout_session_cardio"):
                assert db.execute(text(f"SELECT COUNT(*) FROM {t}")).scalar() == 0


# ================================ Home and Calendar integration ===================================

class TestIntegration:
    def test_dashboard_reflects_start_resume_and_completion(self, client, plan):
        d = client.get("/api/v1/dashboard").json()
        assert d["today_workout"] is None and d["in_progress_session"] is None and d["recent_activity"] == []
        s = start_plan(client, plan).json()
        d = client.get("/api/v1/dashboard").json()
        assert d["today_workout"]["id"] == s["id"] and d["today_workout"]["status"] == "in_progress"
        assert d["in_progress_session"]["id"] == s["id"] and d["recent_activity"] == []          # unfinished work is not "activity"
        sid = s["exercises"][0]["sets"][0]["id"]
        client.patch(f"{W}/{s['id']}/sets/{sid}", json={"status": "completed", "actual_reps": 8})
        client.patch(f"{W}/{s['id']}/exercises/{s['exercises'][0]['id']}", json={"status": "completed"})
        client.post(f"{W}/{s['id']}/complete", json={})
        d = client.get("/api/v1/dashboard").json()
        assert d["today_workout"]["status"] == "completed" and d["in_progress_session"] is None
        r = d["recent_activity"][0]
        assert (r["id"], r["title"], r["cycle_name"], r["completed_exercise_count"], r["completed_sets"], r["cardio_minutes"]) == (s["id"], "Push day", "Winter Block", 1, 1, 0)
        assert r["ended_at"].endswith("Z") and isinstance(r["duration_seconds"], int)

    def test_cancelled_workouts_are_not_recent_activity(self, client, plan):
        s = start_plan(client, plan).json()
        client.post(f"{W}/{s['id']}/cancel", json={})
        d = client.get("/api/v1/dashboard").json()
        assert d["recent_activity"] == [] and d["today_workout"] is None

    def test_recent_activity_is_the_latest_five_completed(self, client, plan):
        for day in range(1, 8):
            s = start_blank(client, workout_date=f"2026-11-{day:02d}").json()
            client.post(f"{W}/{s['id']}/complete", json={})
        r = client.get("/api/v1/dashboard").json()["recent_activity"]
        assert len(r) == 5 and [x["workout_date"] for x in r] == [f"2026-11-{d:02d}" for d in (7, 6, 5, 4, 3)]

    def test_an_unfinished_session_from_an_earlier_day_can_be_resumed_from_home(self, client, plan):
        old = start_blank(client, workout_date="2026-11-10").json()
        d = client.get("/api/v1/dashboard").json()
        assert d["in_progress_session"]["id"] == old["id"] and d["today_workout"] is None

    def test_calendar_marks_days_that_have_a_logged_workout(self, client, plan, session):
        days = {x["date"]: x for x in client.get("/api/v1/calendar", params={"start": "2026-11-16", "end": "2026-11-22"}).json()["days"]}
        assert days[TODAY]["workout"] == {"id": session["id"], "status": "in_progress", "workout_date": TODAY, "title": "Push day"}
        assert days["2026-11-18"]["workout"] is None
        client.post(f"{W}/{session['id']}/complete", json={})
        again = {x["date"]: x for x in client.get("/api/v1/calendar", params={"start": "2026-11-16", "end": "2026-11-22"}).json()["days"]}
        assert again[TODAY]["workout"]["status"] == "completed"
        assert again[TODAY]["plan"]["kind"] == "mixed"                          # the plan itself is unchanged

    def test_calendar_prefers_the_unfinished_workout_and_ignores_cancelled(self, client, plan):
        a = start_plan(client, plan).json()
        client.post(f"{W}/{a['id']}/cancel", json={})
        cal = lambda: {x["date"]: x for x in client.get("/api/v1/calendar", params={"start": TODAY, "end": TODAY}).json()["days"]}[TODAY]
        assert cal()["workout"] is None
        b = start_plan(client, plan).json()
        client.post(f"{W}/{b['id']}/complete", json={})
        c = start_blank(client).json()
        assert cal()["workout"]["id"] == c["id"] and cal()["workout"]["status"] == "in_progress"
        client.post(f"{W}/{c['id']}/cancel", json={})
        assert cal()["workout"]["id"] == b["id"]


def test_openapi_lists_the_endpoints(client):
    paths = client.get("/openapi.json").json()["paths"]
    for p in ("/api/v1/workouts", "/api/v1/workouts/current", "/api/v1/workouts/{session_id}", "/api/v1/workouts/{session_id}/complete",
              "/api/v1/workouts/{session_id}/cancel", "/api/v1/workouts/{session_id}/exercises", "/api/v1/workouts/{session_id}/exercises/order",
              "/api/v1/workouts/{session_id}/sets/{set_id}", "/api/v1/workouts/{session_id}/cardio/{cardio_id}"):
        assert p in paths
