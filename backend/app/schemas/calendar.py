from datetime import date

from pydantic import BaseModel, Field

from app.schemas.cycle import CycleBrief
from app.schemas.planner import DayDetail
from app.schemas.workout_log import SessionRef


class CalendarDay(BaseModel):
    date: date
    day_of_week: int = Field(description="Monday=0 .. Sunday=6")
    cycle: CycleBrief | None = Field(description="The cycle that covers this date (active > completed > draft > archived)")
    week_number: int | None = Field(description="1-based week of that cycle")
    also_covered_by: list[CycleBrief] = Field(description="Other cycles whose dates also include this date")
    plan: DayDetail | None = Field(description="Planned day from the Weekly Planner; null when no cycle covers the date")
    workout: SessionRef | None = Field(default=None, description="The logged workout for this date (unfinished, else completed); null if none")


class CalendarResponse(BaseModel):
    start: date
    end: date
    timezone: str
    today: date = Field(description="Today in the application timezone (Asia/Kolkata)")
    days: list[CalendarDay] = Field(description="One entry per date in [start, end], in order")
