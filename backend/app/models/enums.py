from enum import Enum

class ScheduleStatus(str, Enum):
    planned = "planned"
    rest = "rest"
    cancelled = "cancelled"

class SessionStatus(str, Enum):
    in_progress = "in_progress"
    completed = "completed"
    cancelled = "cancelled"

class LogStatus(str, Enum):
    """Status of one exercise, set or cardio entry inside a workout session."""
    pending = "pending"
    completed = "completed"
    skipped = "skipped"

class CycleStatus(str, Enum):
    draft = "draft"
    active = "active"
    completed = "completed"
    archived = "archived"
