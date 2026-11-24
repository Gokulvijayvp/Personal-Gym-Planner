"""The built-in exercise catalogue: common exercises of a basic gym, with their standard details.

Static data (no table): picking one copies it into the user's Exercise Library. Each entry is
(name, target area or None, equipment, icon motion). Group and area names match the seeded master data;
equipment names match the seeded workout types. Cardio is not here: cardio is logged as Cardio activities.
"""
import re
from dataclasses import dataclass

from app.core.exercise_motion import MOTIONS

_RAW: dict[str, list[tuple[str, str | None, str, str]]] = {
    "Chest": [
        ("Barbell Bench Press", "Middle Chest", "Barbell", "benchpress"),
        ("Incline Barbell Bench Press", "Upper Chest", "Barbell", "incline"),
        ("Decline Barbell Bench Press", "Lower Chest", "Barbell", "decline"),
        ("Flat Dumbbell Press", "Middle Chest", "Dumbbell", "benchpress"),
        ("Incline Dumbbell Press", "Upper Chest", "Dumbbell", "incline"),
        ("Decline Dumbbell Press", "Lower Chest", "Dumbbell", "decline"),
        ("Dumbbell Fly", "Inner Chest", "Dumbbell", "fly"),
        ("Incline Dumbbell Fly", "Upper Chest", "Dumbbell", "fly"),
        ("Cable Chest Fly", "Inner Chest", "Cable", "fly"),
        ("Cable Crossover", "Lower Chest", "Cable", "fly"),
        ("Pec Deck Fly", "Inner Chest", "Machine", "fly"),
        ("Machine Chest Press", "Middle Chest", "Machine", "press"),
        ("Smith Machine Bench Press", "Middle Chest", "Smith Machine", "benchpress"),
        ("Push-ups", "Middle Chest", "Bodyweight", "pushup"),
        ("Chest Dips", "Lower Chest", "Bodyweight", "dip"),
    ],
    "Back": [
        ("Lat Pulldown", "Lats", "Cable", "pullup"),
        ("Wide-Grip Lat Pulldown", "Lats", "Cable", "pullup"),
        ("Close-Grip Lat Pulldown", "Lats", "Cable", "pullup"),
        ("Reverse-Grip Lat Pulldown", "Lats", "Cable", "pullup"),
        ("Seated Cable Row", "Middle Back", "Cable", "row"),
        ("Close-Grip Cable Row", "Middle Back", "Cable", "row"),
        ("Wide-Grip Cable Row", "Upper Back", "Cable", "row"),
        ("Barbell Bent-Over Row", "Middle Back", "Barbell", "row"),
        ("Dumbbell Single-Arm Row", "Lats", "Dumbbell", "row"),
        ("T-Bar Row", "Middle Back", "Barbell", "row"),
        ("Machine Row", "Middle Back", "Machine", "row"),
        ("Deadlift", "Lower Back", "Barbell", "deadlift"),
        ("Dumbbell Pullover", "Lats", "Dumbbell", "raise"),
        ("Straight-Arm Pulldown", "Lats", "Cable", "pushdown"),
        ("Pull-ups", "Lats", "Bodyweight", "pullup"),
        ("Chin-ups", "Lats", "Bodyweight", "pullup"),
        ("Back Extension", "Lower Back", "Bodyweight", "deadlift"),
    ],
    "Shoulders": [
        ("Dumbbell Shoulder Press", "Front Delts", "Dumbbell", "press"),
        ("Barbell Shoulder Press", "Front Delts", "Barbell", "press"),
        ("Machine Shoulder Press", "Front Delts", "Machine", "press"),
        ("Arnold Press", "Front Delts", "Dumbbell", "press"),
        ("Dumbbell Front Raise", "Front Delts", "Dumbbell", "raise"),
        ("Dumbbell Lateral Raise", "Side Delts", "Dumbbell", "raise"),
        ("Cable Lateral Raise", "Side Delts", "Cable", "raise"),
        ("Rear Delt Dumbbell Fly", "Rear Delts", "Dumbbell", "raise"),
        ("Reverse Pec Deck", "Rear Delts", "Machine", "fly"),
        ("Face Pull", "Rear Delts", "Cable", "row"),
        ("Barbell Upright Row", "Side Delts", "Barbell", "raise"),
        ("Dumbbell Shrugs", None, "Dumbbell", "shrug"),
        ("Barbell Shrugs", None, "Barbell", "shrug"),
    ],
    "Biceps": [
        ("Standing Dumbbell Curl", "Biceps", "Dumbbell", "curl"),
        ("Alternating Dumbbell Curl", "Biceps", "Dumbbell", "curl"),
        ("Barbell Curl", "Biceps", "Barbell", "curl"),
        ("EZ-Bar Curl", "Biceps", "Barbell", "curl"),
        ("Hammer Curl", "Biceps", "Dumbbell", "curl"),
        ("Preacher Curl", "Biceps", "Barbell", "curl"),
        ("Machine Preacher Curl", "Biceps", "Machine", "curl"),
        ("Cable Biceps Curl", "Biceps", "Cable", "curl"),
        ("Concentration Curl", "Biceps", "Dumbbell", "curl"),
        ("Incline Dumbbell Curl", "Biceps", "Dumbbell", "curl"),
        ("Reverse Curl", "Biceps", "Barbell", "curl"),
        ("Spider Curl", "Biceps", "Dumbbell", "curl"),
    ],
    "Triceps": [
        ("Rope Pushdown", "Triceps", "Cable", "pushdown"),
        ("Straight Bar Pushdown", "Triceps", "Cable", "pushdown"),
        ("V-Bar Pushdown", "Triceps", "Cable", "pushdown"),
        ("Overhead Cable Extension", "Triceps", "Cable", "extension"),
        ("Dumbbell Overhead Extension", "Triceps", "Dumbbell", "extension"),
        ("Single-Arm Cable Extension", "Triceps", "Cable", "pushdown"),
        ("Skull Crushers", "Triceps", "Barbell", "extension"),
        ("Close-Grip Bench Press", "Triceps", "Barbell", "benchpress"),
        ("Dumbbell Kickback", "Triceps", "Dumbbell", "extension"),
        ("Bench Dips", "Triceps", "Bodyweight", "dip"),
    ],
    "Quadriceps": [
        ("Barbell Squat", "Quadriceps", "Barbell", "squat"),
        ("Front Squat", "Quadriceps", "Barbell", "squat"),
        ("Smith Machine Squat", "Quadriceps", "Smith Machine", "squat"),
        ("Goblet Squat", "Quadriceps", "Dumbbell", "squat"),
        ("Leg Press", "Quadriceps", "Machine", "squat"),
        ("Hack Squat", "Quadriceps", "Machine", "squat"),
        ("Leg Extension", "Quadriceps", "Machine", "legext"),
        ("Dumbbell Lunges", "Quadriceps", "Dumbbell", "lunge"),
        ("Walking Lunges", "Quadriceps", "Dumbbell", "lunge"),
        ("Reverse Lunges", "Quadriceps", "Dumbbell", "lunge"),
        ("Bulgarian Split Squat", "Quadriceps", "Dumbbell", "lunge"),
        ("Step-ups", "Quadriceps", "Dumbbell", "lunge"),
    ],
    "Hamstrings": [
        ("Lying Leg Curl", "Hamstrings", "Machine", "legcurl"),
        ("Seated Leg Curl", "Hamstrings", "Machine", "legcurl"),
        ("Standing Leg Curl", "Hamstrings", "Machine", "legcurl"),
        ("Romanian Deadlift", "Hamstrings", "Barbell", "deadlift"),
        ("Stiff-Leg Deadlift", "Hamstrings", "Barbell", "deadlift"),
        ("Good Morning", "Hamstrings", "Barbell", "deadlift"),
        ("Dumbbell Romanian Deadlift", "Hamstrings", "Dumbbell", "deadlift"),
    ],
    "Glutes": [
        ("Barbell Hip Thrust", "Glutes", "Barbell", "bridge"),
        ("Dumbbell Hip Thrust", "Glutes", "Dumbbell", "bridge"),
        ("Glute Bridge", "Glutes", "Bodyweight", "bridge"),
        ("Cable Glute Kickback", "Glutes", "Cable", "legcurl"),
        ("Hip Abduction Machine", "Glutes", "Machine", "raise"),
        ("Hip Adduction Machine", "Glutes", "Machine", "fly"),
        ("Sumo Squat", "Glutes", "Dumbbell", "squat"),
        ("Sumo Deadlift", "Glutes", "Barbell", "deadlift"),
    ],
    "Calves": [
        ("Standing Calf Raise", "Calves", "Machine", "calfraise"),
        ("Seated Calf Raise", "Calves", "Machine", "calfraise"),
        ("Leg Press Calf Raise", "Calves", "Machine", "calfraise"),
        ("Dumbbell Calf Raise", "Calves", "Dumbbell", "calfraise"),
        ("Smith Machine Calf Raise", "Calves", "Smith Machine", "calfraise"),
    ],
    "Abs / Core": [
        ("Crunches", "Upper Abs", "Bodyweight", "crunch"),
        ("Reverse Crunches", "Lower Abs", "Bodyweight", "crunch"),
        ("Sit-ups", "Upper Abs", "Bodyweight", "crunch"),
        ("Hanging Leg Raise", "Lower Abs", "Bodyweight", "legraise"),
        ("Knee Raise", "Lower Abs", "Bodyweight", "legraise"),
        ("Cable Crunch", "Upper Abs", "Cable", "crunch"),
        ("Plank", "Upper Abs", "Bodyweight", "plank"),
        ("Side Plank", "Obliques", "Bodyweight", "plank"),
        ("Russian Twist", "Obliques", "Bodyweight", "twist"),
        ("Bicycle Crunch", "Obliques", "Bodyweight", "crunch"),
        ("Mountain Climbers", "Upper Abs", "Bodyweight", "plank"),
        ("Leg Raises", "Lower Abs", "Bodyweight", "legraise"),
    ],
    "Forearms": [
        ("Wrist Curl", "Forearms", "Dumbbell", "curl"),
        ("Reverse Wrist Curl", "Forearms", "Barbell", "curl"),
        ("Barbell Wrist Curl", "Forearms", "Barbell", "curl"),
        ("Dumbbell Wrist Curl", "Forearms", "Dumbbell", "curl"),
        ("Reverse Barbell Curl", "Forearms", "Barbell", "curl"),
        ("Farmer's Walk", "Forearms", "Dumbbell", "carry"),
    ],
}


@dataclass(frozen=True)
class CatalogueEntry:
    key: str
    name: str
    muscle_group: str
    target_area: str | None
    equipment: str
    icon_motion: str
    movement: str | None = None      # free-text description; only admin-added exercises have one


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


ENTRIES: list[CatalogueEntry] = [
    CatalogueEntry(slug(n), n, group, area, equip, motion)
    for group, items in _RAW.items() for (n, area, equip, motion) in items
]
BY_KEY: dict[str, CatalogueEntry] = {e.key: e for e in ENTRIES}

# Import-time sanity: unique keys/names and valid motions (a typo here would otherwise only show at runtime).
assert len(BY_KEY) == len(ENTRIES), "duplicate catalogue key"
assert len({e.name.lower() for e in ENTRIES}) == len(ENTRIES), "duplicate catalogue name"
assert all(e.icon_motion in MOTIONS for e in ENTRIES), "unknown motion in catalogue"
