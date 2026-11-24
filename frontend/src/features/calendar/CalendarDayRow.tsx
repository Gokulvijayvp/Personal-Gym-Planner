import { HeartPulse, Moon } from "lucide-react";
import type { CalendarDay } from "../../types/calendar";
import { formatDateOnly } from "../../utils/date";
import { KIND_NAME } from "./calendarLogic";

interface Props { day: CalendarDay; isToday: boolean; isSelected: boolean; onOpen: (date: string) => void }

/** One day of the week view. Read-only: it only opens the day. */
export default function CalendarDayRow({ day, isToday, isSelected, onOpen }: Props) {
  const plan = day.plan;
  const kind = plan?.kind ?? "empty";
  const weekday = formatDateOnly(day.date, { weekday: "long" });
  const title = plan && plan.display_title && plan.display_title !== KIND_NAME[kind] && kind !== "empty" ? plan.display_title : null;

  return (
    <li className={`day-row kind-${kind}${isToday ? " today" : ""}${isSelected ? " selected" : ""}${day.cycle ? "" : " no-cycle"}`}
      data-testid={`week-day-${day.date}`}>
      <div className="day-date">
        <b>{weekday}</b>
        <span>{formatDateOnly(day.date, { day: "numeric", month: "short" })}</span>
        {isToday && <span className="badge badge-active">Today</span>}
      </div>
      <div className="day-main">
        {!day.cycle ? (
          <span className="kind-badge">No cycle</span>
        ) : (
          <div className="day-kind">
            <span className={`kind-badge kind-${kind}`}>
              {kind === "rest" && <Moon size={12} aria-hidden />}
              {(kind === "cardio" || kind === "mixed") && <HeartPulse size={12} aria-hidden />}
              {KIND_NAME[kind]}
            </span>
            {title && <b className="day-title">{title}</b>}
          </div>
        )}
        {plan && plan.muscle_groups.length > 0 && (
          <div className="ex-tags">{plan.muscle_groups.map((g) => <span key={g.id} className="tag tag-primary">{g.name}</span>)}</div>
        )}
        {plan && (plan.exercise_count > 0 || plan.cardio_count > 0) && (
          <p className="day-meta-line">
            {plan.exercise_count > 0 && <span>{plan.exercise_count} exercise{plan.exercise_count === 1 ? "" : "s"}</span>}
            {plan.cardio_count > 0 && <span>{plan.cardio_count} cardio</span>}
          </p>
        )}
        {day.cycle && day.week_number && <p className="day-note-line">{day.cycle.name} · week {day.week_number}</p>}
        {day.workout && (
          <span className={`logged-badge s-${day.workout.status}`} data-testid={`logged-${day.date}`}>
            {day.workout.status === "completed" ? "Workout logged" : "Workout in progress"}
          </span>
        )}
      </div>
      <button type="button" className="btn btn-outline btn-sm" onClick={() => onOpen(day.date)} aria-label={`View ${weekday} ${day.date}`}>
        View day
      </button>
    </li>
  );
}
