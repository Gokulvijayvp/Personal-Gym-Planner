import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { dashboardService } from "../../services/dashboardService";
import type { Dashboard } from "../../types/dashboard";
import { plural } from "../home/homeLogic";
import { useAsync } from "./useAsync";

/**
 * Where you are in the plan you are following right now. It comes from the same plan data as Home and Workout.
 * It is a bonus on this page: while loading, on failure, or with no active plan, nothing is shown.
 */
export default function CurrentPlanCard() {
  const dash = useAsync<Dashboard>((s) => dashboardService.get(s), []);
  const card = dash.data?.active_cycle;
  if (!dash.data || !card || card.state === "upcoming") return null;
  const { cycle } = card;
  const week = card.current_week;
  const today = dash.data.today.plan;
  const stats = dash.data.stats;

  return (
    <section className="panel home-card prog-plan" aria-labelledby="prog-plan" data-testid="current-plan">
      <header className="home-card-head">
        <div><span className="eyebrow">CURRENT PLAN</span><h2 id="prog-plan">{cycle.name}</h2></div>
        <span className="badge badge-active">{week !== null ? `Week ${week} of ${cycle.total_weeks}` : "Ended"}</span>
      </header>
      <div className="progress" role="progressbar" aria-label="Plan progress" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={card.progress_percent} aria-valuetext={`${card.progress_percent}% of the plan has passed`}>
        <span style={{ width: `${card.progress_percent}%` }} />
      </div>
      <p className="progress-label">
        {card.progress_percent}% of the plan has passed
        {card.days_remaining !== null && <> · {plural(card.days_remaining, "day")} left</>}
      </p>
      <p className="home-text" data-testid="plan-this-week">
        This week: {plural(stats.planned_days_this_week, "workout day")} planned, {plural(stats.planned_exercises_this_week, "exercise")}.
        {today && today.status === "planned" && <> Today: <b>{today.display_title || "Workout"}</b>.</>}
      </p>
      <Link to="/workout" className="btn btn-outline btn-sm home-action">Open Workout <ArrowRight size={15} /></Link>
    </section>
  );
}
