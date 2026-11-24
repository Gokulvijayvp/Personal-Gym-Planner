import datetime as dt
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.cycle import CycleBrief
from app.schemas.planner import DayDetail, DaySummary
from app.schemas.workout_log import RecentSession, SessionRef

CycleState = Literal["in_progress", "upcoming", "ended"]
ChecklistStatus = Literal["done", "pending", "not_applicable"]


class CycleCounts(BaseModel):
    draft: int
    active: int
    completed: int
    archived: int


class ActiveCycleCard(BaseModel):
    """An *active* cycle and where today falls in it. Never describes a draft/completed/archived cycle."""
    cycle: CycleBrief
    state: CycleState = Field(description="in_progress: today is inside it; upcoming: starts later; ended: its dates are over")
    current_week: int | None = Field(description="1-based week number; only while in_progress")
    total_days: int
    completed_days: int = Field(description="Whole days before today that belong to the cycle (0 when upcoming, all when ended)")
    progress_percent: int = Field(ge=0, le=100, description="completed_days / total_days, rounded down")
    days_until_start: int | None
    days_remaining: int | None = Field(description="Days left including today; only while in_progress")


class TodayPlan(BaseModel):
    date: dt.date
    day_of_week: int
    cycle: CycleBrief | None = Field(description="The active cycle covering today, if any")
    week_number: int | None
    plan: DayDetail | None = Field(description="Today's planned day; null when no active cycle covers today")
    covered_by_inactive: CycleBrief | None = Field(
        description="A draft/completed/archived cycle covers today but is not active (so no plan is shown)")


class WeekDay(BaseModel):
    date: dt.date
    day_of_week: int
    is_today: bool
    cycle: CycleBrief | None
    week_number: int | None
    plan: DaySummary | None


class WeekOverview(BaseModel):
    start: dt.date = Field(description="Monday")
    end: dt.date = Field(description="Sunday")
    days: list[WeekDay] = Field(description="Always 7 entries, Monday first")


class DashboardStats(BaseModel):
    """Only values that can be computed exactly from stored plans. Nothing about completed workouts."""
    exercises_total: int
    exercises_active: int
    exercise_sets: int = Field(default=0, description="Saved My exercises sets such as 'Chest A'")
    active_cycles: int
    planned_days_this_week: int = Field(description="Strength / cardio / mixed days planned this week (rest days excluded)")
    rest_days_this_week: int
    planned_exercises_this_week: int


class ChecklistItem(BaseModel):
    key: Literal["exercises", "cycle", "week_plan"]
    status: ChecklistStatus
    count: int | None = Field(default=None, description="The number the status is based on")
    reason: str | None = Field(default=None, description="Why the item is not applicable")


class SetupStatus(BaseModel):
    items: list[ChecklistItem]
    completed: int
    applicable: int
    all_done: bool


class DashboardResponse(BaseModel):
    date: dt.date = Field(description="Today in the application timezone (Asia/Kolkata)")
    timezone: str
    cycle_counts: CycleCounts
    active_cycle: ActiveCycleCard | None
    other_cycle: CycleBrief | None = Field(
        description="When there is no active cycle: the most relevant non-active one (draft, else completed, else archived)")
    today: TodayPlan
    week: WeekOverview
    stats: DashboardStats
    setup: SetupStatus
    today_workout: SessionRef | None = Field(description="Today's logged workout: the unfinished one, else the latest completed")
    in_progress_session: SessionRef | None = Field(description="Any unfinished workout (even from an earlier date), to resume")
    recent_activity: list[RecentSession] = Field(description="The latest completed workouts, newest first")
