import { Link } from "react-router-dom";
import { CalendarOff, ClipboardList, HeartPulse, Moon } from "lucide-react";
import EmptyState from "../../components/ui/EmptyState";
import type { CalendarDay } from "../../types/calendar";
import { formatDateOnly } from "../../utils/date";
import { STATUS_LABEL, formatRange } from "../cycles/cycleForm";
import { describeAssignment } from "../planner/plannerLogic";
import DayWorkoutAction from "../workout/DayWorkoutAction";
import { KIND_NAME } from "./calendarLogic";

interface Props { day: CalendarDay; isToday: boolean }

/** The full plan of one date. Read-only: changes are made in the Weekly Planner. */
export default function DayView({ day, isToday }: Props) {
  const { cycle, plan, week_number: week } = day;
  const heading = formatDateOnly(day.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  if (!cycle || !plan) {
    return (
      <section className="panel page-empty" aria-label={heading}>
        <EmptyState Icon={CalendarOff} title="No workout cycle covers this date"
          description="This date is before, after or between your cycles. Create or schedule a cycle to plan training here.">
          <Link className="btn btn-outline" to="/cycles">Go to Workout Cycles</Link>
        </EmptyState>
      </section>
    );
  }

  const plannerLink = `/planner?cycle=${cycle.id}&week=${week}&day=${day.day_of_week}`;
  return (
    <div className="day-view" aria-label={heading}>
      <section className="panel cycle-info" aria-label="Cycle">
        <div>
          <h3 className="cycle-info-name">{cycle.name} <span className={`badge badge-${cycle.status}`}>{STATUS_LABEL[cycle.status]}</span></h3>
          <p className="muted" data-testid="cycle-week">
            Week {week} of {cycle.total_weeks} · {formatRange(cycle.start_date, cycle.end_date)}
          </p>
          {day.also_covered_by.length > 0 && (
            <p className="muted" data-testid="also-covered">
              Also covered by: {day.also_covered_by.map((c) => `${c.name} (${STATUS_LABEL[c.status]})`).join(", ")}
            </p>
          )}
        </div>
        <div className="start-actions">
          <DayWorkoutAction cycleId={cycle.id} cycleStatus={cycle.status} weekNumber={week!} dayOfWeek={day.day_of_week} date={day.date}
            hasWorkout={plan.kind === "strength" || plan.kind === "cardio" || plan.kind === "mixed"} workout={day.workout} />
          <Link className="btn btn-outline btn-sm" to={plannerLink}><ClipboardList size={14} /> Open in Weekly Planner</Link>
        </div>
      </section>

      <section className={`panel day-card kind-${plan.kind}`} aria-label="Plan">
        <header className="day-card-head">
          <span className={`kind-badge kind-${plan.kind}`}>
            {plan.kind === "rest" && <Moon size={12} aria-hidden />}
            {(plan.kind === "cardio" || plan.kind === "mixed") && <HeartPulse size={12} aria-hidden />}
            {KIND_NAME[plan.kind]}
          </span>
          {isToday && <span className="badge badge-active">Today</span>}
          {plan.title && <h3 className="day-card-title">{plan.title}</h3>}
        </header>

        {plan.kind === "rest" && <p className="rest-note" data-testid="rest-note">Rest day. No workout is planned. Recover well.</p>}
        {plan.kind === "empty" && (
          <p className="muted-note" data-testid="unplanned">
            Nothing is planned for this day yet. <Link to={plannerLink}>Plan it in the Weekly Planner</Link>.
          </p>
        )}

        {plan.notes && <div className="day-notes" data-testid="day-notes"><b>Notes</b><p>{plan.notes}</p></div>}

        {plan.strength.map((group) => (
          <article key={group.id} className="group-card" aria-label={`${group.muscle_group.name} exercises`}>
            <h4>{group.muscle_group.name} <span className="muted">({group.exercises.length})</span></h4>
            {group.notes && <p className="ex-note">{group.notes}</p>}
            {group.exercises.length === 0 ? <p className="muted-note">No exercises planned for this muscle group.</p> : (
              <ol className="ex-rows">
                {group.exercises.map((item) => (
                  <li key={item.id} className="ex-row">
                    <span className="ex-num" aria-label={`Order ${item.order}`}>{item.order}</span>
                    <div className="ex-body">
                      <b>{item.exercise.name}</b>
                      <span className="picker-tags">
                        {item.exercise.target_area && <span className="tag">{item.exercise.target_area.name}</span>}
                        {item.exercise.workout_type && <span className="tag tag-type">{item.exercise.workout_type.name}</span>}
                      </span>
                      <span className="ex-sub">{describeAssignment(item)}</span>
                      {item.notes && <span className="ex-note">{item.notes}</span>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </article>
        ))}

        {plan.cardio.length > 0 && (
          <article className="group-card" aria-label="Cardio">
            <h4>Cardio <span className="muted">({plan.cardio.length})</span></h4>
            <ul className="ex-rows">
              {plan.cardio.map((c) => (
                <li key={c.id} className="ex-row">
                  <span className="ex-num cardio" aria-hidden>♥</span>
                  <div className="ex-body">
                    <b>{c.cardio_activity.name}</b>
                    <span className="ex-sub">{c.duration_minutes} min{c.distance_km !== null ? ` · ${c.distance_km} km` : ""}</span>
                    {c.notes && <span className="ex-note">{c.notes}</span>}
                  </div>
                </li>
              ))}
            </ul>
          </article>
        )}
      </section>
    </div>
  );
}
