import { Link } from "react-router-dom";
import { CalendarClock, ChartNoAxesCombined, Dumbbell, History, Plus, Zap } from "lucide-react";
import type { DashboardStats, WeekOverview } from "../../types/dashboard";
import type { RecentSession } from "../../types/workout";
import { formatDateOnly } from "../../utils/date";
import { formatDurationShort } from "../workout/units";
import { plural } from "./homeLogic";
import type { DateFormatter } from "./prefs";

/**
 * Recent activity: the latest completed workouts, straight from the workout log. With none yet it says so
 * plainly; nothing is ever made up.
 */
export function RecentActivity({ items = [], fmt }: { items?: RecentSession[]; fmt: DateFormatter }) {
  return (
    <section className="panel home-card" aria-labelledby="home-recent" data-testid="recent-activity">
      <header className="home-card-head">
        <div><span className="eyebrow">ACTIVITY</span><h2 id="home-recent">Recent activity</h2></div>
        <span className="home-icon"><History size={18} /></span>
      </header>
      {items.length === 0 ? (
        <div className="home-empty">
          <b>No workout history yet</b>
          <p>Finish a workout and it will show up here.</p>
        </div>
      ) : (
        <>
          <ul className="recent-list" aria-label="Recently completed workouts">
            {items.map((i) => (
              <li key={i.id}>
                <Link to={`/workout/${i.id}`} className="recent-row" data-testid={`recent-${i.id}`}>
                  <b>{i.title || "Workout"}</b>
                  <span>{formatDateOnly(i.workout_date, { weekday: "short" })}, {fmt(i.workout_date)} · {formatDurationShort(i.duration_seconds)}</span>
                  <span>
                    {i.completed_exercise_count} {i.completed_exercise_count === 1 ? "exercise" : "exercises"} · {i.completed_sets} {i.completed_sets === 1 ? "set" : "sets"}
                    {i.cardio_minutes > 0 && <> · {i.cardio_minutes} min cardio</>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Link to="/workout" className="btn btn-ghost btn-sm home-action">All workouts</Link>
        </>
      )}
    </section>
  );
}

/** Planned values only: nothing here is about workouts that were actually done. */
export function StatsRow({ stats }: { stats: DashboardStats }) {
  return (
    <section className="home-stats" aria-label="Overview">
      <article className="stat" data-testid="stat-sets">
        <span>My exercise sets</span>
        <b>{stats.exercise_sets}</b>
        <small>{stats.exercise_sets === 1 ? "set" : "sets"} saved, like Chest A</small>
      </article>
      <article className="stat" data-testid="stat-cycles">
        <span>Active cycles</span>
        <b>{stats.active_cycles}</b>
        <small>{stats.active_cycles === 1 ? "cycle is" : "cycles are"} active</small>
      </article>
      <article className="stat" data-testid="stat-planned">
        <span>Planned workout days this week</span>
        <b>{stats.planned_days_this_week}</b>
        <small>planned, not completed · {plural(stats.planned_exercises_this_week, "exercise")}{stats.rest_days_this_week > 0 ? ` · ${plural(stats.rest_days_this_week, "rest day")}` : ""}</small>
      </article>
    </section>
  );
}

/** Home's shortcuts: each goes straight to the thing you probably want, inside one of the four tabs. */
const LINKS = [
  { to: "/workout", label: "Today's workout", Icon: Dumbbell },
  { to: "/workout?add=1", label: "Add an exercise", Icon: Plus },
  { to: "/workout?setup=1", label: "Quick setup", Icon: Zap },
  { to: "/progress", label: "See my progress", Icon: ChartNoAxesCombined },
] as const;

/** The next planned workout after today in this week, so a rest day still points somewhere. */
export function NextWorkout({ week, fmt }: { week: WeekOverview; fmt: DateFormatter }) {
  const next = week.days.find((d) => d.date > (week.days.find((x) => x.is_today)?.date ?? "") && d.plan
    && ["strength", "cardio", "mixed"].includes(d.plan.kind));
  if (!next || !next.plan) return null;
  return (
    <p className="home-note next-workout" data-testid="next-workout">
      <CalendarClock size={15} aria-hidden /> Next workout: <b>{formatDateOnly(next.date, { weekday: "long" })}</b> · {next.plan.display_title || "Workout"} ({fmt(next.date)}).{" "}
      <Link to="/workout">Open</Link>
    </p>
  );
}

export function QuickLinks() {
  return (
    <nav className="quick-links" aria-label="Quick links">
      {LINKS.map(({ to, label, Icon }) => (
        <Link key={to} to={to} className="quick-link"><Icon size={17} aria-hidden /> {label}</Link>
      ))}
    </nav>
  );
}
