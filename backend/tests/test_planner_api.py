import pytest
from sqlalchemy import text

CY = "/api/v1/cycles"


def day(c, w, d) -> str:
    return f"{CY}/{c}/weeks/{w}/days/{d}"


def err_fields(r) -> set[str]:
    return {d["field"] for d in r.json()["error"].get("details", [])}


@pytest.fixture
def cycle(client) -> int:
    r = client.post(CY, json={"name": "Test Cycle", "start_date": "2026-11-16", "total_weeks": 4})
    assert r.status_code == 201, r.text
    return r.json()["id"]


@pytest.fixture
def lib(client, ref) -> dict:
    """A small exercise library: name -> id (chest-heavy so weeks can use different movements)."""
    m, t, a = ref["muscle"], ref["type"], ref["area"]
    spec = [
        ("Barbell Bench Press", "Chest", "Middle Chest", "Barbell"),
        ("Incline Barbell Press", "Chest", "Upper Chest", "Barbell"),
        ("Cable Fly", "Chest", "Inner Chest", "Cable"),
        ("Incline Dumbbell Press", "Chest", "Upper Chest", "Dumbbell"),
        ("Flat Dumbbell Press", "Chest", "Middle Chest", "Dumbbell"),
        ("Pec Deck Machine", "Chest", "Inner Chest", "Machine"),
        ("Smith Machine Bench Press", "Chest", "Middle Chest", "Smith Machine"),
        ("Cable Crossover", "Chest", "Lower Chest", "Cable"),
        ("Dumbbell Fly", "Chest", "Inner Chest", "Dumbbell"),
        ("Lat Pulldown", "Back", "Lats", "Cable"),
        ("Triceps Pushdown", "Triceps", "Triceps", "Cable"),
    ]
    out = {}
    for name, group, area, wtype in spec:
        r = client.post("/api/v1/exercises", json={
            "name": name, "muscle_group_id": m[group], "target_area_id": a[group][area], "workout_type_id": t[wtype]})
        assert r.status_code == 201, r.text
        out[name] = r.json()["id"]
    return out


@pytest.fixture
def cardio(client) -> dict:
    return {c["name"]: c["id"] for c in client.get("/api/v1/cardio-activities").json()}


def add_group(client, cid, w, d, group_id):
    r = client.post(day(cid, w, d) + "/muscle-groups", json={"muscle_group_id": group_id})
    assert r.status_code == 201, r.text
    return r.json()


def add_ex(client, cid, w, d, group_id, exercise_id, **kw):
    r = client.post(day(cid, w, d) + f"/muscle-groups/{group_id}/exercises", json={"exercise_id": exercise_id, **kw})
    assert r.status_code == 201, r.text
    return r.json()


def names(detail, group_index=0) -> list[str]:
    return [e["exercise"]["name"] for e in detail["strength"][group_index]["exercises"]]


def orders(detail, group_index=0) -> list[int]:
    return [e["order"] for e in detail["strength"][group_index]["exercises"]]


def plan_chest_day(client, ref, lib, cid, w, d, exercise_names):
    gid = ref["muscle"]["Chest"]
    add_group(client, cid, w, d, gid)
    out = None
    for n in exercise_names:
        out = add_ex(client, cid, w, d, gid, lib[n])
    return out


# ---- reading weeks and days -----------------------------------------------------------------

def test_week_always_has_seven_days_monday_first(client, cycle):
    w = client.get(f"{CY}/{cycle}/weeks/2").json()
    assert w["week_number"] == 2 and w["start_date"] == "2026-11-23" and w["end_date"] == "2026-11-29"
    assert [d["day_of_week"] for d in w["days"]] == list(range(7))
    assert [d["date"] for d in w["days"]] == [f"2026-11-{23 + i}" for i in range(7)]
    assert all(d["status"] == "unplanned" and d["kind"] == "empty" and d["schedule_id"] is None for d in w["days"])
    assert w["cycle"]["id"] == cycle and w["cycle"]["status"] == "draft"


def test_invalid_week_and_day_numbers(client, cycle):
    r = client.get(f"{CY}/{cycle}/weeks/5")                                 # cycle has 4 weeks
    assert r.status_code == 404 and r.json()["error"]["code"] == "week_not_found"
    assert client.get(f"{CY}/{cycle}/weeks/0").status_code == 422
    assert client.get(f"{CY}/{cycle}/weeks/53").status_code == 422
    assert client.get(day(cycle, 1, 7)).status_code == 422
    assert client.get(day(cycle, 1, -1)).status_code == 422
    assert client.get(day(999, 1, 0)).status_code == 404


# ---- day: rest / notes / title --------------------------------------------------------------

def test_rest_day(client, cycle):
    r = client.put(day(cycle, 1, 6), json={"status": "rest"})
    assert r.status_code == 200
    d = r.json()
    assert d["status"] == "rest" and d["kind"] == "rest" and d["display_title"] == "Rest day"
    assert d["date"] == "2026-11-22" and d["exercise_count"] == 0
    w = client.get(f"{CY}/{cycle}/weeks/1").json()
    assert w["days"][6]["kind"] == "rest" and w["days"][5]["kind"] == "empty"


def test_custom_day_notes_and_title(client, cycle):
    d = client.put(day(cycle, 1, 0), json={"status": "planned", "title": "  Push day ", "notes": "Heavy. Warm up well."}).json()
    assert d["title"] == "Push day" and d["notes"] == "Heavy. Warm up well." and d["display_title"] == "Push day"
    assert d["status"] == "planned" and d["kind"] == "empty"
    again = client.put(day(cycle, 1, 0), json={"status": "planned", "title": None, "notes": None}).json()
    assert again["title"] is None and again["notes"] is None
    assert client.put(day(cycle, 1, 0), json={"status": "cancelled"}).status_code == 422
    assert client.put(day(cycle, 1, 0), json={"status": "planned", "notes": "x" * 2001}).status_code == 422


def test_rest_day_rejects_workouts_and_converting_needs_confirmation(client, ref, cycle, cardio):
    client.put(day(cycle, 1, 6), json={"status": "rest"})
    r = client.post(day(cycle, 1, 6) + "/muscle-groups", json={"muscle_group_id": ref["muscle"]["Chest"]})
    assert r.status_code == 409 and r.json()["error"]["code"] == "rest_day"
    r = client.post(day(cycle, 1, 6) + "/cardio", json={"cardio_activity_id": cardio["Running"], "duration_minutes": 20})
    assert r.status_code == 409 and r.json()["error"]["code"] == "rest_day"

    add_group(client, cycle, 1, 0, ref["muscle"]["Chest"])
    r = client.put(day(cycle, 1, 0), json={"status": "rest"})               # would silently drop the workout
    assert r.status_code == 409 and r.json()["error"]["code"] == "day_has_workout"
    assert client.get(day(cycle, 1, 0)).json()["kind"] == "strength"        # nothing lost
    ok = client.put(day(cycle, 1, 0), json={"status": "rest", "clear_workout": True}).json()
    assert ok["kind"] == "rest" and ok["strength"] == []

    back = client.put(day(cycle, 1, 6), json={"status": "planned"}).json()  # rest -> workout day again
    assert back["status"] == "unplanned" and back["kind"] == "empty"        # nothing planned on it yet
    add_group(client, cycle, 1, 6, ref["muscle"]["Back"])


# ---- muscle groups --------------------------------------------------------------------------

def test_multiple_muscle_groups_in_one_day(client, ref, cycle):
    m = ref["muscle"]
    add_group(client, cycle, 1, 0, m["Chest"])
    add_group(client, cycle, 1, 0, m["Triceps"])
    d = add_group(client, cycle, 1, 0, m["Shoulders"])
    assert [g["muscle_group"]["name"] for g in d["strength"]] == ["Chest", "Triceps", "Shoulders"]
    assert d["kind"] == "strength" and d["display_title"] == "Chest + Triceps + Shoulders"
    assert [g["name"] for g in d["muscle_groups"]] == ["Chest", "Triceps", "Shoulders"]
    week_day = client.get(f"{CY}/{cycle}/weeks/1").json()["days"][0]
    assert [g["name"] for g in week_day["muscle_groups"]] == ["Chest", "Triceps", "Shoulders"]


def test_muscle_group_validation(client, ref, cycle):
    add_group(client, cycle, 1, 0, ref["muscle"]["Chest"])
    r = client.post(day(cycle, 1, 0) + "/muscle-groups", json={"muscle_group_id": ref["muscle"]["Chest"]})
    assert r.status_code == 409 and r.json()["error"]["code"] == "muscle_group_already_added"
    r = client.post(day(cycle, 1, 0) + "/muscle-groups", json={"muscle_group_id": 9999})
    assert r.status_code == 422 and err_fields(r) == {"muscle_group_id"}
    assert client.post(day(cycle, 1, 0) + "/muscle-groups", json={}).status_code == 422
    assert client.post(day(cycle, 9, 0) + "/muscle-groups", json={"muscle_group_id": 1}).status_code == 404


def test_removing_a_muscle_group_removes_its_exercises_only(client, ref, lib, cycle):
    m = ref["muscle"]
    add_group(client, cycle, 1, 0, m["Chest"])
    add_group(client, cycle, 1, 0, m["Triceps"])
    add_ex(client, cycle, 1, 0, m["Chest"], lib["Cable Fly"])
    add_ex(client, cycle, 1, 0, m["Triceps"], lib["Triceps Pushdown"])
    d = client.delete(day(cycle, 1, 0) + f"/muscle-groups/{m['Chest']}").json()
    assert [g["muscle_group"]["name"] for g in d["strength"]] == ["Triceps"] and d["exercise_count"] == 1
    assert client.delete(day(cycle, 1, 0) + f"/muscle-groups/{m['Chest']}").status_code == 404
    assert client.get(f"/api/v1/exercises/{lib['Cable Fly']}").status_code == 200   # library untouched


# ---- exercises ------------------------------------------------------------------------------

def test_assign_exercises_with_all_fields_and_library_details(client, ref, lib, cycle):
    gid = ref["muscle"]["Chest"]
    add_group(client, cycle, 1, 0, gid)
    d = add_ex(client, cycle, 1, 0, gid, lib["Barbell Bench Press"], target_sets=4, target_reps="6 - 8",
               target_weight_kg=82.5, rest_seconds=120, notes="Pause on chest")
    item = d["strength"][0]["exercises"][0]
    assert item["order"] == 1 and item["target_sets"] == 4 and item["target_reps"] == "6-8"
    assert item["target_weight_kg"] == 82.5 and item["rest_seconds"] == 120 and item["notes"] == "Pause on chest"
    ex = item["exercise"]                                                    # workout type / area come from the library
    assert ex["name"] == "Barbell Bench Press" and ex["workout_type"]["name"] == "Barbell"
    assert ex["target_area"]["name"] == "Middle Chest" and ex["muscle_group"]["name"] == "Chest"
    d = add_ex(client, cycle, 1, 0, gid, lib["Cable Fly"])                   # defaults
    second = d["strength"][0]["exercises"][1]
    assert second["order"] == 2 and second["target_sets"] == 3 and second["target_reps"] == "10"
    assert second["target_weight_kg"] is None and second["rest_seconds"] is None
    assert d["exercise_count"] == 2 and d["kind"] == "strength"


@pytest.mark.parametrize("field,value", [
    ("target_sets", 0), ("target_sets", 21), ("target_reps", ""), ("target_reps", "abc"), ("target_reps", "12-8"),
    ("target_reps", "0"), ("target_weight_kg", -1), ("target_weight_kg", 1001), ("rest_seconds", -5),
    ("rest_seconds", 3601), ("notes", "x" * 501),
])
def test_exercise_field_validation(client, ref, lib, cycle, field, value):
    gid = ref["muscle"]["Chest"]
    add_group(client, cycle, 1, 0, gid)
    r = client.post(day(cycle, 1, 0) + f"/muscle-groups/{gid}/exercises",
                    json={"exercise_id": lib["Cable Fly"], field: value})
    assert r.status_code == 422 and field in err_fields(r)
    assert client.get(day(cycle, 1, 0)).json()["exercise_count"] == 0


def test_exercise_reference_validation(client, ref, lib, cycle):
    gid = ref["muscle"]["Chest"]
    add_group(client, cycle, 1, 0, gid)
    url = day(cycle, 1, 0) + f"/muscle-groups/{gid}/exercises"
    r = client.post(url, json={"exercise_id": 9999})
    assert r.status_code == 422 and err_fields(r) == {"exercise_id"}
    client.patch(f"/api/v1/exercises/{lib['Cable Fly']}/status", json={"is_active": False})
    r = client.post(url, json={"exercise_id": lib["Cable Fly"]})
    assert r.status_code == 422 and "inactive" in r.text                    # honours "hidden from new plans"
    add_ex(client, cycle, 1, 0, gid, lib["Pec Deck Machine"])
    r = client.post(url, json={"exercise_id": lib["Pec Deck Machine"]})
    assert r.status_code == 409 and r.json()["error"]["code"] == "exercise_already_added"
    r = client.post(day(cycle, 1, 0) + "/muscle-groups/9/exercises", json={"exercise_id": lib["Lat Pulldown"]})
    assert r.status_code == 404 and r.json()["error"]["code"] == "muscle_group_not_in_day"


def test_an_exercise_deactivated_later_stays_in_existing_plans(client, ref, lib, cycle):
    gid = ref["muscle"]["Chest"]
    add_group(client, cycle, 1, 0, gid)
    d = add_ex(client, cycle, 1, 0, gid, lib["Cable Fly"])
    client.patch(f"/api/v1/exercises/{lib['Cable Fly']}/status", json={"is_active": False})
    item = client.get(day(cycle, 1, 0)).json()["strength"][0]["exercises"][0]
    assert item["exercise"]["is_active"] is False
    r = client.put(f"/api/v1/schedule-exercises/{item['id']}", json={"exercise_id": lib["Cable Fly"], "target_sets": 5})
    assert r.status_code == 200 and r.json()["strength"][0]["exercises"][0]["target_sets"] == 5


def test_library_exercises_in_use_cannot_be_deleted(client, ref, lib, cycle):
    gid = ref["muscle"]["Chest"]
    add_group(client, cycle, 1, 0, gid)
    add_ex(client, cycle, 1, 0, gid, lib["Cable Fly"])
    r = client.delete(f"/api/v1/exercises/{lib['Cable Fly']}")
    assert r.status_code == 409 and r.json()["error"]["code"] == "exercise_in_use"
    assert client.get(f"/api/v1/exercises/{lib['Cable Fly']}").json()["usage_count"] == 1


def test_update_planned_exercise_and_swap_library_exercise(client, ref, lib, cycle):
    gid = ref["muscle"]["Chest"]
    add_group(client, cycle, 1, 0, gid)
    d = add_ex(client, cycle, 1, 0, gid, lib["Barbell Bench Press"])
    add_ex(client, cycle, 1, 0, gid, lib["Cable Fly"])
    item_id = d["strength"][0]["exercises"][0]["id"]
    r = client.put(f"/api/v1/schedule-exercises/{item_id}", json={
        "exercise_id": lib["Flat Dumbbell Press"], "target_sets": 5, "target_reps": "AMRAP",
        "target_weight_kg": 30, "rest_seconds": 90, "notes": "Swapped"})
    assert r.status_code == 200
    first = r.json()["strength"][0]["exercises"][0]
    assert first["id"] == item_id and first["order"] == 1 and first["exercise"]["name"] == "Flat Dumbbell Press"
    assert (first["target_sets"], first["target_reps"], first["target_weight_kg"], first["notes"]) == (5, "AMRAP", 30, "Swapped")
    dup = client.put(f"/api/v1/schedule-exercises/{item_id}", json={"exercise_id": lib["Cable Fly"]})
    assert dup.status_code == 409 and dup.json()["error"]["code"] == "exercise_already_added"
    assert client.put("/api/v1/schedule-exercises/9999", json={"exercise_id": lib["Cable Fly"]}).status_code == 404
    assert client.put(f"/api/v1/schedule-exercises/{item_id}", json={"exercise_id": 9999}).status_code == 422


def test_remove_planned_exercise_renumbers_and_keeps_library(client, ref, lib, cycle, session_factory):
    d = plan_chest_day(client, ref, lib, cycle, 1, 0, ["Barbell Bench Press", "Incline Barbell Press", "Cable Fly"])
    middle = d["strength"][0]["exercises"][1]["id"]
    r = client.delete(f"/api/v1/schedule-exercises/{middle}")
    assert r.status_code == 200
    after = r.json()
    assert names(after) == ["Barbell Bench Press", "Cable Fly"] and orders(after) == [1, 2]   # no gap
    assert client.get(f"/api/v1/exercises/{lib['Incline Barbell Press']}").status_code == 200
    assert client.delete(f"/api/v1/schedule-exercises/{middle}").status_code == 404
    add = add_ex(client, cycle, 1, 0, ref["muscle"]["Chest"], lib["Pec Deck Machine"])
    assert orders(add) == [1, 2, 3]


# ---- reordering (SQLite unique constraint safety) -------------------------------------------

def reorder(client, cid, w, d, gid, ids):
    return client.put(day(cid, w, d) + f"/muscle-groups/{gid}/exercises/order", json={"schedule_exercise_ids": ids})


def test_reorder_swap_and_reverse_never_collide(client, ref, lib, cycle):
    gid = ref["muscle"]["Chest"]
    d = plan_chest_day(client, ref, lib, cycle, 1, 0,
                       ["Barbell Bench Press", "Incline Barbell Press", "Cable Fly", "Pec Deck Machine"])
    ids = [e["id"] for e in d["strength"][0]["exercises"]]
    # swap the first two: a naive UPDATE order=2 / order=1 would violate UNIQUE(group, order)
    r = reorder(client, cycle, 1, 0, gid, [ids[1], ids[0], ids[2], ids[3]])
    assert r.status_code == 200, r.text
    assert names(r.json()) == ["Incline Barbell Press", "Barbell Bench Press", "Cable Fly", "Pec Deck Machine"]
    assert orders(r.json()) == [1, 2, 3, 4]
    r = reorder(client, cycle, 1, 0, gid, ids[::-1])                          # full reversal
    assert r.status_code == 200 and orders(r.json()) == [1, 2, 3, 4]
    assert [e["id"] for e in r.json()["strength"][0]["exercises"]] == ids[::-1]
    r = reorder(client, cycle, 1, 0, gid, ids[::-1])                          # same order again: no-op, no error
    assert r.status_code == 200
    assert [e["id"] for e in client.get(day(cycle, 1, 0)).json()["strength"][0]["exercises"]] == ids[::-1]  # persisted


def test_reorder_validation(client, ref, lib, cycle):
    gid = ref["muscle"]["Chest"]
    d = plan_chest_day(client, ref, lib, cycle, 1, 0, ["Barbell Bench Press", "Cable Fly", "Pec Deck Machine"])
    a, b, c = [e["id"] for e in d["strength"][0]["exercises"]]
    for bad in ([a, b], [a, b, c, 9999], [a, a, b, c], [a, b, 9999], []):
        r = reorder(client, cycle, 1, 0, gid, bad)
        assert r.status_code == 422, bad
    assert reorder(client, cycle, 1, 0, gid, [a, b, c, c]).json()["error"]["code"] in {"order_mismatch", "validation_error"}
    assert orders(client.get(day(cycle, 1, 0)).json()) == [1, 2, 3]            # failed attempts changed nothing
    assert reorder(client, cycle, 1, 0, 9, [a]).status_code == 404


def test_reorder_only_touches_the_target_group(client, ref, lib, cycle):
    m = ref["muscle"]
    add_group(client, cycle, 1, 0, m["Chest"])
    add_group(client, cycle, 1, 0, m["Back"])
    add_ex(client, cycle, 1, 0, m["Chest"], lib["Cable Fly"])
    add_ex(client, cycle, 1, 0, m["Chest"], lib["Pec Deck Machine"])
    d = add_ex(client, cycle, 1, 0, m["Back"], lib["Lat Pulldown"])
    chest = [e["id"] for e in d["strength"][0]["exercises"]]
    r = reorder(client, cycle, 1, 0, m["Chest"], chest[::-1]).json()
    assert names(r, 0) == ["Pec Deck Machine", "Cable Fly"] and names(r, 1) == ["Lat Pulldown"]
    assert orders(r, 1) == [1]


# ---- cardio ---------------------------------------------------------------------------------

def test_cardio_only_day(client, cycle, cardio):
    r = client.post(day(cycle, 1, 5) + "/cardio", json={"cardio_activity_id": cardio["Running"], "duration_minutes": 40,
                                                      "distance_km": 5.5, "notes": "Easy pace"})
    assert r.status_code == 201
    d = r.json()
    assert d["kind"] == "cardio" and d["display_title"] == "Cardio" and d["status"] == "planned"
    assert d["strength"] == [] and d["muscle_groups"] == [] and d["exercise_count"] == 0 and d["cardio_count"] == 1
    c = d["cardio"][0]
    assert c["cardio_activity"]["name"] == "Running" and c["duration_minutes"] == 40 and c["distance_km"] == 5.5
    assert client.get(f"{CY}/{cycle}/weeks/1").json()["days"][5]["kind"] == "cardio"


def test_mixed_strength_and_cardio_day(client, ref, lib, cycle, cardio):
    plan_chest_day(client, ref, lib, cycle, 1, 2, ["Cable Fly"])
    d = client.post(day(cycle, 1, 2) + "/cardio", json={"cardio_activity_id": cardio["Treadmill"], "duration_minutes": 15}).json()
    assert d["kind"] == "mixed" and d["display_title"] == "Chest + Cardio"
    assert d["exercise_count"] == 1 and d["cardio_count"] == 1


def test_cardio_update_remove_and_validation(client, cycle, cardio):
    d = client.post(day(cycle, 1, 5) + "/cardio", json={"cardio_activity_id": cardio["Cycling"], "duration_minutes": 30}).json()
    cid = d["cardio"][0]["id"]
    r = client.put(f"/api/v1/schedule-cardio/{cid}", json={"cardio_activity_id": cardio["Rowing"], "duration_minutes": 25, "distance_km": 4})
    assert r.status_code == 200 and r.json()["cardio"][0]["cardio_activity"]["name"] == "Rowing"
    assert r.json()["cardio"][0]["duration_minutes"] == 25
    for bad in ({"duration_minutes": 0}, {"duration_minutes": 601}, {"distance_km": -1}, {"cardio_activity_id": 9999}):
        payload = {"cardio_activity_id": cardio["Cycling"], "duration_minutes": 30, **bad}
        assert client.post(day(cycle, 1, 5) + "/cardio", json=payload).status_code == 422, bad
    assert client.get(day(cycle, 1, 5)).json()["cardio_count"] == 1
    r = client.delete(f"/api/v1/schedule-cardio/{cid}")
    assert r.status_code == 200 and r.json()["cardio"] == [] and r.json()["kind"] == "empty"
    assert client.delete(f"/api/v1/schedule-cardio/{cid}").status_code == 404


def test_cardio_is_separate_from_muscle_groups(client, ref, cardio):
    assert "Cardio" not in ref["muscle"] and "Running" in cardio and len(cardio) == 11


# ---- different exercises in different weeks -------------------------------------------------

def test_same_muscle_group_with_different_exercises_each_week(client, ref, lib, cycle):
    plan = {
        1: ["Barbell Bench Press", "Incline Barbell Press", "Cable Fly"],
        2: ["Incline Dumbbell Press", "Flat Dumbbell Press", "Pec Deck Machine"],
        3: ["Smith Machine Bench Press", "Cable Crossover", "Dumbbell Fly"],
    }
    for week, ex_names in plan.items():
        plan_chest_day(client, ref, lib, cycle, week, 0, ex_names)
    for week, ex_names in plan.items():
        d = client.get(day(cycle, week, 0)).json()
        assert names(d) == ex_names, week
        assert d["strength"][0]["muscle_group"]["name"] == "Chest"
    w3 = client.get(day(cycle, 3, 0)).json()["strength"][0]["exercises"]
    assert [e["exercise"]["workout_type"]["name"] for e in w3] == ["Smith Machine", "Cable", "Dumbbell"]
    assert client.get(day(cycle, 4, 0)).json()["kind"] == "empty"            # weeks are NOT auto-filled
    assert client.get("/api/v1/exercises?page_size=100").json()["total_all"] == len(lib)   # library not duplicated


def test_editing_one_week_never_changes_another(client, ref, lib, cycle):
    plan_chest_day(client, ref, lib, cycle, 1, 0, ["Barbell Bench Press", "Cable Fly"])
    plan_chest_day(client, ref, lib, cycle, 2, 0, ["Barbell Bench Press", "Cable Fly"])
    item = client.get(day(cycle, 2, 0)).json()["strength"][0]["exercises"][0]
    client.put(f"/api/v1/schedule-exercises/{item['id']}", json={"exercise_id": item["exercise"]["id"], "target_sets": 9})
    w1 = client.get(day(cycle, 1, 0)).json()["strength"][0]["exercises"][0]
    assert w1["target_sets"] == 3


# ---- copy day -------------------------------------------------------------------------------

def rich_day(client, ref, lib, cardio, cid, w, d):
    """Two muscle groups, exercises, cardio, title and notes."""
    m = ref["muscle"]
    client.put(day(cid, w, d), json={"status": "planned", "title": "Upper", "notes": "Go heavy"})
    add_group(client, cid, w, d, m["Chest"])
    add_group(client, cid, w, d, m["Triceps"])
    add_ex(client, cid, w, d, m["Chest"], lib["Barbell Bench Press"], target_sets=4, target_reps="6-8", target_weight_kg=80, rest_seconds=120, notes="Pause")
    add_ex(client, cid, w, d, m["Chest"], lib["Cable Fly"])
    add_ex(client, cid, w, d, m["Triceps"], lib["Triceps Pushdown"], target_reps="12")
    return client.post(day(cid, w, d) + "/cardio", json={"cardio_activity_id": cardio["Treadmill"], "duration_minutes": 10}).json()


def signature(d) -> dict:
    return {
        "title": d["title"], "notes": d["notes"], "status": d["status"],
        "groups": [(g["muscle_group"]["name"], [(e["exercise"]["id"], e["order"], e["target_sets"], e["target_reps"],
                                                  e["target_weight_kg"], e["rest_seconds"], e["notes"]) for e in g["exercises"]])
                   for g in d["strength"]],
        "cardio": [(c["cardio_activity"]["id"], c["duration_minutes"], c["distance_km"], c["notes"]) for c in d["cardio"]],
    }


def test_copy_day_to_another_week_is_an_independent_deep_copy(client, ref, lib, cycle, cardio):
    src = rich_day(client, ref, lib, cardio, cycle, 1, 0)
    r = client.post(day(cycle, 1, 0) + "/copy", json={"target_week_number": 2, "target_day_of_week": 3})
    assert r.status_code == 200, r.text
    copy = r.json()
    assert copy["week_number"] == 2 and copy["day_of_week"] == 3 and copy["date"] == "2026-11-26"
    assert signature(copy) == signature(src)
    def row_ids(d):  # (table, id) so exercise-row ids and cardio-row ids can't be confused
        return ({("exercise", e["id"]) for g in d["strength"] for e in g["exercises"]}
                | {("group", g["id"]) for g in d["strength"]} | {("cardio", c["id"]) for c in d["cardio"]})
    assert row_ids(src) and row_ids(copy) and not (row_ids(src) & row_ids(copy))   # no shared rows

    # change the copy in every way: source must not move
    m = ref["muscle"]
    first = copy["strength"][0]["exercises"][0]
    client.put(f"/api/v1/schedule-exercises/{first['id']}", json={"exercise_id": first["exercise"]["id"], "target_sets": 1})
    client.delete(f"/api/v1/schedule-exercises/{copy['strength'][0]['exercises'][1]['id']}")
    client.delete(day(cycle, 2, 3) + f"/muscle-groups/{m['Triceps']}")
    client.delete(f"/api/v1/schedule-cardio/{copy['cardio'][0]['id']}")
    client.put(day(cycle, 2, 3), json={"status": "planned", "title": "Changed", "notes": None})
    assert signature(client.get(day(cycle, 1, 0)).json()) == signature(src)

    # and the other direction
    client.put(f"/api/v1/schedule-exercises/{src['strength'][0]['exercises'][0]['id']}",
               json={"exercise_id": lib["Barbell Bench Press"], "target_sets": 7})
    assert client.get(day(cycle, 2, 3)).json()["strength"][0]["exercises"][0]["target_sets"] == 1


def test_copy_day_within_the_same_week_and_rest_day(client, ref, lib, cycle, cardio):
    rich_day(client, ref, lib, cardio, cycle, 1, 0)
    assert client.post(day(cycle, 1, 0) + "/copy", json={"target_week_number": 1, "target_day_of_week": 2}).status_code == 200
    assert client.get(day(cycle, 1, 2)).json()["kind"] == "mixed"
    client.put(day(cycle, 1, 6), json={"status": "rest"})
    r = client.post(day(cycle, 1, 6) + "/copy", json={"target_week_number": 2, "target_day_of_week": 6})
    assert r.status_code == 200 and r.json()["kind"] == "rest"


def test_copy_day_protects_existing_plans(client, ref, lib, cycle, cardio):
    rich_day(client, ref, lib, cardio, cycle, 1, 0)
    plan_chest_day(client, ref, lib, cycle, 2, 0, ["Pec Deck Machine"])
    url = day(cycle, 1, 0) + "/copy"
    r = client.post(url, json={"target_week_number": 2, "target_day_of_week": 0})
    assert r.status_code == 409 and r.json()["error"]["code"] == "target_not_empty"
    assert names(client.get(day(cycle, 2, 0)).json()) == ["Pec Deck Machine"]      # untouched
    r = client.post(url, json={"target_week_number": 2, "target_day_of_week": 0, "overwrite": True})
    assert r.status_code == 200 and names(r.json()) == ["Barbell Bench Press", "Cable Fly"]
    assert len(r.json()["strength"]) == 2 and r.json()["cardio_count"] == 1       # replaced, not merged


def test_copy_day_errors(client, ref, lib, cycle, cardio):
    url = day(cycle, 1, 0) + "/copy"
    r = client.post(url, json={"target_week_number": 2, "target_day_of_week": 0})
    assert r.status_code == 422 and r.json()["error"]["code"] == "source_empty"
    rich_day(client, ref, lib, cardio, cycle, 1, 0)
    assert client.post(url, json={"target_week_number": 1, "target_day_of_week": 0}).json()["error"]["code"] == "same_day"
    assert client.post(url, json={"target_week_number": 9, "target_day_of_week": 0}).status_code == 404
    assert client.post(url, json={"target_week_number": 2, "target_day_of_week": 7}).status_code == 422
    assert client.post(url, json={"target_week_number": 0, "target_day_of_week": 1}).status_code == 422


# ---- copy week ------------------------------------------------------------------------------

def build_week1(client, ref, lib, cardio, cid):
    rich_day(client, ref, lib, cardio, cid, 1, 0)
    add_group(client, cid, 1, 1, ref["muscle"]["Back"])
    add_ex(client, cid, 1, 1, ref["muscle"]["Back"], lib["Lat Pulldown"])
    client.put(day(cid, 1, 6), json={"status": "rest"})
    client.post(day(cid, 1, 5) + "/cardio", json={"cardio_activity_id": cardio["Running"], "duration_minutes": 30})


def week_signature(client, cid, w):
    return [signature(client.get(day(cid, w, d)).json()) for d in range(7)]


def test_copy_week_to_one_and_many_weeks_independently(client, ref, lib, cycle, cardio):
    build_week1(client, ref, lib, cardio, cycle)
    r = client.post(f"{CY}/{cycle}/weeks/1/copy", json={"target_week_numbers": [2, 3]})
    assert r.status_code == 200
    assert r.json() == {"copied_days": 8, "target_week_numbers": [2, 3]}  # Mon(rich)+Tue+Fri(cardio)+Sun(rest)=4 days x 2
    assert week_signature(client, cycle, 2) == week_signature(client, cycle, 1)
    assert week_signature(client, cycle, 3) == week_signature(client, cycle, 1)
    assert client.get(day(cycle, 4, 0)).json()["kind"] == "empty"             # unselected week untouched
    assert client.get(f"{CY}/{cycle}/weeks/2").json()["days"][6]["kind"] == "rest"

    # editing week 2 changes neither week 1 nor week 3
    before1, before3 = week_signature(client, cycle, 1), week_signature(client, cycle, 3)
    d2 = client.get(day(cycle, 2, 0)).json()
    item = d2["strength"][0]["exercises"][0]
    client.put(f"/api/v1/schedule-exercises/{item['id']}", json={"exercise_id": lib["Flat Dumbbell Press"], "target_sets": 10})
    client.delete(day(cycle, 2, 1))
    assert week_signature(client, cycle, 1) == before1 and week_signature(client, cycle, 3) == before3
    w1_ids = {e["id"] for d in range(7) for g in client.get(day(cycle, 1, d)).json()["strength"] for e in g["exercises"]}
    w2_ids = {e["id"] for d in range(7) for g in client.get(day(cycle, 2, d)).json()["strength"] for e in g["exercises"]}
    assert not (w1_ids & w2_ids)


def test_copy_week_protects_existing_plans_all_or_nothing(client, ref, lib, cycle, cardio):
    build_week1(client, ref, lib, cardio, cycle)
    plan_chest_day(client, ref, lib, cycle, 3, 2, ["Pec Deck Machine"])
    before = {w: week_signature(client, cycle, w) for w in (1, 2, 3, 4)}
    r = client.post(f"{CY}/{cycle}/weeks/1/copy", json={"target_week_numbers": [2, 3, 4]})
    assert r.status_code == 409 and r.json()["error"]["code"] == "target_not_empty"
    assert "3" in r.json()["error"]["message"]
    assert {w: week_signature(client, cycle, w) for w in (1, 2, 3, 4)} == before   # week 2 and 4 NOT half-filled
    r = client.post(f"{CY}/{cycle}/weeks/1/copy", json={"target_week_numbers": [2, 3, 4], "overwrite": True})
    assert r.status_code == 200
    assert week_signature(client, cycle, 3) == week_signature(client, cycle, 1)
    assert client.get(day(cycle, 3, 2)).json()["kind"] == "empty"            # old Wednesday plan is gone, not merged


def test_copy_week_errors(client, ref, lib, cycle, cardio):
    url = f"{CY}/{cycle}/weeks/1/copy"
    assert client.post(url, json={"target_week_numbers": [2]}).json()["error"]["code"] == "source_empty"
    build_week1(client, ref, lib, cardio, cycle)
    assert client.post(url, json={"target_week_numbers": [1, 2]}).json()["error"]["code"] == "same_week"
    assert client.post(url, json={"target_week_numbers": [9]}).status_code == 404       # cycle has 4 weeks
    assert client.post(url, json={"target_week_numbers": []}).status_code == 422
    assert client.post(url, json={"target_week_numbers": [0]}).status_code == 422
    assert client.post(url, json={"target_week_numbers": [2, 2]}).json()["target_week_numbers"] == [2]  # de-duplicated


# ---- transactions ---------------------------------------------------------------------------

def test_copy_week_rolls_back_completely_when_something_fails_midway(client, ref, lib, cycle, cardio, monkeypatch):
    from app.services import planner_service
    build_week1(client, ref, lib, cardio, cycle)
    plan_chest_day(client, ref, lib, cycle, 2, 3, ["Dumbbell Fly"])
    before = {w: week_signature(client, cycle, w) for w in (1, 2, 3)}

    real, calls = planner_service._clone_exercise, {"n": 0}

    def flaky(src):
        calls["n"] += 1
        if calls["n"] == 3:
            raise RuntimeError("simulated failure while cloning")
        return real(src)
    monkeypatch.setattr(planner_service, "_clone_exercise", flaky)

    r = client.post(f"{CY}/{cycle}/weeks/1/copy", json={"target_week_numbers": [2, 3], "overwrite": True})
    assert r.status_code == 500 and r.json()["error"]["code"] == "internal_error"
    assert calls["n"] == 3
    monkeypatch.undo()
    assert {w: week_signature(client, cycle, w) for w in (1, 2, 3)} == before   # week 2's old plan survived; week 3 empty


def test_copy_day_rolls_back_and_keeps_the_target(client, ref, lib, cycle, cardio, monkeypatch):
    from app.services import planner_service
    rich_day(client, ref, lib, cardio, cycle, 1, 0)
    plan_chest_day(client, ref, lib, cycle, 2, 0, ["Pec Deck Machine"])
    monkeypatch.setattr(planner_service, "_clone_exercise", lambda src: (_ for _ in ()).throw(RuntimeError("boom")))
    r = client.post(day(cycle, 1, 0) + "/copy", json={"target_week_number": 2, "target_day_of_week": 0, "overwrite": True})
    assert r.status_code == 500
    monkeypatch.undo()
    assert names(client.get(day(cycle, 2, 0)).json()) == ["Pec Deck Machine"]


def test_put_day_rest_conversion_is_atomic(client, ref, lib, cycle, cardio, monkeypatch):
    rich_day(client, ref, lib, cardio, cycle, 1, 0)
    before = signature(client.get(day(cycle, 1, 0)).json())
    from sqlalchemy.orm import Session
    real_delete = Session.delete
    seen = {"n": 0}

    def flaky_delete(self, instance, *a, **k):
        seen["n"] += 1
        if seen["n"] == 2:
            raise RuntimeError("boom during delete")
        return real_delete(self, instance, *a, **k)
    monkeypatch.setattr(Session, "delete", flaky_delete)
    r = client.put(day(cycle, 1, 0), json={"status": "rest", "clear_workout": True})
    assert r.status_code == 500
    monkeypatch.undo()
    assert signature(client.get(day(cycle, 1, 0)).json()) == before


# ---- clear ----------------------------------------------------------------------------------

def test_clear_day_removes_everything_about_the_day(client, ref, lib, cycle, cardio, session_factory):
    rich_day(client, ref, lib, cardio, cycle, 1, 0)
    rich_day(client, ref, lib, cardio, cycle, 1, 1)
    assert client.delete(day(cycle, 1, 0)).status_code == 204
    d = client.get(day(cycle, 1, 0)).json()
    assert d["status"] == "unplanned" and d["kind"] == "empty" and d["title"] is None and d["notes"] is None
    assert d["strength"] == [] and d["cardio"] == []
    assert client.get(day(cycle, 1, 1)).json()["kind"] == "mixed"             # the other day is intact
    assert client.delete(day(cycle, 1, 0)).status_code == 204                 # idempotent
    with session_factory() as s:
        assert s.execute(text("SELECT COUNT(*) FROM daily_schedules")).scalar() == 1
        assert s.execute(text("SELECT COUNT(*) FROM schedule_muscle_groups")).scalar() == 2
        assert s.execute(text("SELECT COUNT(*) FROM schedule_exercises")).scalar() == 3
        assert s.execute(text("SELECT COUNT(*) FROM schedule_cardio")).scalar() == 1
        assert s.execute(text("SELECT COUNT(*) FROM exercises")).scalar() == len(lib)   # library untouched


def test_clear_week_only_clears_that_week(client, ref, lib, cycle, cardio, session_factory):
    build_week1(client, ref, lib, cardio, cycle)
    client.post(f"{CY}/{cycle}/weeks/1/copy", json={"target_week_numbers": [2]})
    assert client.delete(f"{CY}/{cycle}/weeks/1/days").status_code == 204
    assert all(d["kind"] == "empty" for d in client.get(f"{CY}/{cycle}/weeks/1").json()["days"])
    assert client.get(f"{CY}/{cycle}/weeks/2").json()["days"][0]["kind"] == "mixed"
    assert client.delete(f"{CY}/{cycle}/weeks/9/days").status_code == 404
    with session_factory() as s:
        assert s.execute(text("SELECT COUNT(*) FROM weekly_plans")).scalar() == 4   # weeks themselves stay


# ---- locking & integrity --------------------------------------------------------------------

def test_every_planner_write_is_blocked_once_the_cycle_is_completed(client, ref, lib, cycle, cardio):
    d = rich_day(client, ref, lib, cardio, cycle, 1, 0)
    item = d["strength"][0]["exercises"][0]
    cardio_id = d["cardio"][0]["id"]
    client.post(f"{CY}/{cycle}/activate")
    client.post(f"{CY}/{cycle}/complete")
    gid = ref["muscle"]["Chest"]
    calls = [
        client.put(day(cycle, 1, 1), json={"status": "rest"}),
        client.delete(day(cycle, 1, 0)),
        client.delete(f"{CY}/{cycle}/weeks/1/days"),
        client.post(day(cycle, 1, 1) + "/muscle-groups", json={"muscle_group_id": gid}),
        client.delete(day(cycle, 1, 0) + f"/muscle-groups/{gid}"),
        client.post(day(cycle, 1, 0) + f"/muscle-groups/{gid}/exercises", json={"exercise_id": lib["Pec Deck Machine"]}),
        client.put(f"/api/v1/schedule-exercises/{item['id']}", json={"exercise_id": item["exercise"]["id"]}),
        client.delete(f"/api/v1/schedule-exercises/{item['id']}"),
        reorder(client, cycle, 1, 0, gid, [item["id"]]),
        client.post(day(cycle, 1, 1) + "/cardio", json={"cardio_activity_id": 1, "duration_minutes": 10}),
        client.put(f"/api/v1/schedule-cardio/{cardio_id}", json={"cardio_activity_id": 1, "duration_minutes": 10}),
        client.delete(f"/api/v1/schedule-cardio/{cardio_id}"),
        client.post(day(cycle, 1, 0) + "/copy", json={"target_week_number": 2, "target_day_of_week": 0}),
        client.post(f"{CY}/{cycle}/weeks/1/copy", json={"target_week_numbers": [2]}),
    ]
    assert [r.status_code for r in calls] == [409] * len(calls)
    assert all(r.json()["error"]["code"] == "cycle_locked" for r in calls)
    assert signature(client.get(day(cycle, 1, 0)).json()) == signature(d)       # plan intact


def test_database_enforces_unique_exercise_order(session_factory, client, ref, lib, cycle):
    from sqlalchemy.exc import IntegrityError
    from app.models import ScheduleExercise
    plan_chest_day(client, ref, lib, cycle, 1, 0, ["Cable Fly"])
    with session_factory() as s:
        row = s.query(ScheduleExercise).one()
        s.add(ScheduleExercise(schedule_muscle_group_id=row.schedule_muscle_group_id, exercise_id=lib["Pec Deck Machine"],
                               exercise_order=row.exercise_order, target_sets=3, target_reps="10"))
        with pytest.raises(IntegrityError):
            s.commit()
