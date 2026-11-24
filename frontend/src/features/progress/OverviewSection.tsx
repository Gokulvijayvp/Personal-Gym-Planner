import { Link } from "react-router-dom";
import { progressService, type RangeQuery } from "../../services/progressService";
import type { DisplayPrefs } from "../home/prefs";
import Panel, { Stat } from "./Panel";
import { describeRange, formatSeconds, formatVolume } from "./progressLogic";
import { useAsync, type AsyncState } from "./useAsync";
import type { Overview } from "../../types/progress";

export function useOverview(q: RangeQuery | null): AsyncState<Overview> {
  return useAsync((s) => progressService.overview(q!, s), [q?.start ?? "", q?.end ?? ""], q !== null);
}

const DEFINITIONS: [string, string][] = [
  ["Completed workouts", "Workouts you finished. Cancelled and unfinished workouts, and planned workouts you never logged, are not counted."],
  ["Completed sets", "Sets marked done inside those workouts. Skipped and pending sets are ignored."],
  ["Training volume", "Weight × reps added up over completed sets that have an external weight and reps. Bodyweight sets add nothing. It is logged volume, not a measure of muscle growth."],
  ["Total and average duration", "Start to finish time of each completed workout. The average is total ÷ number of workouts."],
  ["Training days per week", "Distinct days with a workout ÷ weeks in the range (Monday–Sunday weeks, Asia/Kolkata dates). Shown only for ranges of at least 7 days, and the range never extends past today."],
];

export default function OverviewSection({ state, prefs }: { state: AsyncState<Overview>; prefs: DisplayPrefs }) {
  return (
    <Panel state={state} label="your overview">
      {(o) => (
        <section aria-label="Overview" data-testid="overview">
          {o.workouts === 0 && (
            <div className="home-empty progress-empty" data-testid="overview-empty">
              <b>No completed workouts in this range</b>
              <p>{o.range.all_time ? "You have not finished a workout yet. " : "Try a wider date range, or "}Progress is built only from workouts you complete.</p>
              <Link to="/workout" className="btn btn-outline btn-sm">Go to Workout</Link>
            </div>
          )}
          <div className="prog-stats prog-overview">
            <Stat label="Completed workouts" value={o.workouts} note="Finished workouts in the range" testId="ov-workouts" />
            <Stat label="Completed sets" value={o.completed_sets.toLocaleString("en-IN")} note="Sets marked done" testId="ov-sets" />
            <Stat label="Training volume" value={o.workouts ? formatVolume(o.volume_kg, prefs.weightUnit) : "—"} note="Weight × reps, completed loaded sets" testId="ov-volume" />
            <Stat label="Total duration" value={o.workouts ? formatSeconds(o.duration_seconds) : "—"} note="Start to finish, completed workouts" testId="ov-duration" />
            <Stat label="Average duration" value={o.average_duration_seconds !== null ? formatSeconds(o.average_duration_seconds) : "—"}
              note={o.average_duration_seconds !== null ? "Total ÷ workouts" : "Needs a completed workout"} testId="ov-average" />
            <Stat label="Training days per week" value={o.workouts > 0 && o.training_days_per_week !== null ? o.training_days_per_week : "—"}
              note={!o.workouts ? "Needs completed workouts" : o.training_days_per_week !== null ? `${o.training_days} training days ÷ ${(o.range.days / 7).toFixed(1)} weeks` : "Needs a range of at least 7 days"} testId="ov-tdpw" />
          </div>
          <details className="prog-defs">
            <summary>How these numbers are calculated</summary>
            <dl>{DEFINITIONS.map(([t, d]) => <div key={t}><dt>{t}</dt><dd>{d}</dd></div>)}</dl>
          </details>
          <span className="sr-only" data-testid="range-effective">{describeRange(o.range.start, o.range.end, prefs.dateFormat)}</span>
        </section>
      )}
    </Panel>
  );
}
