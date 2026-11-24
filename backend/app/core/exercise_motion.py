"""Icon motions for exercise masters, and a guess of the right one from an exercise's name.

The icon itself is drawn in the browser (an animated SVG figure); the database only stores which *motion*
it performs. A guess is a convenience: it can always be changed on the master.
"""
import re

# The first 12 are the original motions; the rest were added so each catalogue exercise looks like itself.
MOTIONS: dict[str, str] = {
    "press": "Press / push",
    "benchpress": "Flat bench press",
    "incline": "Incline press",
    "decline": "Decline press",
    "fly": "Fly / crossover",
    "pushup": "Push-up",
    "dip": "Dip",
    "pushdown": "Pushdown",
    "extension": "Triceps extension",
    "curl": "Curl",
    "row": "Row",
    "pullup": "Pull-up / pulldown",
    "raise": "Raise",
    "shrug": "Shrug",
    "squat": "Squat",
    "lunge": "Lunge / step",
    "legext": "Leg extension",
    "legcurl": "Leg curl",
    "deadlift": "Hinge / deadlift",
    "bridge": "Hip thrust / bridge",
    "calfraise": "Calf raise",
    "crunch": "Crunch / core",
    "legraise": "Leg raise",
    "twist": "Twist",
    "plank": "Plank / hold",
    "carry": "Carry / walk",
    "cardio": "Cardio / running",
    "generic": "Generic weight",
}
ORIGINAL_MOTIONS = ("press", "curl", "squat", "lunge", "row", "pullup", "raise", "deadlift", "crunch", "plank", "cardio", "generic")
DEFAULT_MOTION = "generic"

# Checked in order: the first match wins, so specific phrases come before general words.
_RULES: list[tuple[str, str]] = [
    ("plank", r"\bplank|\bhold\b|\bhollow"),
    ("lunge", r"\blunge|split squat|step[- ]?up|bulgarian"),
    ("pullup", r"pull[- ]?up|chin[- ]?up|pulldown|pull[- ]down|\bmuscle[- ]up"),
    ("legraise", r"leg raise|knee raise|\bhanging\b"),
    ("calfraise", r"\bcalf|\bcalves"),
    ("legext", r"leg extension|knee extension"),
    ("legcurl", r"leg curl|hamstring curl"),
    ("bridge", r"hip thrust|glute bridge|\bbridge\b"),
    ("cardio", r"treadmill|\brunning?\b|\bjog|\bwalking\b|cycling|\bbike\b|stationary|rowing machine|\browing\b|jump rope|skipping|"
               r"\bjumping\b|jumping jack|stair|elliptical|swim|\bhiit\b|burpee|mountain climber|\bsprint|\bcardio\b|\bcycle\b"),
    ("squat", r"squat|leg press|\bhack\b|\bwall sit"),
    ("deadlift", r"deadlift|\brdl\b|good morning|\bclean\b|\bsnatch|kettlebell swing|\bswing\b|hyperextension|back extension"),
    ("twist", r"\btwist|\bwood ?chop"),
    ("crunch", r"crunch|sit[- ]?up|\bv[- ]?up|ab wheel|\bab rollout"),
    ("pushup", r"push[- ]?up"),
    ("dip", r"\bdips?\b"),
    ("shrug", r"\bshrug"),
    ("fly", r"\bfly\b|\bflye?s?\b|crossover|pec deck"),
    ("incline", r"incline.*(press|bench)"),
    ("decline", r"decline.*(press|bench)"),
    ("benchpress", r"\bbench\b"),
    ("pushdown", r"\bpushdown|push down"),
    ("extension", r"\bextension|skull ?crusher|\bkickback"),
    ("curl", r"curl"),
    ("row", r"\brow\b|\brows\b|\bface pull"),
    ("carry", r"\bfarmer|\bcarry\b"),
    ("raise", r"\braise|\blateral|reverse fly|rear delt|upright row"),
    ("press", r"\bpress"),
]
_COMPILED = [(motion, re.compile(pattern, re.IGNORECASE)) for motion, pattern in _RULES]

# Used when the name alone does not say what the movement is.
_BY_GROUP = {
    "chest": "press", "back": "row", "shoulders": "raise", "biceps": "curl", "triceps": "press", "forearms": "curl",
    "abs / core": "crunch", "quadriceps": "squat", "hamstrings": "deadlift", "glutes": "deadlift", "calves": "calfraise",
}

# Old-motion stand-in for each newer one; used only when a database is downgraded to the 12-motion schema.
DOWNGRADE_MAP = {
    "benchpress": "press", "incline": "press", "decline": "press", "pushup": "press", "dip": "press",
    "pushdown": "press", "extension": "press", "fly": "raise", "shrug": "raise", "calfraise": "raise",
    "legext": "squat", "legcurl": "curl", "bridge": "deadlift", "twist": "crunch", "legraise": "crunch", "carry": "generic",
}


def guess_motion(name: str, muscle_group: str | None = None) -> str:
    """The motion that best matches an exercise name, falling back to its muscle group, then 'generic'."""
    for motion, pattern in _COMPILED:
        if pattern.search(name):
            return motion
    return _BY_GROUP.get((muscle_group or "").strip().lower(), DEFAULT_MOTION)
