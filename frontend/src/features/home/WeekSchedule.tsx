import { Link } from "react-router-dom";
import { ChevronRight, HeartPulse, Moon } from "lucide-react";
import type { WeekOverview } from "../../types/dashboard";
import { formatDateOnly } from "../../utils/date";
import { KIND_NAME } from "../calendar/calendarLogic";
import { describeWeekDay, plural } from "./homeLogic";
import type { DateFormatter } from "./prefs";

interface Props { week: WeekOverview; fmt: DateFormatter }

const MAX_TAGS = 3;

/** Monday-to-Sunday overview of the active cycle's plan for this week. */
export default function WeekSchedule({ week, fmt }: Props) {
  const covered = week.days.some((d) => d.cycle);
  const anyPlanned = week.days.some((d) => d.plan && d.plan.kind !== "empty");
  return (
    <section className="panel home-card" aria-labelledby="home-week" data-testid="week-schedule">
      <header className="home-card-head">
        <div>
          <span className="eyebrow">THIS WEEK</span>
          <h2 id="home-week">{fmt(week.start)} – {fmt(week.end)}</h2>
        </div>
        <Link to={`/calendar?view=week&date=${week.days.find((d) => d.is_today)?.date ?? week.start}`} className="btn btn-ghost btn-sm">Calendar</Link>
      </header>

      {!covered ? (
        <div className="home-empty">
          <b>No active cycle this week</b>
          <p>Activate a workout cycle that covers these dates to see your week here.</p>
          <Link to="/cycles" className="btn btn-outline">Open Workout Cycles</Link>
        </div>
      ) : (
        <>
          {!anyPlanned && (
            <p className="home-note" role="note" data-testid="week-empty">Nothing is planned this week yet. Open a day to start planning it.</p>
          )}
          <ol className="week-rows" aria-label="This week, Monday to Sunday">
            {week.days.map((d) => {
              const plan = d.plan;
              const kind = plan?.kind ?? "empty";
              const names = plan?.muscle_groups.map((g) => g.name) ?? [];
              const inner = (
                <>
                  <span className="wr-day">
                    <b>{formatDateOnly(d.date, { weekday: "short" })}</b>
                    <small>{fmt(d.date)}</small>
                  </span>
                  <span className="wr-main">
                    {!d.cycle || !plan ? (
                      <span className="wr-muted">No active cycle</span>
                    ) : (
                      <>
                        <span className="wr-line">
                          <span className={`kind-badge kind-${kind}`}>
                            {kind === "rest" && <Moon size={12} aria-hidden />}
                            {(kind === "cardio" || kind === "mixed") && <HeartPulse size={12} aria-hidden />}
                            {KIND_NAME[kind]}
                          </span>
                          {d.is_today && <span className="badge badge-active">Today</span>}
                        </span>
                        {names.length > 0 && (
                          <span className="wr-tags">
                            {names.slice(0, MAX_TAGS).map((n) => <span key={n} className="tag tag-primary">{n}</span>)}
                            {names.length > MAX_TAGS && <span className="tag">+{names.length - MAX_TAGS}</span>}
                          </span>
                        )}
                        {(plan.exercise_count > 0 || plan.cardio_count > 0) && (
                          <span className="wr-meta">
                            {[plan.exercise_count > 0 ? plural(plan.exercise_count, "exercise") : null,
                              plan.cardio_count > 0 ? `${plan.cardio_count} cardio` : null].filter(Boolean).join(" · ")}
                          </span>
                        )}
                      </>
                    )}
                  </span>
                </>
              );
              const cls = `week-row kind-${kind}${d.is_today ? " today" : ""}${d.cycle ? "" : " no-cycle"}`;
              return (
                <li key={d.date} data-testid={`home-day-${d.date}`}>
                  {d.cycle && d.week_number ? (
                    <Link className={cls} to={`/workout?date=${d.date}`}
                      aria-current={d.is_today ? "date" : undefined} aria-label={`${describeWeekDay(d, fmt)}. Open in Workout`}>
                      {inner}<ChevronRight size={16} className="wr-chevron" aria-hidden />
                    </Link>
                  ) : (
                    <div className={cls} aria-current={d.is_today ? "date" : undefined}>{inner}</div>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}
