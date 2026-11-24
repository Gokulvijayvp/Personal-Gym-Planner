import { Link } from "react-router-dom";
import { ArrowRight, Repeat2 } from "lucide-react";
import type { ActiveCycleCard as Card, CycleCounts } from "../../types/dashboard";
import type { CycleBrief } from "../../types/planner";
import { cycleStatusLine, noActiveCycleMessage } from "./homeLogic";
import type { DateFormatter } from "./prefs";

interface Props { card: Card | null; counts: CycleCounts; other: CycleBrief | null; fmt: DateFormatter }

/** The active cycle and where today sits in it. Draft, completed and archived cycles are never shown as active. */
export default function ActiveCycleCard({ card, counts, other, fmt }: Props) {
  if (!card) {
    const m = noActiveCycleMessage(counts, other);
    return (
      <section className="panel home-card" aria-labelledby="home-cycle" data-testid="active-cycle">
        <header className="home-card-head">
          <div><span className="eyebrow">CURRENT CYCLE</span><h2 id="home-cycle">{m.title}</h2></div>
          <span className="home-icon"><Repeat2 size={18} /></span>
        </header>
        <p className="home-text">{m.text}</p>
        <Link to="/cycles" className="btn btn-outline home-action">{m.action} <ArrowRight size={15} /></Link>
      </section>
    );
  }

  const { cycle } = card;
  const inProgress = card.state === "in_progress";
  return (
    <section className="panel home-card" aria-labelledby="home-cycle" data-testid="active-cycle">
      <header className="home-card-head">
        <div><span className="eyebrow">ACTIVE CYCLE</span><h2 id="home-cycle">{cycle.name}</h2></div>
        <span className="badge badge-active">Active</span>
      </header>
      <p className="cycle-week" data-testid="cycle-week">{cycleStatusLine(card, fmt)}</p>
      <div className="progress" role="progressbar" aria-label="Cycle progress" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={card.progress_percent} aria-valuetext={`${card.progress_percent}% of the cycle has passed`}>
        <span style={{ width: `${card.progress_percent}%` }} />
      </div>
      <p className="progress-label" data-testid="cycle-progress">
        Progress: {card.progress_percent}%
        {inProgress && card.days_remaining !== null && <> · {card.days_remaining} {card.days_remaining === 1 ? "day" : "days"} left</>}
      </p>
      <dl className="cycle-dates">
        <div><dt>Starts</dt><dd>{fmt(cycle.start_date)}</dd></div>
        <div><dt>Ends</dt><dd>{fmt(cycle.end_date)}</dd></div>
        <div><dt>Length</dt><dd>{cycle.total_weeks} {cycle.total_weeks === 1 ? "week" : "weeks"}</dd></div>
      </dl>
      {card.state === "ended" && (
        <p className="home-note" role="note">This cycle's dates are over. Complete or archive it in Workout Cycles, or start a new one.</p>
      )}
      <Link to="/cycles" className="btn btn-outline home-action">View Workout Cycles <ArrowRight size={15} /></Link>
    </section>
  );
}
