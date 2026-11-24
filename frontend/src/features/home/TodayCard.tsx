import { Link } from "react-router-dom";
import { ArrowRight, CalendarDays, HeartPulse, Moon, Play } from "lucide-react";
import type { ActiveCycleCard, TodayPlan } from "../../types/dashboard";
import type { SessionRef } from "../../types/workout";
import DayWorkoutAction from "../workout/DayWorkoutAction";
import { formatDateOnly } from "../../utils/date";
import { formatDistance, formatWeight } from "../settings/units";
import { plural } from "./homeLogic";
import type { DateFormatter, DisplayPrefs } from "./prefs";

const MAX_EXERCISES = 8;

interface Props {
  today: TodayPlan;
  activeCycle: ActiveCycleCard | null;
  prefs: DisplayPrefs;
  fmt: DateFormatter;
  /** Today's logged workout (unfinished, else completed). */
  workout?: SessionRef | null;
  /** Any unfinished workout, even from an earlier date. */
  inProgress?: SessionRef | null;
}

/** "Log a blank workout" is deliberately a link to the Workout page rather than a one-tap start. */
function BlankLink() {
  return <Link to="/workout" className="btn btn-ghost btn-sm">Log a workout anyway</Link>;
}

/** Today's plan, straight from the Weekly Planner. Read-only: there is no Start button until workout logging exists. */
export default function TodayCard({ today, activeCycle, prefs, fmt, workout = null, inProgress = null }: Props) {
  const { plan, cycle } = today;
  const weekday = formatDateOnly(today.date, { weekday: "long" });
  const link = cycle && today.week_number ? "/workout" : null;       // the Workout tab shows and edits today


  const head = (
    <header className="home-card-head">
      <div>
        <span className="eyebrow">TODAY</span>
        <h2 id="home-today">{weekday}, {fmt(today.date)}</h2>
        {cycle && <p className="home-sub">{cycle.name} · Week {today.week_number}</p>}
      </div>
      <span className="home-icon"><CalendarDays size={18} /></span>
    </header>
  );

  // No active cycle covers today.
  if (!cycle || !plan) {
    const inactive = today.covered_by_inactive;
    return (
      <section className="panel home-card" aria-labelledby="home-today" data-testid="today-card">
        {head}
        <div className="home-empty">
          <b>No workout scheduled today</b>
          <p>
            {inactive
              ? `"${inactive.name}" covers today but is ${inactive.status}, so its plan isn't shown here.`
              : activeCycle
                ? "Your active cycle doesn't cover today's date."
                : "There is no active workout cycle."}
          </p>
          <Link to={inactive || !activeCycle ? "/cycles" : "/calendar"} className="btn btn-outline">
            {inactive || !activeCycle ? "Open Workout Cycles" : "View Calendar"}
          </Link>
        </div>
      </section>
    );
  }

  if (plan.kind === "rest") {
    return (
      <section className="panel home-card" aria-labelledby="home-today" data-testid="today-card">
        {head}
        <div className="home-rest">
          <span className="kind-badge kind-rest"><Moon size={13} aria-hidden /> Rest Day</span>
          <p>Recovery is part of the plan. Nothing is scheduled for today.</p>
        </div>
        {plan.notes && <p className="day-notes-line"><b>Notes</b> {plan.notes}</p>}
        <div className="start-actions">
          {inProgress && <Link to={`/workout/${inProgress.id}`} className="btn"><Play size={14} aria-hidden /> Resume workout</Link>}
          {link && <Link to={link} className="btn btn-outline home-action">Open today's workout <ArrowRight size={15} /></Link>}
          {!inProgress && <BlankLink />}
        </div>
      </section>
    );
  }

  if (plan.kind === "empty") {
    return (
      <section className="panel home-card" aria-labelledby="home-today" data-testid="today-card">
        {head}
        <div className="home-empty">
          <b>No workout scheduled today</b>
          <p>Nothing is planned for today in {cycle.name} yet.</p>
          <div className="start-actions">
            {inProgress && <Link to={`/workout/${inProgress.id}`} className="btn"><Play size={14} aria-hidden /> Resume workout</Link>}
            {link && <Link to={link} className="btn btn-outline">Plan today</Link>}
            {!inProgress && <BlankLink />}
          </div>
        </div>
      </section>
    );
  }

  // Planned strength / cardio / both. Only the first few exercises are listed; the rest are one click away.
  let shown = 0;
  const total = plan.exercise_count;
  return (
    <section className="panel home-card" aria-labelledby="home-today" data-testid="today-card">
      {head}
      {plan.display_title && plan.display_title !== "Strength" && plan.display_title !== "Cardio" && <p className="home-title">{plan.display_title}</p>}
      {plan.strength.map((group) => {
        const rows = group.exercises.filter(() => shown++ < MAX_EXERCISES);
        if (rows.length === 0) return null;
        return (
          <div key={group.id} className="today-group">
            <h3>{group.muscle_group.name}</h3>
            <ul>
              {rows.map((e) => (
                <li key={e.id}>
                  <span className="ex-name">{e.exercise.name}</span>
                  <span className="ex-meta">
                    {e.target_sets} × {e.target_reps}
                    {e.target_weight_kg !== null && <> · {formatWeight(e.target_weight_kg, prefs.weightUnit)}</>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {total > MAX_EXERCISES && (
        <p className="home-more">+ {plural(total - MAX_EXERCISES, "more exercise")} in Workout</p>
      )}
      {plan.cardio.length > 0 && (
        <div className="today-group today-cardio">
          <h3><HeartPulse size={14} aria-hidden /> Cardio</h3>
          <ul>
            {plan.cardio.map((c) => (
              <li key={c.id}>
                <span className="ex-name">{c.cardio_activity.name}</span>
                <span className="ex-meta">
                  {c.duration_minutes} min{c.distance_km !== null && <> · {formatDistance(c.distance_km, prefs.distanceUnit)}</>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {plan.notes && <p className="day-notes-line"><b>Notes</b> {plan.notes}</p>}
      <div className="start-actions" data-testid="today-actions">
        {inProgress && (
          <Link to={`/workout/${inProgress.id}`} className="btn">
            <Play size={14} aria-hidden /> Resume workout{inProgress.workout_date !== today.date ? ` (${fmt(inProgress.workout_date)})` : ""}
          </Link>
        )}
        {cycle && today.week_number && (!inProgress || inProgress.workout_date !== today.date) && (
          <DayWorkoutAction cycleId={cycle.id} cycleStatus={cycle.status} weekNumber={today.week_number} dayOfWeek={today.day_of_week}
            date={today.date} hasWorkout workout={workout} className={inProgress ? "btn-outline" : ""} />
        )}
        {link && <Link to={link} className="btn btn-outline home-action">Open today's workout <ArrowRight size={15} /></Link>}
      </div>
    </section>
  );
}
