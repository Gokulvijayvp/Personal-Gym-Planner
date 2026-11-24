from datetime import date, timedelta

import pytest
from sqlalchemy import text

from app.core import timezone as tz

CY = "/api/v1/cycles"
START = "2026-11-16"  # a Monday


def body(**kw) -> dict:
    base = {"name": "Winter Cut", "description": "Eight weeks of work.", "start_date": START, "total_weeks": 8}
    base.update(kw)
    return base


def make(client, **kw) -> dict:
    r = client.post(CY, json=body(**kw))
    assert r.status_code == 201, r.text
    return r.json()


def err_fields(r) -> set[str]:
    return {d["field"] for d in r.json()["error"].get("details", [])}


# ---- date rules -----------------------------------------------------------------------------

def test_cycle_date_helpers():
    s = date(2026, 11, 16)
    assert tz.is_monday(s) and not tz.is_monday(date(2026, 11, 17))
    assert tz.cycle_end_date(s, 1) == date(2026, 11, 22)               # Sunday of the same week
    assert tz.cycle_end_date(s, 8) == date(2027, 1, 10)                # crosses the year
    assert tz.cycle_end_date(s, 8).weekday() == 6                      # always a Sunday
    assert tz.cycle_date(s, 1, 0) == s and tz.cycle_date(s, 2, 6) == date(2026, 11, 29)
    assert tz.cycle_date(date(2028, 2, 21), 2, 1) == date(2028, 2, 29)  # leap day
    assert tz.cycle_slot(s, date(2026, 11, 29)) == (2, 6)
    assert tz.cycle_slot(s, s - timedelta(days=1)) is None
    for week in (1, 5, 12):                                            # round trip, no off-by-one
        for dow in range(7):
            assert tz.cycle_slot(s, tz.cycle_date(s, week, dow)) == (week, dow)


# ---- create ---------------------------------------------------------------------------------

def test_create_generates_every_week_and_calculates_end_date(client):
    r = client.post(CY, json=body())
    assert r.status_code == 201
    assert r.headers["location"] == f"/api/v1/cycles/{r.json()['id']}"
    c = r.json()
    assert c["status"] == "draft" and c["total_weeks"] == 8
    assert c["start_date"] == "2026-11-16" and c["end_date"] == "2027-01-10"
    assert [w["week_number"] for w in c["weeks"]] == list(range(1, 9))
    assert c["weeks"][0]["start_date"] == "2026-11-16" and c["weeks"][0]["end_date"] == "2026-11-22"
    assert c["weeks"][7]["start_date"] == "2027-01-04" and c["weeks"][7]["end_date"] == "2027-01-10"
    assert c["weeks"][7]["end_date"] == c["end_date"]
    assert c["planned_days"] == c["rest_days"] == c["exercise_count"] == 0
    assert c["created_at"].endswith("Z")


@pytest.mark.parametrize("weeks", [1, 2, 4, 6, 8, 12, 13, 26, 52])
def test_custom_week_counts_are_never_hardcoded(client, weeks):
    c = make(client, name=f"Cycle {weeks}", total_weeks=weeks)
    assert len(c["weeks"]) == weeks and c["total_weeks"] == weeks
    assert date.fromisoformat(c["end_date"]) == date(2026, 11, 16) + timedelta(days=7 * weeks - 1)
    assert c["weeks"][-1]["week_number"] == weeks and c["weeks"][-1]["end_date"] == c["end_date"]


@pytest.mark.parametrize("weeks", [0, -1, 53, 1000, "x", None, 4.5])
def test_invalid_week_counts_rejected(client, weeks):
    r = client.post(CY, json=body(total_weeks=weeks))
    assert r.status_code == 422 and "total_weeks" in err_fields(r)
    assert client.get(CY).json() == []  # nothing half-created


@pytest.mark.parametrize("start", ["2026-11-17", "2026-11-22", "2026-02-30", "16-11-2026", "", "tomorrow", "1999-01-04", "2101-01-04"])
def test_invalid_start_dates_rejected(client, start):
    r = client.post(CY, json=body(start_date=start))
    assert r.status_code == 422 and "start_date" in err_fields(r)


def test_start_date_must_be_monday_message(client):
    r = client.post(CY, json=body(start_date="2026-11-18"))
    assert "Monday" in r.text


def test_name_and_field_validation(client):
    assert client.post(CY, json=body(name="x")).status_code == 422
    assert client.post(CY, json=body(name="x" * 121)).status_code == 422
    assert client.post(CY, json=body(description="x" * 2001)).status_code == 422
    assert client.post(CY, json=body(bogus=1)).status_code == 422
    assert client.post(CY, json={}).status_code == 422
    c = make(client, name="  Spaced    Out  ", description="   ")
    assert c["name"] == "Spaced Out" and c["description"] is None


def test_duplicate_name_and_start_rejected_but_other_dates_allowed(client):
    make(client)
    r = client.post(CY, json=body(name="winter CUT"))
    assert r.status_code == 409 and r.json()["error"]["code"] == "duplicate_cycle" and err_fields(r) == {"name"}
    assert client.post(CY, json=body(start_date="2026-12-14")).status_code == 201
    assert len(client.get(CY).json()) == 2


def test_create_rolls_back_completely_on_failure(client, monkeypatch):
    from app.services import cycle_service

    def boom(*a, **k):
        raise RuntimeError("disk on fire")
    monkeypatch.setattr(cycle_service, "_add_weeks", boom)
    assert client.post(CY, json=body()).status_code == 500
    monkeypatch.undo()
    assert client.get(CY).json() == []  # no orphan cycle without weeks


# ---- read -----------------------------------------------------------------------------------

def test_list_get_and_filter(client):
    a = make(client, name="Cycle A", start_date="2026-11-16", total_weeks=4)
    b = make(client, name="Cycle B", start_date="2027-02-01", total_weeks=6)
    listed = client.get(CY).json()
    assert [c["name"] for c in listed] == ["Cycle B", "Cycle A"]            # newest start first
    assert "weeks" not in listed[0]
    assert client.get(f"{CY}/{a['id']}").json()["name"] == "Cycle A"
    assert [c["name"] for c in client.get(CY, params={"status": "draft"}).json()] == ["Cycle B", "Cycle A"]
    client.post(f"{CY}/{b['id']}/activate")
    assert [c["name"] for c in client.get(CY, params={"status": "active"}).json()] == ["Cycle B"]
    assert client.get(CY, params={"status": "weird"}).status_code == 422


def test_get_unknown_and_invalid_ids(client):
    r = client.get(f"{CY}/999")
    assert r.status_code == 404 and r.json()["error"]["code"] == "cycle_not_found"
    assert client.get(f"{CY}/0").status_code == 422
    assert client.get(f"{CY}/abc").status_code == 422


# ---- update ---------------------------------------------------------------------------------

def test_update_basic_fields(client):
    c = make(client)
    r = client.put(f"{CY}/{c['id']}", json=body(name="Renamed", description=None, start_date="2026-11-23"))
    assert r.status_code == 200
    u = r.json()
    assert u["name"] == "Renamed" and u["description"] is None and u["start_date"] == "2026-11-23"
    assert u["end_date"] == "2027-01-17" and u["weeks"][0]["start_date"] == "2026-11-23"
    assert client.put(f"{CY}/999", json=body()).status_code == 404
    assert client.put(f"{CY}/{c['id']}", json=body(start_date="2026-11-24")).status_code == 422


def test_update_extends_and_shortens_weeks(client):
    c = make(client, total_weeks=4)
    client.put(f"{CY}/{c['id']}/weeks/1/days/0", json={"status": "rest"})
    longer = client.put(f"{CY}/{c['id']}", json=body(total_weeks=6)).json()
    assert [w["week_number"] for w in longer["weeks"]] == [1, 2, 3, 4, 5, 6]
    assert longer["rest_days"] == 1                                         # existing plan untouched
    shorter = client.put(f"{CY}/{c['id']}", json=body(total_weeks=2)).json()
    assert [w["week_number"] for w in shorter["weeks"]] == [1, 2] and shorter["end_date"] == "2026-11-29"
    assert shorter["rest_days"] == 1


def test_cannot_shorten_over_planned_weeks_and_nothing_changes(client):
    c = make(client, total_weeks=6)
    client.put(f"{CY}/{c['id']}/weeks/5/days/2", json={"status": "rest"})
    r = client.put(f"{CY}/{c['id']}", json=body(total_weeks=3, name="Should not apply"))
    assert r.status_code == 409 and r.json()["error"]["code"] == "weeks_not_empty"
    assert "5" in r.json()["error"]["message"] and err_fields(r) == {"total_weeks"}
    after = client.get(f"{CY}/{c['id']}").json()
    assert after["total_weeks"] == 6 and after["name"] == "Winter Cut" and len(after["weeks"]) == 6


# ---- status machine -------------------------------------------------------------------------

def test_status_transitions(client):
    c = make(client)
    cid = c["id"]
    assert client.post(f"{CY}/{cid}/complete").status_code == 409          # draft can't complete
    a = client.post(f"{CY}/{cid}/activate")
    assert a.status_code == 200 and a.json()["status"] == "active"
    r = client.post(f"{CY}/{cid}/activate")
    assert r.status_code == 409 and r.json()["error"]["code"] == "invalid_status_transition"
    assert client.post(f"{CY}/{cid}/complete").json()["status"] == "completed"
    assert client.post(f"{CY}/{cid}/activate").status_code == 409          # completed can't re-activate
    assert client.post(f"{CY}/{cid}/archive").json()["status"] == "archived"
    assert client.post(f"{CY}/{cid}/archive").status_code == 409
    assert client.post(f"{CY}/999/activate").status_code == 404


def test_draft_can_be_archived_directly(client):
    c = make(client)
    assert client.post(f"{CY}/{c['id']}/archive").json()["status"] == "archived"


def test_completed_and_archived_cycles_are_read_only(client):
    c = make(client)
    cid = c["id"]
    client.post(f"{CY}/{cid}/activate")
    client.post(f"{CY}/{cid}/complete")
    r = client.put(f"{CY}/{cid}", json=body(name="Nope"))
    assert r.status_code == 409 and r.json()["error"]["code"] == "cycle_locked"
    r = client.put(f"{CY}/{cid}/weeks/1/days/0", json={"status": "rest"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "cycle_locked"
    assert client.get(f"{CY}/{cid}/weeks/1").status_code == 200          # still viewable


# ---- delete ---------------------------------------------------------------------------------

def test_only_draft_cycles_can_be_deleted_and_children_go_with_them(client, session_factory):
    c = make(client, total_weeks=3)
    client.put(f"{CY}/{c['id']}/weeks/1/days/0", json={"status": "rest"})
    client.post(f"{CY}/{c['id']}/weeks/2/days/1/muscle-groups", json={"muscle_group_id": 1})
    assert client.delete(f"{CY}/{c['id']}").status_code == 204
    assert client.get(f"{CY}/{c['id']}").status_code == 404
    with session_factory() as s:
        for table in ("weekly_plans", "daily_schedules", "schedule_muscle_groups"):
            assert s.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar() == 0, table
        assert s.execute(text("SELECT COUNT(*) FROM muscle_groups")).scalar() == 11   # master data untouched

    c2 = make(client, name="Live")
    client.post(f"{CY}/{c2['id']}/activate")
    r = client.delete(f"{CY}/{c2['id']}")
    assert r.status_code == 409 and r.json()["error"]["code"] == "cycle_not_deletable"
    assert client.get(f"{CY}/{c2['id']}").status_code == 200
    assert client.delete(f"{CY}/999").status_code == 404


# ---- overlapping active cycles --------------------------------------------------------------

def _activate(client, **kw):
    c = make(client, **kw)
    return c, client.post(f"{CY}/{c['id']}/activate")


def test_overlapping_active_cycles_are_blocked(client):
    a, r = _activate(client, name="Cycle A", start_date="2026-11-16", total_weeks=4)   # Nov 16 – Dec 13
    assert r.status_code == 200
    b, r = _activate(client, name="Cycle B", start_date="2026-12-07", total_weeks=4)   # overlaps last week of A
    assert r.status_code == 409 and r.json()["error"]["code"] == "cycle_overlap"
    assert "'Cycle A'" in r.json()["error"]["message"] and "13 Dec 2026" in r.json()["error"]["message"]
    assert client.get(f"{CY}/{b['id']}").json()["status"] == "draft"             # unchanged


def test_overlap_boundaries_are_exact(client):
    _activate(client, name="Cycle A", start_date="2026-11-16", total_weeks=4)          # ends Sun 13 Dec
    ok, r = _activate(client, name="Next", start_date="2026-12-14", total_weeks=2)  # Monday right after
    assert r.status_code == 200
    before, r = _activate(client, name="Before", start_date="2026-11-09", total_weeks=1)  # ends Sun 15 Nov
    assert r.status_code == 200
    touching, r = _activate(client, name="Touch", start_date="2026-11-09", total_weeks=2)  # ends 22 Nov: overlaps A
    assert r.status_code == 409


def test_draft_cycles_may_overlap_and_completing_frees_the_slot(client):
    a, _ = _activate(client, name="Cycle A", start_date="2026-11-16", total_weeks=4)
    b = make(client, name="Cycle B", start_date="2026-11-23", total_weeks=4)           # draft: allowed to overlap
    assert b["status"] == "draft"
    client.post(f"{CY}/{a['id']}/complete")
    assert client.post(f"{CY}/{b['id']}/activate").status_code == 200


def test_archived_and_completed_cycles_never_block(client):
    a, _ = _activate(client, name="Cycle A", start_date="2026-11-16", total_weeks=4)
    client.post(f"{CY}/{a['id']}/archive")
    _, r = _activate(client, name="Cycle B", start_date="2026-11-16", total_weeks=4, description="same dates")
    assert r.status_code == 200


def test_editing_an_active_cycle_into_an_overlap_is_blocked(client):
    _activate(client, name="Cycle A", start_date="2026-11-16", total_weeks=4)          # to 13 Dec
    b, r = _activate(client, name="Cycle B", start_date="2026-12-14", total_weeks=2)   # 14 Dec – 27 Dec
    assert r.status_code == 200
    r = client.put(f"{CY}/{b['id']}", json=body(name="Cycle B", start_date="2026-12-14", total_weeks=2))   # unchanged: ok
    assert r.status_code == 200
    r = client.put(f"{CY}/{b['id']}", json=body(name="Cycle B", start_date="2026-12-07", total_weeks=2))
    assert r.status_code == 409 and r.json()["error"]["code"] == "cycle_overlap"
    assert client.get(f"{CY}/{b['id']}").json()["start_date"] == "2026-12-14"


# ---- summary statistics ---------------------------------------------------------------------

def test_summary_counts_reflect_the_plan(client):
    c = make(client, total_weeks=2)
    cid = c["id"]
    client.put(f"{CY}/{cid}/weeks/1/days/6", json={"status": "rest"})
    client.post(f"{CY}/{cid}/weeks/1/days/0/muscle-groups", json={"muscle_group_id": 1})
    client.post(f"{CY}/{cid}/weeks/2/days/5/cardio", json={"cardio_activity_id": 1, "duration_minutes": 30})
    d = client.get(f"{CY}/{cid}").json()
    assert (d["planned_days"], d["rest_days"], d["cardio_count"]) == (2, 1, 1)
    assert d["weeks"][0]["planned_days"] == 1 and d["weeks"][0]["rest_days"] == 1
    assert d["weeks"][1]["planned_days"] == 1 and d["weeks"][1]["cardio_count"] == 1
    assert client.get(CY).json()[0]["planned_days"] == 2
