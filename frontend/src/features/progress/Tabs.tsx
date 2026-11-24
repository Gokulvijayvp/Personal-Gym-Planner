import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { progressService, type RangeQuery } from "../../services/progressService";
import { formatWithPreference } from "../settings/settingsForm";
import type { DisplayPrefs } from "../home/prefs";
import { BarChart, BarList, DataTable, LineChart } from "./Charts";
import Panel, { Empty, Stat } from "./Panel";
import {
  axisDate, distanceValue, formatDistance, formatMinutes, formatSetVolume, formatVolume, formatWeight, monthLabel, weightValue,
} from "./progressLogic";
import { useAsync } from "./useAsync";

interface Props { q: RangeQuery; prefs: DisplayPrefs }
const rangeKey = (q: RangeQuery) => `${q.start ?? ""}|${q.end ?? ""}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const num = (n: number, places = 1) => Number(n.toFixed(places)).toLocaleString("en-IN");

function Toggle<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className={`seg-btn${o.value === value ? " on" : ""}`} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

// ================================ consistency ====================================================
export function ConsistencyTab({ q, prefs }: Props) {
  const state = useAsync((s) => progressService.consistency(q, s), [rangeKey(q)]);
  const [by, setBy] = useState<"weeks" | "months">("weeks");
  const f = prefs.dateFormat;
  return (
    <Panel state={state} label="your consistency">
      {(c) => {
        if (c.workouts === 0) {
          return <Empty title="No completed workouts in this range" text="Finish a workout and it will be counted here. Cancelled and unfinished workouts never are." />;
        }
        const buckets = by === "weeks" ? c.weeks : c.months;
        const label = (b: (typeof buckets)[number]) => (by === "weeks" ? axisDate(b.start, f) : monthLabel(b.label, f));
        const tip = (b: (typeof buckets)[number]) =>
          `${by === "weeks" ? `Week of ${formatWithPreference(b.start, f)}` : monthLabel(b.label, f)}: ${plural(b.workouts, "workout")} on ${plural(b.training_days, "training day")}${b.partial ? ` (partial ${by === "weeks" ? "week" : "month"})` : ""}`;
        return (
          <>
            <div className="prog-stats">
              <Stat label="Training days" value={c.training_days} note="Days with at least one completed workout. Two workouts on one day count once." testId="cons-days" />
              <Stat label="Workouts per week" value={c.average_workouts_per_week ?? "—"} note={c.average_workouts_per_week === null ? "Needs a range of at least 7 days." : "Completed workouts ÷ weeks in the range."} testId="cons-wpw" />
              <Stat label="Training days per week" value={c.average_training_days_per_week ?? "—"} note={c.average_training_days_per_week === null ? "Needs a range of at least 7 days." : "Training days ÷ weeks in the range."} testId="cons-dpw" />
            </div>
            <div className="prog-chart-head">
              <h3>Completed workouts by {by === "weeks" ? "week" : "month"}</h3>
              <Toggle value={by} onChange={setBy} label="Group by" options={[{ value: "weeks", label: "Weeks" }, { value: "months", label: "Months" }]} />
            </div>
            <BarChart ariaLabel={`Completed workouts by ${by === "weeks" ? "week" : "month"}`} axisTitle="Workouts" data={buckets.map((b) => ({ label: label(b), value: b.workouts, tooltip: tip(b), partial: b.partial }))} />
            {by === "weeks" && <p className="chart-note">Weeks run Monday to Sunday.{c.weeks_truncated ? " Only the most recent 104 weeks are shown." : ""}</p>}
            <DataTable caption={`Workouts by ${by}`} columns={[by === "weeks" ? "Week starting" : "Month", "Workouts", "Training days"]}
              rows={buckets.map((b) => [by === "weeks" ? formatWithPreference(b.start, f) : monthLabel(b.label, f), b.workouts, b.training_days])} />
            <h3 className="prog-sub">How often you trained, week by week</h3>
            {c.frequency.every((x) => x.weeks === 0)
              ? <p className="home-note">No full Monday–Sunday week falls inside this range yet.</p>
              : <BarList ariaLabel="Weeks by number of training days" items={c.frequency.map((x) => ({ label: `${x.label} training ${x.label === "1" ? "day" : "days"}`, value: x.weeks, valueLabel: plural(x.weeks, "week") }))} />}
            <p className="chart-note">Full weeks only; partial weeks at the edges of the range are left out of this count.</p>
          </>
        );
      }}
    </Panel>
  );
}

// ================================ strength ========================================================
interface StrengthProps extends Props { exerciseKey: string | null; onSelect: (key: string) => void }

export function StrengthTab({ q, prefs, exerciseKey, onSelect }: StrengthProps) {
  const options = useAsync((s) => progressService.exercises(q, s), [rangeKey(q)]);
  const list = options.data?.exercises ?? [];
  const fallback = useMemo(() => [...list].sort((a, b) => b.completed_sets - a.completed_sets || a.name.localeCompare(b.name))[0]?.key ?? null, [list]);
  const key = exerciseKey && list.some((x) => x.key === exerciseKey) ? exerciseKey : fallback;
  const detail = useAsync((s) => progressService.exercise(key!, q, s), [key, rangeKey(q)], key !== null);
  const f = prefs.dateFormat, wu = prefs.weightUnit;

  return (
    <Panel state={options} label="your exercises">
      {(opts) => opts.exercises.length === 0 ? (
        <Empty title="No completed sets in this range" text="Mark sets as done while logging a workout and the exercises you trained will appear here." />
      ) : (
        <>
          <label className="select-field prog-select">
            <span>Exercise</span>
            <select value={key ?? ""} onChange={(e) => onSelect(e.target.value)} data-testid="exercise-select">
              {opts.exercises.map((x) => <option key={x.key} value={x.key}>{x.name} ({plural(x.completed_sets, "set")})</option>)}
            </select>
          </label>
          <Panel state={detail} label="this exercise">
            {(d) => {
              const weighted = d.series.filter((p) => p.best_weight_kg !== null);
              const withReps = d.series.filter((p) => p.max_reps !== null);
              return (
                <>
                  <div className="prog-stats">
                    <Stat label="Best weight" value={d.best_weight ? formatWeight(d.best_weight.value, wu) : "—"} note={d.best_weight ? `First reached ${formatWithPreference(d.best_weight.date, f)}` : "Bodyweight sets only"} testId="ex-best-weight" />
                    <Stat label="Best reps in a set" value={d.best_reps ? d.best_reps.value : "—"} note={d.best_reps ? `First reached ${formatWithPreference(d.best_reps.date, f)}` : "No reps logged"} testId="ex-best-reps" />
                    <Stat label="Completed sets" value={d.completed_sets} note={`${plural(d.sessions, "workout")} · ${plural(d.training_days, "training day")}`} testId="ex-sets" />
                    <Stat label="Sessions per week" value={d.sessions_per_week ?? "—"} note={d.sessions_per_week === null ? "Needs a range of 7+ days" : "Workouts with this exercise ÷ weeks"} testId="ex-freq" />
                    <Stat label="Logged volume" value={formatVolume(d.total_volume_kg, wu)} note="Weight × reps of its loaded sets" testId="ex-volume" />
                  </div>
                  <div className="prog-callout" data-testid="improvement">
                    {d.improvement
                      ? <p><b>{d.improvement.change_kg >= 0 ? "+" : "−"}{formatWeight(Math.abs(d.improvement.change_kg), wu)} ({d.improvement.change_percent > 0 ? "+" : ""}{d.improvement.change_percent}%)</b> in best weight, from {formatWeight(d.improvement.from_weight_kg, wu)} on {formatWithPreference(d.improvement.from_date, f)} to {formatWeight(d.improvement.to_weight_kg, wu)} on {formatWithPreference(d.improvement.to_date, f)}.</p>
                      : <p>{d.improvement_note}</p>}
                  </div>
                  <h3 className="prog-sub">Heaviest set on each training day ({wu})</h3>
                  {weighted.length === 0
                    ? <Empty title="No external weight logged" text="Bodyweight sets, and sets that were skipped or never marked done, are not part of weight progression." />
                    : <LineChart ariaLabel={`${d.name} heaviest completed weight by date`} axisTitle={wu} format={(n) => num(n, 1)} xLabel={(x) => axisDate(x, f)}
                        points={weighted.map((p) => ({ x: p.date, y: Number(weightValue(p.best_weight_kg!, wu).toFixed(2)),
                          tooltip: `${formatWithPreference(p.date, f)}: ${formatWeight(p.best_weight_kg!, wu)}${p.reps_at_best_weight !== null ? ` × ${p.reps_at_best_weight} reps` : ""} · ${plural(p.sets, "completed set")}` }))} />}
                  <h3 className="prog-sub">Best reps in a single set</h3>
                  {withReps.length === 0
                    ? <p className="home-note">No reps were logged for completed sets of this exercise.</p>
                    : <LineChart ariaLabel={`${d.name} best reps by date`} axisTitle="Reps" integer format={(n) => num(n, 0)} xLabel={(x) => axisDate(x, f)}
                        points={withReps.map((p) => ({ x: p.date, y: p.max_reps!, tooltip: `${formatWithPreference(p.date, f)}: ${plural(p.max_reps!, "rep")} in your best set · ${plural(p.total_reps, "rep")} in total` }))} />}
                  {d.reps_at_weight.length > 0 && (
                    <>
                      <h3 className="prog-sub">Best reps at each weight</h3>
                      <div className="table-scroll">
                        <table className="prog-table" data-testid="reps-at-weight">
                          <thead><tr><th scope="col">Weight</th><th scope="col">Best reps</th><th scope="col">First reached</th></tr></thead>
                          <tbody>{d.reps_at_weight.map((r) => <tr key={r.weight_kg}><th scope="row">{formatWeight(r.weight_kg, wu)}</th><td>{r.best_reps}</td><td>{formatWithPreference(r.date, f)}</td></tr>)}</tbody>
                        </table>
                      </div>
                    </>
                  )}
                  <DataTable caption={`${d.name} by training day`} columns={["Date", "Heaviest", "Reps at heaviest", "Best reps", "Sets", "Volume"]}
                    rows={d.series.map((p) => [formatWithPreference(p.date, f), p.best_weight_kg === null ? "—" : formatWeight(p.best_weight_kg, wu), p.reps_at_best_weight ?? "—", p.max_reps ?? "—", p.sets, p.volume_kg ? formatVolume(p.volume_kg, wu) : "—"])} />
                  <p className="chart-note">Only completed sets count. A different exercise is never mixed in, even a similar one.</p>
                </>
              );
            }}
          </Panel>
        </>
      )}
    </Panel>
  );
}

// ================================ volume ===========================================================
export function VolumeTab({ q, prefs }: Props) {
  const state = useAsync((s) => progressService.volume(q, s), [rangeKey(q)]);
  const [by, setBy] = useState<"weeks" | "months">("weeks");
  const f = prefs.dateFormat, wu = prefs.weightUnit;
  return (
    <Panel state={state} label="your training volume">
      {(v) => {
        if (v.counted_sets === 0) {
          return <Empty title="No training volume in this range" text={v.excluded_sets > 0
            ? `${plural(v.excluded_sets, "completed set")} had no external weight or no reps, so there is no weight × reps to add up.`
            : "Volume is weight × reps over completed sets. Log weighted sets and they will appear here."} />;
        }
        const buckets = by === "weeks" ? v.weeks : v.months;
        return (
          <>
            <div className="prog-stats">
              <Stat label="Total volume" value={formatVolume(v.total_volume_kg, wu)} note="Σ weight × reps, completed loaded sets" testId="vol-total" />
              <Stat label="Sets counted" value={v.counted_sets} note="Completed sets with a weight and reps" testId="vol-counted" />
              <Stat label="Sets not counted" value={v.excluded_sets} note="Bodyweight sets or sets without reps: no volume is invented for them" testId="vol-excluded" />
            </div>
            <div className="prog-chart-head">
              <h3>Volume by {by === "weeks" ? "week" : "month"} ({wu})</h3>
              <Toggle value={by} onChange={setBy} label="Group by" options={[{ value: "weeks", label: "Weeks" }, { value: "months", label: "Months" }]} />
            </div>
            <BarChart ariaLabel={`Training volume by ${by === "weeks" ? "week" : "month"}`} axisTitle={wu} format={(n) => num(n, 0)}
              data={buckets.map((b) => ({ label: by === "weeks" ? axisDate(b.start, f) : monthLabel(b.label, f), value: Number(weightValue(b.volume_kg, wu).toFixed(1)), partial: b.partial,
                tooltip: `${by === "weeks" ? `Week of ${formatWithPreference(b.start, f)}` : monthLabel(b.label, f)}: ${formatVolume(b.volume_kg, wu)}${b.partial ? ` (partial ${by === "weeks" ? "week" : "month"})` : ""}` }))} />
            <DataTable caption={`Volume by ${by}`} columns={[by === "weeks" ? "Week starting" : "Month", `Volume (${wu})`]} rows={buckets.map((b) => [by === "weeks" ? formatWithPreference(b.start, f) : monthLabel(b.label, f), formatVolume(b.volume_kg, wu)])} />
            <h3 className="prog-sub">By exercise</h3>
            <BarList ariaLabel="Volume by exercise" items={v.by_exercise.slice(0, 10).map((x) => ({ label: x.name, value: x.volume_kg, valueLabel: formatVolume(x.volume_kg, wu), sub: plural(x.completed_sets, "set") }))} />
            {v.by_exercise.length > 10 && <p className="chart-note">Showing the top 10 of {v.by_exercise.length} exercises.</p>}
            <h3 className="prog-sub">By muscle group</h3>
            {v.by_muscle_group.length === 0 && v.unassigned_kg === 0 ? <p className="home-note">No muscle-group attribution is available.</p> : (
              <BarList ariaLabel="Volume by muscle group" items={[
                ...v.by_muscle_group.map((x) => ({ label: x.name, value: x.volume_kg, valueLabel: formatVolume(x.volume_kg, wu), sub: plural(x.completed_sets, "set") })),
                ...(v.unassigned_kg > 0 ? [{ label: "Unassigned", value: v.unassigned_kg, valueLabel: formatVolume(v.unassigned_kg, wu), sub: "Logged without a muscle group, so not guessed", muted: true }] : []),
              ]} />
            )}
            <p className="chart-note">This is logged training volume (weight × reps). It is not a measurement of muscle growth, and cardio is never included.</p>
          </>
        );
      }}
    </Panel>
  );
}

// ================================ records ===========================================================
export function RecordsTab({ q, prefs }: Props) {
  const state = useAsync((s) => progressService.records(q, s), [rangeKey(q)]);
  const [search, setSearch] = useState("");
  const f = prefs.dateFormat, wu = prefs.weightUnit;
  const date = (d: string) => formatWithPreference(d, f);
  return (
    <Panel state={state} label="your personal records">
      {(r) => {
        if (r.records.length === 0) return <Empty title="No personal records yet" text="Records come from completed sets in finished workouts. Finish a workout with weights and your bests will be listed here." />;
        const shown = r.records.filter((x) => x.name.toLowerCase().includes(search.trim().toLowerCase()));
        return (
          <>
            <p className="home-text" data-testid="pr-summary">
              {r.new_in_range > 0 ? `${plural(r.new_in_range, "record")} first reached in this range.` : "No new records in this range."} Records cover all your completed workouts up to the end of the range.
            </p>
            <div className="search-box prog-search">
              <input type="search" aria-label="Filter records by exercise" placeholder="Filter by exercise" value={search} maxLength={100} onChange={(e) => setSearch(e.target.value)} />
            </div>
            {shown.length === 0 ? <p className="home-note">No exercise matches “{search}”.</p> : (
              <ul className="pr-list" aria-label="Personal records by exercise">
                {shown.map((x) => (
                  <li key={x.key} className="panel pr-card" data-testid={`pr-${x.key}`}>
                    <h3>{x.name}</h3>
                    <dl className="pr-grid">
                      {x.max_weight && (
                        <div><dt>Heaviest weight</dt>
                          <dd><b>{formatWeight(x.max_weight.weight_kg, wu)}{x.max_weight.reps !== null ? ` × ${x.max_weight.reps}` : ""}</b>
                            <small>{date(x.max_weight.date)}{x.max_weight.in_range && <span className="pr-new">New in range</span>} · <Link to={`/workout/${x.max_weight.session_id}`}>Open workout</Link></small></dd></div>
                      )}
                      {x.max_set_volume && (
                        <div><dt>Highest set volume</dt>
                          <dd><b>{formatSetVolume(x.max_set_volume.volume_kg ?? 0, wu)}</b>
                            <small>{formatWeight(x.max_set_volume.weight_kg, wu)} × {x.max_set_volume.reps} · {date(x.max_set_volume.date)}{x.max_set_volume.in_range && <span className="pr-new">New in range</span>} · <Link to={`/workout/${x.max_set_volume.session_id}`}>Open workout</Link></small></dd></div>
                      )}
                      {x.max_bodyweight_reps && (
                        <div><dt>Most bodyweight reps</dt>
                          <dd><b>{x.max_bodyweight_reps.reps} reps</b>
                            <small>{date(x.max_bodyweight_reps.date)}{x.max_bodyweight_reps.in_range && <span className="pr-new">New in range</span>} · <Link to={`/workout/${x.max_bodyweight_reps.session_id}`}>Open workout</Link></small></dd></div>
                      )}
                    </dl>
                    {x.reps_at_weight.length > 0 && (
                      <>
                        <h4>Best reps at a weight</h4>
                        <ul className="pr-reps">{x.reps_at_weight.map((w) => <li key={w.weight_kg}><b>{formatWeight(w.weight_kg, wu)}</b> × {w.reps} <small>{date(w.date)}</small></li>)}</ul>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="chart-note">Only completed sets in completed workouts count. If two sets tie, the earliest date is the record. Bodyweight sets are kept out of weight records.</p>
          </>
        );
      }}
    </Panel>
  );
}

// ================================ muscle groups ======================================================
export function MuscleTab({ q }: Props) {
  const state = useAsync((s) => progressService.muscleGroups(q, s), [rangeKey(q)]);
  return (
    <Panel state={state} label="your muscle-group split">
      {(m) => m.total_sets === 0 ? (
        <Empty title="No completed sets in this range" text="The split is counted from completed sets, grouped by each exercise's primary muscle group." />
      ) : (
        <>
          <p className="home-text">{plural(m.total_sets, "completed set")} in this range, grouped by primary muscle group.</p>
          <BarList ariaLabel="Completed sets by muscle group" items={m.groups.map((g) => ({
            label: g.name, value: g.completed_sets, valueLabel: `${g.completed_sets} · ${num(g.percent_of_sets)}%`,
            sub: `${plural(g.sessions, "workout")} · ${plural(g.exercises, "exercise")}${g.sessions_per_week !== null ? ` · ${num(g.sessions_per_week, 2)}/week` : ""}`, muted: g.name === "Unassigned" }))} />
          <DataTable caption="Completed sets by muscle group" columns={["Muscle group", "Sets", "Share of sets", "Workouts", "Exercises"]}
            rows={m.groups.map((g) => [g.name, g.completed_sets, `${num(g.percent_of_sets)}%`, g.sessions, g.exercises])} />
          <p className="chart-note">Each set counts once, under the primary muscle group stored with it; secondary muscles are not added. Exercises logged without a group appear as Unassigned instead of being guessed.</p>
        </>
      )}
    </Panel>
  );
}

// ================================ cardio =============================================================
interface CardioProps extends Props { activity: string | null; onActivity: (name: string) => void }

export function CardioTab({ q, prefs, activity, onActivity }: CardioProps) {
  const [auto, setAuto] = useState<string | null>(null);
  const chosen = activity ?? auto;
  const state = useAsync((s) => progressService.cardio(q, chosen ?? undefined, s), [rangeKey(q), chosen]);
  const first = state.data;
  useEffect(() => {          // pick something sensible to chart once the activities are known
    if (!activity && !auto && first && first.activities.length > 0) {
      const withDistance = first.activities.filter((a) => a.entries_with_distance > 0).sort((a, b) => b.entries_with_distance - a.entries_with_distance)[0];
      if (withDistance) setAuto(withDistance.name);
    }
  }, [activity, auto, first]);
  const f = prefs.dateFormat, du = prefs.distanceUnit;
  return (
    <Panel state={state} label="your cardio">
      {(c) => c.entries === 0 ? (
        <Empty title="No completed cardio in this range" text="Cardio counts when an entry is marked done. Skipped and unfinished entries are ignored." />
      ) : (
        <>
          <div className="prog-stats">
            <Stat label="Cardio time" value={formatMinutes(c.total_minutes)} note="Minutes of completed cardio entries" testId="cardio-minutes" />
            <Stat label="Distance" value={c.entries_with_distance > 0 ? formatDistance(c.total_distance_km, du) : "—"} note={c.entries_with_distance > 0 ? `${plural(c.entries_with_distance, "entry", "entries")} with a distance` : "No distance logged"} testId="cardio-distance" />
            <Stat label="Cardio entries" value={c.entries} note={`In ${plural(c.sessions, "workout")}`} testId="cardio-entries" />
            {c.calories_entries > 0 && <Stat label="Calories you logged" value={c.calories_logged.toLocaleString("en-IN")} note={`From ${plural(c.calories_entries, "entry", "entries")} where you typed them; never estimated`} testId="cardio-calories" />}
          </div>
          <h3 className="prog-sub">By activity</h3>
          <div className="table-scroll">
            <table className="prog-table" data-testid="cardio-activities">
              <thead><tr><th scope="col">Activity</th><th scope="col">Entries</th><th scope="col">Time</th><th scope="col">Distance</th><th scope="col">Last</th></tr></thead>
              <tbody>{c.activities.map((a) => (
                <tr key={a.name}><th scope="row">{a.name}</th><td>{a.entries}</td><td>{formatMinutes(a.minutes)}</td>
                  <td>{a.entries_with_distance > 0 ? formatDistance(a.distance_km, du) : "—"}</td><td>{formatWithPreference(a.last_date, f)}</td></tr>
              ))}</tbody>
            </table>
          </div>
          {c.activities.some((a) => a.entries_with_distance > 0) ? (
            <>
              <label className="select-field prog-select">
                <span>Distance over time for</span>
                <select value={c.activity ?? ""} onChange={(e) => onActivity(e.target.value)} data-testid="cardio-select">
                  {c.activities.filter((a) => a.entries_with_distance > 0).map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
                </select>
              </label>
              {c.series.length < 2
                ? <p className="home-note" data-testid="cardio-few">{c.series.length === 0 ? "No distance logged for this activity yet." : "Only one day with a distance so far, so there is no trend to draw."}</p>
                : <LineChart ariaLabel={`${c.activity} distance by date`} axisTitle={du} format={(n) => num(n, 2)} xLabel={(x) => axisDate(x, f)}
                    points={c.series.map((p) => ({ x: p.date, y: Number(distanceValue(p.distance_km, du).toFixed(2)), tooltip: `${formatWithPreference(p.date, f)}: ${formatDistance(p.distance_km, du)}${p.minutes ? ` in ${formatMinutes(p.minutes)}` : ""}` }))} />}
            </>
          ) : null}
          <p className="chart-note">Different activities are not compared with each other: a kilometre of cycling and a kilometre of walking are not the same effort. Time is in minutes; distances use your Settings unit.</p>
        </>
      )}
    </Panel>
  );
}
