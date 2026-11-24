import pytest

from app.models import Exercise, ScheduleExercise

URL = "/api/v1/exercises"


def payload(ref, **overrides) -> dict:
    base = {
        "name": "Barbell Bench Press",
        "description": "Classic horizontal press.",
        "muscle_group_id": ref["muscle"]["Chest"],
        "secondary_muscle_group_ids": [ref["muscle"]["Triceps"], ref["muscle"]["Shoulders"]],
        "target_area_id": ref["area"]["Chest"]["Middle Chest"],
        "workout_type_id": ref["type"]["Barbell"],
        "instructions": "Lower the bar to mid-chest, press up.",
        "media_url": "https://example.com/bench.jpg",
        "is_active": True,
    }
    base.update(overrides)
    return base


def create(client, ref, **overrides):
    r = client.post(URL, json=payload(ref, **overrides))
    assert r.status_code == 201, r.text
    return r.json()


def error_fields(response) -> set[str]:
    return {d["field"] for d in response.json()["error"].get("details", [])}


# ---- master data ---------------------------------------------------------------------------

def test_master_data_endpoints(client, ref):
    assert list(ref["muscle"]) == ["Chest", "Back", "Shoulders", "Biceps", "Triceps", "Forearms",
                                   "Abs / Core", "Quadriceps", "Hamstrings", "Glutes", "Calves"]
    assert list(ref["type"]) == ["Barbell", "Dumbbell", "Machine", "Cable", "Bodyweight",
                                 "Smith Machine", "Resistance Band", "Other"]
    assert list(ref["area"]["Chest"]) == ["Upper Chest", "Middle Chest", "Lower Chest", "Inner Chest"]
    assert list(ref["area"]["Back"]) == ["Upper Back", "Middle Back", "Lower Back", "Lats"]
    assert list(ref["area"]["Shoulders"]) == ["Front Delts", "Side Delts", "Rear Delts"]
    assert list(ref["area"]["Abs / Core"]) == ["Upper Abs", "Lower Abs", "Obliques"]
    assert list(ref["area"]["Calves"]) == ["Calves"]
    assert "Cardio" not in ref["muscle"]


# ---- create / read -------------------------------------------------------------------------

def test_create_returns_201_with_full_detail(client, ref):
    r = client.post(URL, json=payload(ref))
    assert r.status_code == 201
    assert r.headers["location"] == f"/api/v1/exercises/{r.json()['id']}"
    body = r.json()
    assert body["name"] == "Barbell Bench Press"
    assert body["description"] == "Classic horizontal press."
    assert body["muscle_group"]["name"] == "Chest"
    assert [g["name"] for g in body["secondary_muscle_groups"]] == ["Shoulders", "Triceps"]  # display order
    assert body["target_area"]["name"] == "Middle Chest"
    assert body["workout_type"]["name"] == "Barbell"
    assert body["is_active"] is True and body["usage_count"] == 0
    assert body["created_at"].endswith("Z") and body["updated_at"].endswith("Z")


def test_create_minimal_payload_uses_defaults(client, ref):
    r = client.post(URL, json={"name": "Push Up", "muscle_group_id": ref["muscle"]["Chest"]})
    assert r.status_code == 201
    body = r.json()
    assert body["is_active"] is True
    assert body["secondary_muscle_groups"] == [] and body["target_area"] is None and body["workout_type"] is None
    assert body["description"] is None and body["media_url"] is None


def test_create_normalises_input(client, ref):
    body = create(client, ref, name="   Incline   Dumbbell    Press ", description="   ", media_url="",
                  secondary_muscle_group_ids=[ref["muscle"]["Triceps"]] * 3)
    assert body["name"] == "Incline Dumbbell Press"
    assert body["description"] is None and body["media_url"] is None
    assert len(body["secondary_muscle_groups"]) == 1


def test_get_exercise_and_404(client, ref):
    created = create(client, ref)
    r = client.get(f"{URL}/{created['id']}")
    assert r.status_code == 200 and r.json() == created
    r = client.get(f"{URL}/9999")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "exercise_not_found"


# ---- validation ----------------------------------------------------------------------------

@pytest.mark.parametrize("bad_name", ["", " ", "A", "x" * 161])
def test_name_length_validation(client, ref, bad_name):
    r = client.post(URL, json=payload(ref, name=bad_name))
    assert r.status_code == 422 and "name" in error_fields(r)


def test_required_fields_and_unknown_fields_rejected(client, ref):
    r = client.post(URL, json={})
    assert r.status_code == 422 and {"name", "muscle_group_id"} <= error_fields(r)
    r = client.post(URL, json=payload(ref, bogus="x"))
    assert r.status_code == 422


@pytest.mark.parametrize("url", ["ftp://x.com/a.jpg", "javascript:alert(1)", "not a url", "http://"])
def test_media_url_must_be_http(client, ref, url):
    r = client.post(URL, json=payload(ref, media_url=url))
    assert r.status_code == 422 and "media_url" in error_fields(r)


def test_text_length_limits(client, ref):
    assert client.post(URL, json=payload(ref, description="x" * 2001)).status_code == 422
    assert client.post(URL, json=payload(ref, instructions="x" * 5001)).status_code == 422


def test_invalid_muscle_group(client, ref):
    r = client.post(URL, json=payload(ref, muscle_group_id=9999, target_area_id=None))
    assert r.status_code == 422 and error_fields(r) == {"muscle_group_id"}


def test_invalid_workout_type(client, ref):
    r = client.post(URL, json=payload(ref, workout_type_id=9999))
    assert r.status_code == 422 and error_fields(r) == {"workout_type_id"}


def test_invalid_secondary_muscles(client, ref):
    r = client.post(URL, json=payload(ref, secondary_muscle_group_ids=[9999]))
    assert r.status_code == 422 and error_fields(r) == {"secondary_muscle_group_ids"}
    r = client.post(URL, json=payload(ref, secondary_muscle_group_ids=[ref["muscle"]["Chest"]]))
    assert r.status_code == 422 and "primary" in r.text


def test_target_area_must_belong_to_primary_muscle(client, ref):
    # "Lats" is a Back area; the exercise's primary muscle is Chest.
    r = client.post(URL, json=payload(ref, target_area_id=ref["area"]["Back"]["Lats"]))
    assert r.status_code == 422 and error_fields(r) == {"target_area_id"}
    assert "not a target area of Chest" in r.text
    r = client.post(URL, json=payload(ref, target_area_id=9999))
    assert r.status_code == 422 and error_fields(r) == {"target_area_id"}


def test_multiple_reference_errors_reported_together(client, ref):
    r = client.post(URL, json=payload(ref, muscle_group_id=9999, workout_type_id=9999, secondary_muscle_group_ids=[8888]))
    assert error_fields(r) == {"muscle_group_id", "workout_type_id", "secondary_muscle_group_ids"}


def test_failed_validation_creates_nothing(client, ref):
    client.post(URL, json=payload(ref, workout_type_id=9999))
    assert client.get(URL).json()["total_all"] == 0


# ---- duplicates ----------------------------------------------------------------------------

def test_duplicate_name_is_case_insensitive(client, ref):
    create(client, ref, name="Cable Fly")
    for variant in ("Cable Fly", "cable fly", "CABLE FLY", "  Cable   Fly  "):
        r = client.post(URL, json=payload(ref, name=variant))
        assert r.status_code == 409, variant
        assert r.json()["error"]["code"] == "duplicate_name" and error_fields(r) == {"name"}
    assert client.get(URL).json()["total_all"] == 1


def test_duplicate_check_on_update_excludes_self(client, ref):
    a = create(client, ref, name="Squat")
    b = create(client, ref, name="Leg Press")
    assert client.put(f"{URL}/{a['id']}", json=payload(ref, name="SQUAT")).status_code == 200  # same record: ok
    r = client.put(f"{URL}/{b['id']}", json=payload(ref, name="squat"))
    assert r.status_code == 409 and r.json()["error"]["code"] == "duplicate_name"


def test_database_unique_index_backs_up_the_check(session_factory, ref):
    from sqlalchemy.exc import IntegrityError
    with session_factory() as s:
        s.add(Exercise(name="Deadlift", muscle_group_id=ref["muscle"]["Back"]))
        s.commit()
        s.add(Exercise(name="DEADLIFT", muscle_group_id=ref["muscle"]["Back"]))
        with pytest.raises(IntegrityError):
            s.commit()


# ---- update --------------------------------------------------------------------------------

def test_update_replaces_all_fields(client, ref):
    created = create(client, ref)
    new = payload(
        ref, name="Incline Dumbbell Press", description=None,
        target_area_id=ref["area"]["Chest"]["Upper Chest"], workout_type_id=ref["type"]["Dumbbell"],
        secondary_muscle_group_ids=[], instructions=None, media_url=None, is_active=False,
    )
    r = client.put(f"{URL}/{created['id']}", json=new)
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == created["id"] and body["name"] == "Incline Dumbbell Press"
    assert body["target_area"]["name"] == "Upper Chest" and body["workout_type"]["name"] == "Dumbbell"
    assert body["secondary_muscle_groups"] == [] and body["description"] is None and body["is_active"] is False
    assert body["created_at"] == created["created_at"]
    assert body["updated_at"] >= created["updated_at"]
    assert client.get(f"{URL}/{created['id']}").json() == body  # persisted


def test_update_changing_primary_requires_matching_target_area(client, ref):
    created = create(client, ref)  # Chest / Middle Chest
    r = client.put(f"{URL}/{created['id']}", json=payload(ref, muscle_group_id=ref["muscle"]["Back"],
                                                         secondary_muscle_group_ids=[]))
    assert r.status_code == 422 and error_fields(r) == {"target_area_id"}
    ok = client.put(f"{URL}/{created['id']}", json=payload(
        ref, muscle_group_id=ref["muscle"]["Back"], secondary_muscle_group_ids=[],
        target_area_id=ref["area"]["Back"]["Lats"], workout_type_id=ref["type"]["Cable"]))
    assert ok.status_code == 200 and ok.json()["muscle_group"]["name"] == "Back"


def test_update_missing_exercise_404(client, ref):
    assert client.put(f"{URL}/9999", json=payload(ref)).status_code == 404


def test_failed_update_leaves_record_unchanged(client, ref):
    created = create(client, ref)
    client.put(f"{URL}/{created['id']}", json=payload(ref, name="Changed", workout_type_id=9999))
    assert client.get(f"{URL}/{created['id']}").json()["name"] == "Barbell Bench Press"


# ---- activate / deactivate -----------------------------------------------------------------

def test_activate_and_deactivate(client, ref):
    created = create(client, ref)
    r = client.patch(f"{URL}/{created['id']}/status", json={"is_active": False})
    assert r.status_code == 200 and r.json()["is_active"] is False
    assert client.get(f"{URL}/{created['id']}").json()["is_active"] is False
    r = client.patch(f"{URL}/{created['id']}/status", json={"is_active": True})
    assert r.json()["is_active"] is True
    assert client.patch(f"{URL}/9999/status", json={"is_active": True}).status_code == 404
    assert client.patch(f"{URL}/{created['id']}/status", json={"is_active": "maybe"}).status_code == 422


# ---- delete --------------------------------------------------------------------------------

def test_delete_unused_exercise(client, ref):
    created = create(client, ref)
    assert client.delete(f"{URL}/{created['id']}").status_code == 204
    assert client.get(f"{URL}/{created['id']}").status_code == 404
    assert client.delete(f"{URL}/{created['id']}").status_code == 404


def test_delete_removes_secondary_links_but_not_muscle_groups(client, ref, session_factory):
    from sqlalchemy import text
    created = create(client, ref)
    client.delete(f"{URL}/{created['id']}")
    with session_factory() as s:
        assert s.execute(text("SELECT COUNT(*) FROM exercise_secondary_muscle_groups")).scalar() == 0
        assert s.execute(text("SELECT COUNT(*) FROM muscle_groups")).scalar() == 11


def _schedule_exercise(s, exercise_id: int, muscle_group_id: int):
    from datetime import date
    from app.models import DailySchedule, ScheduleMuscleGroup, WeeklyPlan, WorkoutCycle
    cycle = WorkoutCycle(name="c", start_date=date(2026, 11, 16), total_weeks=4)
    plan = WeeklyPlan(cycle=cycle, week_number=1)
    day = DailySchedule(weekly_plan=plan, day_of_week=0)
    smg = ScheduleMuscleGroup(daily_schedule=day, muscle_group_id=muscle_group_id)
    s.add_all([cycle, plan, day, smg, ScheduleExercise(schedule_muscle_group=smg, exercise_id=exercise_id)])
    s.commit()


def test_cannot_delete_exercise_used_in_a_schedule(client, ref, session_factory):
    created = create(client, ref)
    with session_factory() as s:
        _schedule_exercise(s, created["id"], ref["muscle"]["Chest"])
    r = client.delete(f"{URL}/{created['id']}")
    assert r.status_code == 409
    err = r.json()["error"]
    assert err["code"] == "exercise_in_use" and "Deactivate" in err["message"] and "1 planned" in err["message"]
    detail = client.get(f"{URL}/{created['id']}").json()
    assert detail["usage_count"] == 1  # still there
    # ...and deactivating is the allowed alternative.
    assert client.patch(f"{URL}/{created['id']}/status", json={"is_active": False}).json()["is_active"] is False


def test_cannot_delete_exercise_with_workout_history(client, ref, session_factory):
    from datetime import date, datetime
    from app.models import WorkoutSession, WorkoutSessionExercise
    created = create(client, ref)
    with session_factory() as s:
        session = WorkoutSession(workout_date=date(2026, 11, 18), source="blank", status="in_progress", started_at=datetime(2026, 11, 18, 5, 0))
        session.exercises.append(WorkoutSessionExercise(exercise_id=created["id"], position=1, exercise_name="Barbell Bench Press"))
        s.add(session)
        s.commit()
    r = client.delete(f"{URL}/{created['id']}")
    assert r.status_code == 409 and r.json()["error"]["code"] == "exercise_in_use"
    assert client.get(f"{URL}/{created['id']}").json()["usage_count"] == 1


# ---- list: search / filter / sort / pagination ---------------------------------------------

@pytest.fixture
def library(client, ref):
    """A small mixed library."""
    m, t, a = ref["muscle"], ref["type"], ref["area"]
    spec = [
        ("Barbell Bench Press", "Chest", "Middle Chest", "Barbell", True),
        ("Incline Dumbbell Press", "Chest", "Upper Chest", "Dumbbell", True),
        ("Cable Fly", "Chest", "Inner Chest", "Cable", True),
        ("Lat Pulldown", "Back", "Lats", "Cable", True),
        ("Barbell Row", "Back", "Middle Back", "Barbell", False),
        ("Lateral Raise", "Shoulders", "Side Delts", "Dumbbell", True),
        ("Plank", "Abs / Core", None, "Bodyweight", True),
    ]
    out = {}
    for name, group, area, wtype, active in spec:
        out[name] = create(client, ref, name=name, muscle_group_id=m[group], secondary_muscle_group_ids=[],
                           target_area_id=a[group][area] if area else None, workout_type_id=t[wtype],
                           is_active=active)
    return out


def names(response) -> list[str]:
    assert response.status_code == 200, response.text
    return [i["name"] for i in response.json()["items"]]


def test_list_default_sorted_by_name(client, library):
    r = client.get(URL)
    assert names(r) == sorted(library, key=str.lower)
    body = r.json()
    assert body["total"] == body["total_all"] == 7 and body["page"] == 1 and body["pages"] == 1


def test_empty_library(client):
    body = client.get(URL).json()
    assert body == {"items": [], "total": 0, "total_all": 0, "page": 1, "page_size": 20, "pages": 1}


def test_search_by_name(client, library):
    assert names(client.get(URL, params={"search": "press"})) == ["Barbell Bench Press", "Incline Dumbbell Press"]
    assert names(client.get(URL, params={"search": "PRESS"})) == ["Barbell Bench Press", "Incline Dumbbell Press"]
    assert names(client.get(URL, params={"search": "  lat  "})) == ["Lat Pulldown", "Lateral Raise"]
    assert names(client.get(URL, params={"search": "zzz"})) == []
    assert client.get(URL, params={"search": "zzz"}).json()["total_all"] == 7  # header total ignores filters


def test_search_treats_wildcards_literally(client, library):
    assert names(client.get(URL, params={"search": "%"})) == []
    assert names(client.get(URL, params={"search": "_"})) == []
    assert len(names(client.get(URL, params={"search": ""}))) == 7


def test_filter_by_muscle_group(client, library, ref):
    assert names(client.get(URL, params={"muscle_group_id": ref["muscle"]["Chest"]})) == [
        "Barbell Bench Press", "Cable Fly", "Incline Dumbbell Press"]
    assert names(client.get(URL, params={"muscle_group_id": ref["muscle"]["Calves"]})) == []


def test_filter_by_workout_type(client, library, ref):
    assert names(client.get(URL, params={"workout_type_id": ref["type"]["Cable"]})) == ["Cable Fly", "Lat Pulldown"]
    assert names(client.get(URL, params={"workout_type_id": ref["type"]["Machine"]})) == []


def test_filter_by_target_area(client, library, ref):
    assert names(client.get(URL, params={"target_area_id": ref["area"]["Chest"]["Upper Chest"]})) == ["Incline Dumbbell Press"]
    assert names(client.get(URL, params={"target_area_id": ref["area"]["Back"]["Lats"]})) == ["Lat Pulldown"]


def test_filter_by_active_status(client, library):
    assert names(client.get(URL, params={"is_active": False})) == ["Barbell Row"]
    assert len(names(client.get(URL, params={"is_active": True}))) == 6


def test_filters_combine_with_and(client, library, ref):
    r = client.get(URL, params={"muscle_group_id": ref["muscle"]["Back"], "workout_type_id": ref["type"]["Barbell"],
                                "is_active": False, "search": "row"})
    assert names(r) == ["Barbell Row"]
    r = client.get(URL, params={"muscle_group_id": ref["muscle"]["Back"], "workout_type_id": ref["type"]["Dumbbell"]})
    assert names(r) == []


def test_sorting(client, library):
    asc = names(client.get(URL, params={"sort": "name", "order": "asc"}))
    assert names(client.get(URL, params={"sort": "name", "order": "desc"})) == asc[::-1]
    newest_first = names(client.get(URL, params={"sort": "created_at", "order": "desc"}))
    assert newest_first[0] == "Plank" and newest_first[-1] == "Barbell Bench Press"
    assert client.get(URL, params={"sort": "bogus"}).status_code == 422
    assert client.get(URL, params={"order": "sideways"}).status_code == 422


def test_pagination(client, library):
    p1 = client.get(URL, params={"page": 1, "page_size": 3}).json()
    p2 = client.get(URL, params={"page": 2, "page_size": 3}).json()
    p3 = client.get(URL, params={"page": 3, "page_size": 3}).json()
    assert (p1["total"], p1["pages"], len(p1["items"]), len(p2["items"]), len(p3["items"])) == (7, 3, 3, 3, 1)
    seen = [i["name"] for p in (p1, p2, p3) for i in p["items"]]
    assert seen == sorted(library, key=str.lower) and len(set(seen)) == 7   # no gaps, no repeats
    beyond = client.get(URL, params={"page": 9, "page_size": 3}).json()
    assert beyond["items"] == [] and beyond["pages"] == 3 and beyond["total"] == 7


def test_pagination_validation(client):
    for params in ({"page": 0}, {"page_size": 0}, {"page_size": 101}, {"page": "x"}):
        r = client.get(URL, params=params)
        assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error", params


def test_filter_params_validation(client):
    assert client.get(URL, params={"muscle_group_id": "abc"}).status_code == 422
    assert client.get(URL, params={"muscle_group_id": 0}).status_code == 422
    assert client.get(URL, params={"is_active": "maybe"}).status_code == 422


def test_list_reports_usage_count(client, ref, session_factory):
    used = create(client, ref, name="Used")
    create(client, ref, name="Unused")
    with session_factory() as s:
        _schedule_exercise(s, used["id"], ref["muscle"]["Chest"])
    counts = {i["name"]: i["usage_count"] for i in client.get(URL).json()["items"]}
    assert counts == {"Unused": 0, "Used": 1}
