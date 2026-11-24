"""Home dashboard API against throwaway databases (never the dev DB)."""
from datetime import date

import pytest
from sqlalchemy import event, text

from app.core.timezone import today_local

DASH = "/api/v1/dashboard"
CY = "/api/v1/cycles"


def set_today(monkeypatch, iso: str) -> None:
    monkeypatch.setattr("app.services.dashboard_service.today_local", lambda: date.fromisoformat(iso))


def make_set(client, name="Chest A"):
    r = client.post("/api/v1/exercise-sets", json={"name": name, "muscle_group": "Chest", "exercise_keys": ["barbell-bench-press"]})
    assert r.status_code == 201, r.text


def dash(client, today: str | None = None, monkeypatch=None) -> dict:
    if today:
        set_today(monkeypatch, today)
    r = client.get(DASH)
    assert r.status_code == 200, r.text
    return r.json()


def mk(client, name="Winter Block", start="2026-11-16", weeks=8, status=None) -> int:
    r = client.post(CY, json={"name": name, "start_date": start, "total_weeks": weeks})
    assert r.status_code == 201, r.text
    cid = r.json()["id"]
    for action in {"active": ["activate"], "completed": ["activate", "complete"], "archived": ["archive"], None: []}[status]:
        assert client.post(f"{CY}/{cid}/{action}").status_code == 200, action
    return cid


def day_url(c, w, d):
    return f"{CY}/{c}/weeks/{w}/days/{d}"


@pytest.fixture
def lib(client, ref) -> dict:
    out = {}
    for name, group, wtype in [("Barbell Bench Press", "Chest", "Barbell"), ("Cable Fly", "Chest", "Cable"),
                               ("Triceps Pushdown", "Triceps", "Cable"), ("Lat Pulldown", "Back", "Cable")]:
        r = client.post("/api/v1/exercises", json={"name": name, "muscle_group_id": ref["muscle"][group],
                                                   "workout_type_id": ref["type"][wtype]})
        out[name] = r.json()["id"]
    return out


def plan_strength(client, ref, lib, cid, w, d, groups: dict[str, list[str]], **ex_kw):
    for group, names in groups.items():
        client.post(day_url(cid, w, d) + "/muscle-groups", json={"muscle_group_id": ref["muscle"][group]})
        for n in names:
            r = client.post(day_url(cid, w, d) + f"/muscle-groups/{ref['muscle'][group]}/exercises",
                            json={"exercise_id": lib[n], **ex_kw})
            assert r.status_code == 201, r.text


def item(body, key):
    return next(i for i in body["setup"]["items"] if i["key"] == key)


# ---- empty database ---------------------------------------------------------------------------

class TestEmpty:
    def test_everything_is_empty_and_honest(self, client):
        b = client.get(DASH).json()
        assert b["date"] == today_local().isoformat() and b["timezone"] == "Asia/Kolkata"
        assert b["cycle_counts"] == {"draft": 0, "active": 0, "completed": 0, "archived": 0}
        assert b["active_cycle"] is None and b["other_cycle"] is None
        assert b["today"]["plan"] is None and b["today"]["cycle"] is None and b["today"]["covered_by_inactive"] is None
        assert b["stats"] == {"exercises_total": 0, "exercises_active": 0, "exercise_sets": 0, "active_cycles": 0,
                              "planned_days_this_week": 0, "rest_days_this_week": 0, "planned_exercises_this_week": 0}
        assert [i["status"] for i in b["setup"]["items"]] == ["pending", "pending", "not_applicable"]
        assert b["setup"]["completed"] == 0 and b["setup"]["applicable"] == 2 and b["setup"]["all_done"] is False
        assert item(b, "week_plan")["reason"]

    def test_response_never_claims_anything_about_completed_workouts(self, client):
        text_ = client.get(DASH).text.lower()
        for word in ("streak", "calorie", "completed_workouts", "personal_record", "consistency"):
            assert word not in text_

    def test_week_is_seven_days_monday_first_with_one_today(self, client, monkeypatch):
        b = dash(client, "2026-11-19", monkeypatch)             # a Thursday
        days = b["week"]["days"]
        assert b["week"]["start"] == "2026-11-16" and b["week"]["end"] == "2026-11-22"
        assert [d["date"] for d in days] == [f"2026-11-{16 + i}" for i in range(7)]
        assert [d["day_of_week"] for d in days] == [0, 1, 2, 3, 4, 5, 6]
        assert [d["date"] for d in days if d["is_today"]] == ["2026-11-19"]
        assert all(d["cycle"] is None and d["plan"] is None for d in days)


# ---- week boundaries --------------------------------------------------------------------------

@pytest.mark.parametrize("today,start,end", [
    ("2026-11-16", "2026-11-16", "2026-11-22"),   # Monday
    ("2026-11-22", "2026-11-16", "2026-11-22"),   # Sunday belongs to the week that began on Monday
    ("2026-11-23", "2026-11-23", "2026-11-29"),
    ("2026-12-31", "2026-12-28", "2027-01-03"),   # week crossing the year boundary
    ("2027-01-01", "2026-12-28", "2027-01-03"),
    ("2028-02-29", "2028-02-28", "2028-03-05"),   # leap day
])
def test_week_boundaries(client, monkeypatch, today, start, end):
    b = dash(client, today, monkeypatch)
    assert (b["date"], b["week"]["start"], b["week"]["end"]) == (today, start, end)
    assert len(b["week"]["days"]) == 7 and sum(d["is_today"] for d in b["week"]["days"]) == 1


def test_year_boundary_week_maps_to_cycle_weeks(client, ref, lib, monkeypatch):
    cid = mk(client, start="2026-12-21", weeks=4, status="active")        # weeks: 21 Dec, 28 Dec, 4 Jan, 11 Jan
    plan_strength(client, ref, lib, cid, 2, 3, {"Chest": ["Barbell Bench Press"]})   # Thu 31 Dec
    plan_strength(client, ref, lib, cid, 2, 4, {"Back": ["Lat Pulldown"]})           # Fri 1 Jan
    b = dash(client, "2026-12-31", monkeypatch)
    assert [d["date"] for d in b["week"]["days"]][::6] == ["2026-12-28", "2027-01-03"]
    assert {d["week_number"] for d in b["week"]["days"]} == {2}
    assert b["today"]["week_number"] == 2 and b["today"]["plan"]["kind"] == "strength"
    assert b["week"]["days"][4]["date"] == "2027-01-01" and b["week"]["days"][4]["plan"]["muscle_groups"][0]["name"] == "Back"
    assert b["active_cycle"]["current_week"] == 2


# ---- active cycle -----------------------------------------------------------------------------

class TestActiveCycle:
    @pytest.mark.parametrize("today,week,done,pct,remaining", [
        ("2026-11-16", 1, 0, 0, 56),         # first day
        ("2026-11-19", 1, 3, 5, 53),
        ("2026-11-30", 3, 14, 25, 42),       # Monday of week 3 of 8 -> two whole weeks done = 25%
        ("2026-12-13", 4, 27, 48, 29),
        ("2027-01-10", 8, 55, 98, 1),        # last day: not yet 100%
    ])
    def test_in_progress(self, client, monkeypatch, today, week, done, pct, remaining):
        mk(client, status="active")
        a = dash(client, today, monkeypatch)["active_cycle"]
        assert a["state"] == "in_progress" and a["current_week"] == week
        assert (a["completed_days"], a["progress_percent"], a["days_remaining"]) == (done, pct, remaining)
        assert a["total_days"] == 56 and a["days_until_start"] is None
        assert a["cycle"]["name"] == "Winter Block" and a["cycle"]["total_weeks"] == 8
        assert a["cycle"]["start_date"] == "2026-11-16" and a["cycle"]["end_date"] == "2027-01-10"

    def test_not_yet_started(self, client, monkeypatch):
        mk(client, status="active")
        a = dash(client, "2026-11-10", monkeypatch)["active_cycle"]
        assert a["state"] == "upcoming" and a["current_week"] is None
        assert (a["progress_percent"], a["completed_days"], a["days_until_start"], a["days_remaining"]) == (0, 0, 6, None)

    def test_already_ended_but_still_marked_active(self, client, monkeypatch):
        mk(client, status="active")
        a = dash(client, "2027-01-11", monkeypatch)["active_cycle"]
        assert a["state"] == "ended" and a["current_week"] is None
        assert (a["progress_percent"], a["completed_days"], a["days_remaining"]) == (100, 56, None)

    def test_draft_completed_and_archived_are_never_shown_as_active(self, client, monkeypatch):
        mk(client, name="Draft one", start="2026-11-16", weeks=2)
        mk(client, name="Done one", start="2026-08-03", weeks=4, status="completed")
        mk(client, name="Old one", start="2026-05-04", weeks=4, status="archived")
        b = dash(client, "2026-11-19", monkeypatch)
        assert b["active_cycle"] is None
        assert b["cycle_counts"] == {"draft": 1, "active": 0, "completed": 1, "archived": 1}
        assert b["stats"]["active_cycles"] == 0

    @pytest.mark.parametrize("setup,expected", [
        ([("Old", "2026-01-05", "archived")], "Old"),
        ([("Old", "2026-01-05", "archived"), ("Done", "2026-06-01", "completed")], "Done"),
        ([("Done", "2026-06-01", "completed"), ("Idea", "2027-03-01", None)], "Idea"),
        ([("Idea 1", "2027-03-01", None), ("Idea 2", "2027-06-07", None)], "Idea 2"),
    ])
    def test_other_cycle_prefers_draft_then_completed_then_archived(self, client, monkeypatch, setup, expected):
        for name, start, status in setup:
            mk(client, name=name, start=start, weeks=2, status=status)
        assert dash(client, "2026-11-19", monkeypatch)["other_cycle"]["name"] == expected

    def test_completing_the_cycle_removes_it(self, client, monkeypatch):
        cid = mk(client, status="active")
        assert dash(client, "2026-11-19", monkeypatch)["active_cycle"]["cycle"]["id"] == cid
        assert client.post(f"{CY}/{cid}/complete").status_code == 200
        b = dash(client)
        assert b["active_cycle"] is None and b["other_cycle"]["status"] == "completed"

    def test_prefers_the_cycle_covering_today_then_next_to_start_then_latest_ended(self, client, monkeypatch):
        mk(client, name="Past", start="2026-08-03", weeks=4, status="active")      # ends 30 Aug
        mk(client, name="Now", start="2026-11-16", weeks=4, status="active")       # 16 Nov - 13 Dec
        mk(client, name="Soon", start="2026-12-14", weeks=4, status="active")
        mk(client, name="Later", start="2027-03-01", weeks=4, status="active")
        assert dash(client, "2026-11-19", monkeypatch)["active_cycle"]["cycle"]["name"] == "Now"
        a = dash(client, "2026-09-15", monkeypatch)["active_cycle"]
        assert a["cycle"]["name"] == "Now" and a["state"] == "upcoming"         # next to start
        a = dash(client, "2027-06-01", monkeypatch)["active_cycle"]
        assert a["cycle"]["name"] == "Later" and a["state"] == "ended"          # latest to end
        assert dash(client)["stats"]["active_cycles"] == 4


# ---- today ------------------------------------------------------------------------------------

class TestToday:
    def test_planned_strength_and_cardio_with_notes(self, client, ref, lib, monkeypatch):
        cid = mk(client, status="active")
        d = day_url(cid, 1, 3)                                                   # Thursday 19 Nov
        client.put(d, json={"status": "planned", "title": "Push day", "notes": "Heavy first."})
        plan_strength(client, ref, lib, cid, 1, 3, {"Chest": ["Barbell Bench Press", "Cable Fly"], "Triceps": ["Triceps Pushdown"]},
                      target_sets=4, target_reps="6-8", target_weight_kg=80, rest_seconds=120)
        client.post(d + "/cardio", json={"cardio_activity_id": 2, "duration_minutes": 20, "distance_km": 3.5})
        t = dash(client, "2026-11-19", monkeypatch)["today"]
        assert t["date"] == "2026-11-19" and t["day_of_week"] == 3
        assert t["cycle"]["name"] == "Winter Block" and t["week_number"] == 1
        p = t["plan"]
        assert p["kind"] == "mixed" and p["title"] == "Push day" and p["notes"] == "Heavy first."
        assert [g["muscle_group"]["name"] for g in p["strength"]] == ["Chest", "Triceps"]
        first = p["strength"][0]["exercises"][0]
        assert (first["exercise"]["name"], first["target_sets"], first["target_reps"], first["target_weight_kg"]) == ("Barbell Bench Press", 4, "6-8", 80)
        assert p["cardio"][0]["duration_minutes"] == 20 and p["cardio"][0]["distance_km"] == 3.5
        assert p["exercise_count"] == 3 and p["cardio_count"] == 1

    def test_rest_day(self, client, monkeypatch):
        cid = mk(client, status="active")
        client.put(day_url(cid, 1, 3), json={"status": "rest"})
        p = dash(client, "2026-11-19", monkeypatch)["today"]["plan"]
        assert p["kind"] == "rest" and p["status"] == "rest" and p["exercise_count"] == 0

    def test_empty_day_inside_the_active_cycle(self, client, monkeypatch):
        mk(client, status="active")
        t = dash(client, "2026-11-19", monkeypatch)["today"]
        assert t["cycle"]["name"] == "Winter Block" and t["plan"]["kind"] == "empty" and t["plan"]["status"] == "unplanned"

    def test_no_active_cycle_covering_today(self, client, monkeypatch):
        mk(client, start="2026-08-03", weeks=4, status="active")
        t = dash(client, "2026-11-19", monkeypatch)["today"]
        assert t["cycle"] is None and t["plan"] is None and t["covered_by_inactive"] is None

    def test_a_draft_covering_today_is_reported_but_its_plan_is_not_shown(self, client, ref, lib, monkeypatch):
        cid = mk(client, name="Idea")
        plan_strength(client, ref, lib, cid, 1, 3, {"Chest": ["Cable Fly"]})
        b = dash(client, "2026-11-19", monkeypatch)
        assert b["today"]["plan"] is None and b["today"]["cycle"] is None
        assert b["today"]["covered_by_inactive"]["name"] == "Idea" and b["today"]["covered_by_inactive"]["status"] == "draft"
        assert all(d["plan"] is None for d in b["week"]["days"])
        assert b["stats"]["planned_days_this_week"] == 0

    def test_an_overlapping_draft_never_displaces_the_active_plan(self, client, ref, lib, monkeypatch):
        active = mk(client, name="Real", status="active")
        draft = mk(client, name="Idea", start="2026-11-16", weeks=2)
        plan_strength(client, ref, lib, active, 1, 3, {"Chest": ["Cable Fly"]})
        plan_strength(client, ref, lib, draft, 1, 3, {"Back": ["Lat Pulldown"]})
        t = dash(client, "2026-11-19", monkeypatch)["today"]
        assert t["cycle"]["name"] == "Real" and t["plan"]["strength"][0]["muscle_group"]["name"] == "Chest"
        assert t["covered_by_inactive"] is None


# ---- this week --------------------------------------------------------------------------------

class TestWeek:
    def test_schedule_reflects_planner_exactly(self, client, ref, lib, monkeypatch):
        cid = mk(client, status="active")
        plan_strength(client, ref, lib, cid, 1, 0, {"Chest": ["Barbell Bench Press", "Cable Fly"], "Triceps": ["Triceps Pushdown"]})
        client.put(day_url(cid, 1, 1), json={"status": "rest"})
        client.post(day_url(cid, 1, 2) + "/cardio", json={"cardio_activity_id": 2, "duration_minutes": 30})
        plan_strength(client, ref, lib, cid, 1, 3, {"Back": ["Lat Pulldown"]})
        client.post(day_url(cid, 1, 3) + "/cardio", json={"cardio_activity_id": 3, "duration_minutes": 10})
        w = dash(client, "2026-11-19", monkeypatch)["week"]["days"]
        assert [d["plan"]["kind"] for d in w] == ["strength", "rest", "cardio", "mixed", "empty", "empty", "empty"]
        assert [g["name"] for g in w[0]["plan"]["muscle_groups"]] == ["Chest", "Triceps"]
        assert (w[0]["plan"]["exercise_count"], w[2]["plan"]["cardio_count"], w[3]["plan"]["cardio_count"]) == (3, 1, 1)
        assert all(d["week_number"] == 1 and d["cycle"]["name"] == "Winter Block" for d in w)

    def test_week_entries_are_summaries_not_full_plans(self, client, ref, lib, monkeypatch):
        cid = mk(client, status="active")
        plan_strength(client, ref, lib, cid, 1, 0, {"Chest": ["Cable Fly"]})
        day = dash(client, "2026-11-19", monkeypatch)["week"]["days"][0]["plan"]
        assert "strength" not in day and "cardio" not in day and day["exercise_count"] == 1

    def test_later_weeks_use_their_own_plan(self, client, ref, lib, monkeypatch):
        cid = mk(client, status="active")
        plan_strength(client, ref, lib, cid, 1, 0, {"Chest": ["Cable Fly"]})
        plan_strength(client, ref, lib, cid, 3, 0, {"Back": ["Lat Pulldown"]})
        b = dash(client, "2026-12-02", monkeypatch)                               # week 3 (Wednesday)
        assert b["week"]["start"] == "2026-11-30" and b["week"]["days"][0]["week_number"] == 3
        assert b["week"]["days"][0]["plan"]["muscle_groups"][0]["name"] == "Back"

    def test_week_partly_outside_the_cycle(self, client, monkeypatch):
        mk(client, start="2026-11-16", weeks=1, status="active")                   # ends Sun 22 Nov
        b = dash(client, "2026-11-23", monkeypatch)                                # next week: nothing covers it
        assert all(d["cycle"] is None and d["plan"] is None for d in b["week"]["days"])
        assert item(b, "week_plan")["status"] == "not_applicable"

    def test_a_week_with_no_plans_is_not_counted_as_anything(self, client, monkeypatch):
        mk(client, status="active")
        s = dash(client, "2026-11-19", monkeypatch)["stats"]
        assert (s["planned_days_this_week"], s["rest_days_this_week"], s["planned_exercises_this_week"]) == (0, 0, 0)


# ---- stats and checklist ------------------------------------------------------------------------

class TestStatsAndSetup:
    def test_counts_are_exact(self, client, ref, lib, monkeypatch):
        inactive = client.post("/api/v1/exercises", json={"name": "Retired", "muscle_group_id": ref["muscle"]["Back"], "is_active": False})
        assert inactive.status_code == 201
        cid = mk(client, status="active")
        mk(client, name="Idea", start="2027-03-01", weeks=2)
        plan_strength(client, ref, lib, cid, 1, 0, {"Chest": ["Barbell Bench Press", "Cable Fly"]})
        plan_strength(client, ref, lib, cid, 1, 2, {"Back": ["Lat Pulldown"]})
        client.put(day_url(cid, 1, 1), json={"status": "rest"})
        client.post(day_url(cid, 1, 4) + "/cardio", json={"cardio_activity_id": 1, "duration_minutes": 20})
        plan_strength(client, ref, lib, cid, 2, 0, {"Chest": ["Cable Fly"]})        # next week: must not count
        s = dash(client, "2026-11-19", monkeypatch)["stats"]
        assert s == {"exercises_total": 5, "exercises_active": 4, "exercise_sets": 0, "active_cycles": 1,
                     "planned_days_this_week": 3, "rest_days_this_week": 1, "planned_exercises_this_week": 3}

    def test_library_exercises_alone_do_not_complete_the_first_step(self, client, ref, monkeypatch):
        set_today(monkeypatch, "2026-11-19")                       # the first step is now "save an exercise set"
        client.post("/api/v1/exercises", json={"name": "Retired", "muscle_group_id": ref["muscle"]["Back"], "is_active": False})
        b = client.get(DASH).json()
        assert item(b, "exercises") == {"key": "exercises", "status": "pending", "count": 0, "reason": None}
        assert b["stats"]["exercises_total"] == 1 and b["stats"]["exercises_active"] == 0

    def test_checklist_progresses_with_real_data(self, client, ref, lib, monkeypatch):
        set_today(monkeypatch, "2026-11-19")
        make_set(client)
        b = client.get(DASH).json()
        assert item(b, "exercises")["status"] == "done" and item(b, "exercises")["count"] == 1      # one saved set
        assert b["stats"]["exercise_sets"] == 1
        assert item(b, "cycle")["status"] == "pending"

        mk(client, name="Old", start="2026-01-05", weeks=2, status="archived")      # archived does not count as "a cycle"
        assert item(client.get(DASH).json(), "cycle")["status"] == "pending"

        cid = mk(client)                                                            # a draft counts as created
        b = client.get(DASH).json()
        assert item(b, "cycle")["status"] == "done"
        assert item(b, "week_plan")["status"] == "not_applicable"                   # draft is not active

        client.post(f"{CY}/{cid}/activate")
        b = client.get(DASH).json()
        assert item(b, "week_plan")["status"] == "pending" and item(b, "week_plan")["reason"] is None

        client.put(day_url(cid, 1, 1), json={"status": "rest"})                     # rest alone is not a workout
        assert item(client.get(DASH).json(), "week_plan")["status"] == "pending"

        plan_strength(client, ref, lib, cid, 1, 0, {"Chest": ["Cable Fly"]})
        b = client.get(DASH).json()
        assert item(b, "week_plan") == {"key": "week_plan", "status": "done", "count": 1, "reason": None}
        assert b["setup"]["completed"] == 3 and b["setup"]["applicable"] == 3 and b["setup"]["all_done"] is True

    def test_all_done_ignores_not_applicable_items(self, client, ref, lib, monkeypatch):
        set_today(monkeypatch, "2026-11-19")
        make_set(client)
        mk(client, name="Idea")
        s = client.get(DASH).json()["setup"]
        assert (s["completed"], s["applicable"], s["all_done"]) == (2, 2, True)


# ---- settings and safety ------------------------------------------------------------------------

def test_dashboard_is_independent_of_display_settings(client, ref, lib, monkeypatch):
    """Units, date format, week-start and name are applied by the page; planning data never changes with them."""
    cid = mk(client, status="active")
    plan_strength(client, ref, lib, cid, 1, 3, {"Chest": ["Cable Fly"]}, target_weight_kg=40)
    set_today(monkeypatch, "2026-11-19")
    before = client.get(DASH).json()
    r = client.put("/api/v1/settings", json={
        "display_name": "Gokul", "rest_between_sets_seconds": 30, "rest_between_exercises_seconds": 30, "target_workout_minutes": 20,
        "weight_unit": "lbs", "distance_unit": "miles", "week_start": "sunday", "date_format": "YYYY-MM-DD"})
    assert r.status_code == 200
    after = client.get(DASH).json()
    assert after == before
    assert after["week"]["start"] == "2026-11-16"                     # still Monday-first
    assert after["today"]["plan"]["strength"][0]["exercises"][0]["target_weight_kg"] == 40   # stored value untouched


def test_dashboard_is_read_only(client, ref, lib, session_factory):
    cid = mk(client, status="active")
    plan_strength(client, ref, lib, cid, 1, 0, {"Chest": ["Cable Fly"]})
    tables = ["workout_cycles", "weekly_plans", "daily_schedules", "schedule_exercises", "exercises",
              "workout_sessions", "workout_session_exercises", "workout_session_sets", "workout_session_cardio", "app_settings"]

    def snapshot():
        with session_factory() as db:
            return {t: db.execute(text(f"SELECT COUNT(*), MAX(updated_at) FROM {t}")).one() for t in tables}
    before = snapshot()
    for _ in range(3):
        assert client.get(DASH).status_code == 200
    assert snapshot() == before
    assert before["workout_sessions"][0] == 0                        # Home never creates workout sessions


def test_only_get_is_allowed_and_errors_use_the_standard_envelope(client):
    r = client.post(DASH, json={})
    assert r.status_code == 405 and r.json()["error"]["code"] == "method_not_allowed"
    assert client.put(DASH, json={}).status_code == 405
    assert client.delete(DASH).status_code == 405


def test_unexpected_failure_is_a_clean_500(client, monkeypatch):
    def boom(db, today=None):
        raise RuntimeError("secret internal detail")
    monkeypatch.setattr("app.api.v1.dashboard.service.get_dashboard", boom)
    r = client.get(DASH)
    assert r.status_code == 500
    err = r.json()["error"]
    assert err["code"] and err["reference"] and "secret" not in r.text


# ---- efficiency ---------------------------------------------------------------------------------

def count_selects(session_factory, client) -> int:
    engine = session_factory.kw["bind"]
    seen: list[str] = []
    listener = lambda conn, cur, stmt, params, ctx, many: seen.append(stmt)
    event.listen(engine, "before_cursor_execute", listener)
    try:
        assert client.get(DASH).status_code == 200
    finally:
        event.remove(engine, "before_cursor_execute", listener)
    return len([s for s in seen if s.lstrip().upper().startswith("SELECT")])


def fill(client, ref, lib, names_starts):
    for name, start, status in names_starts:
        cid = mk(client, name=name, start=start, weeks=4)
        for w in (1, 2):
            for d in range(7):
                plan_strength(client, ref, lib, cid, w, d, {"Chest": ["Barbell Bench Press", "Cable Fly"], "Back": ["Lat Pulldown"]})
                client.post(day_url(cid, w, d) + "/cardio", json={"cardio_activity_id": 1, "duration_minutes": 10})
        for action in {"completed": ["activate", "complete"], "active": ["activate"], None: []}[status]:
            assert client.post(f"{CY}/{cid}/{action}").status_code == 200


def test_query_count_is_small_and_does_not_grow_with_content(client, ref, lib, session_factory, monkeypatch):
    set_today(monkeypatch, "2026-11-19")
    empty = count_selects(session_factory, client)
    fill(client, ref, lib, [("Cycle one", "2026-10-26", "completed"), ("Cycle two", "2026-11-16", "active")])
    busy = count_selects(session_factory, client)
    fill(client, ref, lib, [("Cycle three", "2026-11-23", None), ("Cycle four", "2027-02-01", None), ("Cycle five", "2027-04-05", "active")])
    for i in range(10):
        client.post("/api/v1/exercises", json={"name": f"Extra {i}", "muscle_group_id": ref["muscle"]["Back"]})
    busier = count_selects(session_factory, client)
    assert busy <= 16 and empty <= busy, (empty, busy)
    assert busier == busy, (busy, busier)                    # fixed cost: independent of cycles, days and exercises
