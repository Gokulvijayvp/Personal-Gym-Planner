from datetime import date

import pytest
from sqlalchemy import event

CAL = "/api/v1/calendar"
CY = "/api/v1/cycles"


def get(client, start, end):
    return client.get(CAL, params={"start": start, "end": end})


def days(client, start, end) -> list[dict]:
    r = get(client, start, end)
    assert r.status_code == 200, r.text
    return r.json()["days"]


def mk(client, name="Winter Block", start="2026-11-16", weeks=8, status=None) -> int:
    r = client.post(CY, json={"name": name, "start_date": start, "total_weeks": weeks})
    assert r.status_code == 201, r.text
    cid = r.json()["id"]
    for action in {"active": ["activate"], "completed": ["activate", "complete"], "archived": ["archive"], None: []}[status]:
        assert client.post(f"{CY}/{cid}/{action}").status_code == 200
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


# ---- ranges and boundaries ------------------------------------------------------------------

def test_returns_every_date_in_order_with_weekday_and_today(client):
    r = get(client, "2026-11-16", "2026-11-22")
    body = r.json()
    assert [d["date"] for d in body["days"]] == [f"2026-11-{16 + i}" for i in range(7)]
    assert [d["day_of_week"] for d in body["days"]] == [0, 1, 2, 3, 4, 5, 6]          # Monday first
    assert body["start"] == "2026-11-16" and body["end"] == "2026-11-22" and body["timezone"] == "Asia/Kolkata"
    assert date.fromisoformat(body["today"])


def test_single_day_range(client):
    assert len(days(client, "2026-11-18", "2026-11-18")) == 1


def test_month_boundary(client):
    ds = days(client, "2026-10-26", "2026-12-06")           # a six-week month grid (Nov 2026 starts on a Sunday)
    assert len(ds) == 42 and ds[0]["day_of_week"] == 0 and ds[-1]["day_of_week"] == 6
    dates = [d["date"] for d in ds]
    assert dates[5] == "2026-10-31" and dates[6] == "2026-11-01" and dates[35] == "2026-11-30" and dates[36] == "2026-12-01"
    assert [d["day_of_week"] for d in ds] == [i % 7 for i in range(42)]


def test_year_boundary(client):
    dates = [d["date"] for d in days(client, "2026-12-28", "2027-01-03")]
    assert dates == ["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03"]


def test_leap_year(client):
    assert [d["date"] for d in days(client, "2028-02-27", "2028-03-01")] == ["2028-02-27", "2028-02-28", "2028-02-29", "2028-03-01"]
    assert [d["date"] for d in days(client, "2027-02-27", "2027-03-01")] == ["2027-02-27", "2027-02-28", "2027-03-01"]


def test_week_boundaries_are_monday_to_sunday(client):
    cid = mk(client, start="2026-11-16", weeks=2)
    ds = days(client, "2026-11-16", "2026-11-29")
    assert [(d["week_number"], d["day_of_week"]) for d in ds] == [(1, i) for i in range(7)] + [(2, i) for i in range(7)]
    assert ds[6]["date"] == "2026-11-22" and ds[7]["date"] == "2026-11-23"
    assert all(d["cycle"]["id"] == cid for d in ds)


# ---- cycle start / end / outside --------------------------------------------------------------

def test_dates_before_start_and_after_end_belong_to_no_cycle(client):
    cid = mk(client, start="2026-11-16", weeks=2)                       # 16 Nov – 29 Nov
    ds = {d["date"]: d for d in days(client, "2026-11-14", "2026-12-01")}
    for outside in ("2026-11-14", "2026-11-15", "2026-11-30", "2026-12-01"):
        d = ds[outside]
        assert d["cycle"] is None and d["week_number"] is None and d["plan"] is None and d["also_covered_by"] == [], outside
    first, last = ds["2026-11-16"], ds["2026-11-29"]
    assert (first["cycle"]["id"], first["week_number"], first["day_of_week"]) == (cid, 1, 0)
    assert (last["cycle"]["id"], last["week_number"], last["day_of_week"]) == (cid, 2, 6)
    assert first["plan"]["date"] == "2026-11-16" and first["plan"]["week_number"] == 1


def test_no_cycles_at_all(client):
    ds = days(client, "2026-11-01", "2026-11-30")
    assert len(ds) == 30 and all(d["cycle"] is None and d["plan"] is None for d in ds)


def test_cycle_info_in_every_day(client):
    mk(client, name="Spring Block", start="2027-03-01", weeks=12, status="active")
    d = days(client, "2027-03-03", "2027-03-03")[0]
    assert d["cycle"] == {"id": 1, "name": "Spring Block", "status": "active", "start_date": "2027-03-01",
                          "end_date": "2027-05-23", "total_weeks": 12}
    assert d["week_number"] == 1 and d["day_of_week"] == 2


def test_week_number_is_correct_deep_into_a_long_cycle_across_the_year_end(client):
    mk(client, start="2026-11-16", weeks=8)                              # ends Sun 10 Jan 2027
    d = {x["date"]: x for x in days(client, "2026-12-28", "2027-01-11")}
    assert (d["2026-12-28"]["week_number"], d["2026-12-28"]["day_of_week"]) == (7, 0)
    assert (d["2027-01-01"]["week_number"], d["2027-01-01"]["day_of_week"]) == (7, 4)
    assert (d["2027-01-10"]["week_number"], d["2027-01-10"]["day_of_week"]) == (8, 6)
    assert d["2027-01-11"]["cycle"] is None


# ---- several cycles ----------------------------------------------------------------------------

def test_active_cycle_wins_and_others_are_listed(client):
    done = mk(client, name="Old Block", start="2026-11-16", weeks=4, status="completed")
    draft = mk(client, name="Draft Block", start="2026-11-23", weeks=4)
    arch = mk(client, name="Archived Block", start="2026-11-16", weeks=2, status="archived")
    active = mk(client, name="Live Block", start="2026-11-30", weeks=4, status="active")  # overlaps others from 30 Nov
    by = {d["date"]: d for d in days(client, "2026-11-16", "2026-12-07")}
    assert by["2026-11-17"]["cycle"]["id"] == done                      # completed beats archived
    assert [c["id"] for c in by["2026-11-17"]["also_covered_by"]] == [arch]
    assert by["2026-11-24"]["cycle"]["id"] == done                      # completed beats draft
    assert [c["id"] for c in by["2026-11-24"]["also_covered_by"]] == [draft, arch]   # draft ranks above archived
    assert by["2026-12-01"]["cycle"]["id"] == active and by["2026-12-01"]["cycle"]["status"] == "active"
    assert {c["id"] for c in by["2026-12-01"]["also_covered_by"]} == {done, draft}
    assert by["2026-12-01"]["week_number"] == 1                          # week is relative to the cycle that is shown


def test_a_draft_alone_is_shown_with_its_status_and_archived_last(client):
    mk(client, name="Draft Only", start="2026-11-16", weeks=1)
    mk(client, name="Archived Only", start="2026-11-23", weeks=1, status="archived")
    by = {d["date"]: d for d in days(client, "2026-11-16", "2026-11-30")}
    assert by["2026-11-18"]["cycle"]["status"] == "draft"
    assert by["2026-11-25"]["cycle"]["status"] == "archived"


def test_back_to_back_cycles_switch_on_the_exact_date(client):
    a = mk(client, name="First", start="2026-11-16", weeks=1, status="completed")     # ends Sun 22 Nov
    b = mk(client, name="Second", start="2026-11-23", weeks=1, status="active")
    by = {d["date"]: d for d in days(client, "2026-11-22", "2026-11-23")}
    assert by["2026-11-22"]["cycle"]["id"] == a and by["2026-11-22"]["also_covered_by"] == []
    assert by["2026-11-23"]["cycle"]["id"] == b and by["2026-11-23"]["week_number"] == 1


# ---- what each day contains --------------------------------------------------------------------

def test_unplanned_rest_strength_cardio_and_mixed_days(client, ref, lib):
    cid = mk(client)
    plan_strength(client, ref, lib, cid, 1, 0, {"Chest": ["Barbell Bench Press", "Cable Fly"], "Triceps": ["Triceps Pushdown"]})
    plan_strength(client, ref, lib, cid, 1, 2, {"Back": ["Lat Pulldown"]})
    client.post(day_url(cid, 1, 2) + "/cardio", json={"cardio_activity_id": 3, "duration_minutes": 15})
    client.post(day_url(cid, 1, 4) + "/cardio", json={"cardio_activity_id": 2, "duration_minutes": 40, "distance_km": 5})
    client.put(day_url(cid, 1, 6), json={"status": "rest"})
    by = {d["date"]: d["plan"] for d in days(client, "2026-11-16", "2026-11-22")}

    assert by["2026-11-16"]["kind"] == "strength" and by["2026-11-16"]["exercise_count"] == 3
    assert [g["name"] for g in by["2026-11-16"]["muscle_groups"]] == ["Chest", "Triceps"]
    assert by["2026-11-17"]["kind"] == "empty" and by["2026-11-17"]["status"] == "unplanned"   # cycle covers it, nothing planned
    assert by["2026-11-18"]["kind"] == "mixed" and by["2026-11-18"]["cardio_count"] == 1 and by["2026-11-18"]["exercise_count"] == 1
    assert by["2026-11-20"]["kind"] == "cardio" and by["2026-11-20"]["strength"] == []
    assert by["2026-11-22"]["kind"] == "rest" and by["2026-11-22"]["status"] == "rest"
    assert by["2026-11-21"]["kind"] == "empty"


def test_full_exercise_cardio_and_note_details(client, ref, lib):
    cid = mk(client)
    client.put(day_url(cid, 1, 0), json={"status": "planned", "title": "Push day", "notes": "Heavy compounds first."})
    plan_strength(client, ref, lib, cid, 1, 0, {"Chest": ["Barbell Bench Press"]},
                  target_sets=4, target_reps="6-8", target_weight_kg=82.5, rest_seconds=120, notes="Pause on chest")
    client.post(day_url(cid, 1, 0) + "/cardio", json={"cardio_activity_id": 2, "duration_minutes": 20, "distance_km": 3.2, "notes": "Cool down"})
    p = days(client, "2026-11-16", "2026-11-16")[0]["plan"]
    assert p["title"] == "Push day" and p["display_title"] == "Push day" and p["notes"] == "Heavy compounds first."
    item = p["strength"][0]["exercises"][0]
    assert (item["target_sets"], item["target_reps"], item["target_weight_kg"], item["rest_seconds"], item["notes"]) == (4, "6-8", 82.5, 120, "Pause on chest")
    assert item["order"] == 1 and item["exercise"]["name"] == "Barbell Bench Press" and item["exercise"]["workout_type"]["name"] == "Barbell"
    assert item["exercise"]["muscle_group"]["name"] == "Chest"
    c = p["cardio"][0]
    assert (c["cardio_activity"]["name"], c["duration_minutes"], c["distance_km"], c["notes"]) == ("Running", 20, 3.2, "Cool down")


def test_calendar_matches_the_planner_exactly(client, ref, lib):
    """No second source of truth: the calendar's day is byte-for-byte the planner's day."""
    cid = mk(client)
    plan_strength(client, ref, lib, cid, 2, 3, {"Chest": ["Cable Fly", "Barbell Bench Press"]}, target_sets=5, notes="n")
    client.post(day_url(cid, 2, 3) + "/cardio", json={"cardio_activity_id": 1, "duration_minutes": 10})
    cal = days(client, "2026-11-26", "2026-11-26")[0]["plan"]               # week 2, Thursday
    assert cal == client.get(day_url(cid, 2, 3)).json()


def test_changes_in_the_planner_show_up_immediately(client, ref, lib):
    cid = mk(client)
    assert days(client, "2026-11-16", "2026-11-16")[0]["plan"]["kind"] == "empty"
    plan_strength(client, ref, lib, cid, 1, 0, {"Chest": ["Cable Fly"]})
    assert days(client, "2026-11-16", "2026-11-16")[0]["plan"]["kind"] == "strength"
    client.delete(day_url(cid, 1, 0))
    assert days(client, "2026-11-16", "2026-11-16")[0]["plan"]["kind"] == "empty"


def test_copied_weeks_appear_on_their_own_dates(client, ref, lib):
    cid = mk(client)
    plan_strength(client, ref, lib, cid, 1, 0, {"Chest": ["Cable Fly"]})
    client.post(f"{CY}/{cid}/weeks/1/copy", json={"target_week_numbers": [3]})
    by = {d["date"]: d for d in days(client, "2026-11-16", "2026-12-06")}
    assert by["2026-11-16"]["plan"]["kind"] == "strength" and by["2026-11-23"]["plan"]["kind"] == "empty"
    assert by["2026-11-30"]["plan"]["kind"] == "strength" and by["2026-11-30"]["week_number"] == 3


# ---- validation --------------------------------------------------------------------------------

def fields(r):
    return {d["field"] for d in r.json()["error"].get("details", [])}


def test_invalid_ranges_are_rejected(client):
    r = get(client, "2026-11-20", "2026-11-19")
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error" and fields(r) == {"end"}
    assert get(client, "2026-01-01", "2026-03-04").status_code == 422          # 63 days
    assert get(client, "2026-01-01", "2026-03-03").status_code == 200          # exactly 62 days
    assert get(client, "1999-12-31", "2000-01-02").status_code == 422
    assert get(client, "2100-12-30", "2101-01-02").status_code == 422
    for params in ({}, {"start": "2026-11-01"}, {"end": "2026-11-30"}, {"start": "x", "end": "2026-11-30"},
                   {"start": "2026-02-30", "end": "2026-03-01"}, {"start": "01-11-2026", "end": "30-11-2026"}):
        r = client.get(CAL, params=params)
        assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error", params


def test_range_limit_is_inclusive_of_62_days(client):
    assert len(days(client, "2026-01-01", "2026-03-03")) == 62


def test_calendar_is_read_only(client):
    for method in ("post", "put", "patch", "delete"):
        assert getattr(client, method)(CAL).status_code == 405


# ---- timezone ----------------------------------------------------------------------------------

def test_today_uses_the_application_timezone(client, monkeypatch):
    from datetime import datetime, timezone
    from app.core import timezone as tz
    from app.services import calendar_service
    # 20:00 UTC on 18 Nov is 01:30 on 19 Nov in India.
    monkeypatch.setattr(calendar_service, "today_local", lambda: tz.today_local(datetime(2026, 11, 18, 20, 0, tzinfo=timezone.utc)))
    assert get(client, "2026-11-15", "2026-11-21").json()["today"] == "2026-11-19"
    monkeypatch.setattr(calendar_service, "today_local", lambda: tz.today_local(datetime(2026, 11, 18, 18, 29, tzinfo=timezone.utc)))
    assert get(client, "2026-11-15", "2026-11-21").json()["today"] == "2026-11-18"


def test_response_dates_are_plain_calendar_dates(client):
    mk(client)
    d = days(client, "2026-11-16", "2026-11-16")[0]
    assert d["date"] == "2026-11-16" and "T" not in d["date"]
    assert d["plan"]["date"] == "2026-11-16" and d["cycle"]["start_date"] == "2026-11-16"


# ---- efficiency --------------------------------------------------------------------------------

def count_selects(session_factory, client, start, end) -> int:
    engine = session_factory.kw["bind"]
    seen: list[str] = []
    listener = lambda conn, cur, stmt, params, ctx, many: seen.append(stmt)
    event.listen(engine, "before_cursor_execute", listener)
    try:
        assert get(client, start, end).status_code == 200
    finally:
        event.remove(engine, "before_cursor_execute", listener)
    return len([s for s in seen if s.lstrip().upper().startswith("SELECT")])


def test_query_count_does_not_grow_with_range_cycles_or_content(client, ref, lib, session_factory):
    # Baseline: one empty week, no cycles.
    empty = count_selects(session_factory, client, "2026-11-16", "2026-11-22")

    # Lots of content across three cycles and a full six-week grid.
    for name, start, status in [("A", "2026-10-26", "completed"), ("B", "2026-11-16", "active"), ("C", "2026-11-23", None)]:
        cid = mk(client, name=f"Cycle {name}", start=start, weeks=4)             # plan first: completed cycles are locked
        for w in (1, 2):
            for d in range(7):
                plan_strength(client, ref, lib, cid, w, d, {"Chest": ["Barbell Bench Press", "Cable Fly"], "Back": ["Lat Pulldown"]})
                client.post(day_url(cid, w, d) + "/cardio", json={"cardio_activity_id": 1, "duration_minutes": 10})
        for action in {"completed": ["activate", "complete"], "active": ["activate"], None: []}[status]:
            assert client.post(f"{CY}/{cid}/{action}").status_code == 200
    week = count_selects(session_factory, client, "2026-11-16", "2026-11-22")
    month = count_selects(session_factory, client, "2026-10-26", "2026-12-06")
    longest = count_selects(session_factory, client, "2026-10-01", "2026-11-30")
    assert max(week, month, longest) <= 9, (empty, week, month, longest)
    assert month == week == longest                                     # fixed cost, independent of days / cycles / exercises
    assert empty <= month
