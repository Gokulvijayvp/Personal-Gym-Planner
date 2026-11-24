import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import PageHeader from "../components/ui/PageHeader";
import { dateFormatter } from "../features/home/prefs";
import { CardioTab, ConsistencyTab, MuscleTab, RecordsTab, StrengthTab, VolumeTab } from "../features/progress/Tabs";
import CurrentPlanCard from "../features/progress/CurrentPlanCard";
import OverviewSection, { useOverview } from "../features/progress/OverviewSection";
import RangeBar from "../features/progress/RangeBar";
import { DEFAULT_PRESET, describeRange, parseRangeParams, rangeQuery, type RangeSelection } from "../features/progress/progressLogic";
import { useAsync } from "../features/progress/useAsync";
import { useSettingsPrefs } from "../features/settings/useSettingsPrefs";
import History, { HistoryRow } from "../features/workout/History";
import { workoutService } from "../services/workoutService";
import ErrorState from "../components/ui/ErrorState";

const TABS = [
  { id: "consistency", label: "Consistency" }, { id: "strength", label: "Strength" }, { id: "volume", label: "Volume" },
  { id: "records", label: "Records" }, { id: "muscles", label: "Muscle groups" }, { id: "cardio", label: "Cardio" },
  { id: "history", label: "History" },
] as const;
type TabId = (typeof TABS)[number]["id"];

/** Progress: everything is computed from completed workouts only, for the date range chosen at the top. */
export default function ProgressPage() {
  const [params, setParams] = useSearchParams();
  const { prefs } = useSettingsPrefs();
  const fmt = useMemo(() => dateFormatter(prefs), [prefs]);
  const selection = useMemo(() => parseRangeParams(params), [params]);
  const q = useMemo(() => rangeQuery(selection), [selection]);
  const tab = (TABS.find((t) => t.id === params.get("tab"))?.id ?? "consistency") as TabId;

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === "") next.delete(k); else next.set(k, v); }
    setParams(next, { replace: true });
  };
  const onRange = (s: RangeSelection) => {
    update({ range: s.preset === DEFAULT_PRESET ? null : s.preset, from: s.preset === "custom" ? s.from : null, to: s.preset === "custom" ? s.to : null });
  };

  const overview = useOverview(q);
  const recent = useAsync((s) => workoutService.list({ status: "completed", start: q?.start, end: q?.end, page: 1, page_size: 5 }, s),
    [q?.start ?? "", q?.end ?? ""], q !== null);
  const summary = overview.data ? describeRange(overview.data.range.start, overview.data.range.end, prefs.dateFormat) : "";
  const historyLink = `/progress?${new URLSearchParams({ tab: "history", ...(q?.start ? { from: q.start } : {}), ...(q?.end ? { to: q.end } : {}) })}`;

  const tabsNav = (
    <div className="prog-tabs" role="tablist" aria-label="Progress sections">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`panel-${t.id}`} tabIndex={tab === t.id ? 0 : -1}
                className={`prog-tab${tab === t.id ? " is-on" : ""}`} onClick={() => update({ tab: t.id === "consistency" ? null : t.id })}
                onKeyDown={(e) => {
                  const i = TABS.findIndex((x) => x.id === tab);
                  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                    const n = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
                    update({ tab: n.id === "consistency" ? null : n.id });
                    requestAnimationFrame(() => document.getElementById(`tab-${n.id}`)?.focus());
                  }
                }}>{t.label}</button>
            ))}
          </div>
  );

  const onHistory = tab === "history";

  return (
    <>
      <PageHeader eyebrow="ANALYTICS" title="Progress"
        description="Built only from workouts you completed. Nothing is estimated, and cancelled or unfinished workouts never count." />
      {onHistory ? (
        <>
          {tabsNav}
          <section className="prog-panel" role="tabpanel" id="panel-history" aria-labelledby="tab-history"><History fmt={fmt} keep={{ tab: "history" }} /></section>
        </>
      ) : <>
      <CurrentPlanCard />
      <RangeBar value={selection} onChange={onRange} summary={summary} />

      {q === null ? (
        <section className="panel progress-empty-panel" data-testid="range-needed">
          <p className="home-note">Choose a valid date range above to see your progress. The details are shown next to the dates.</p>
        </section>
      ) : (
        <>
          <OverviewSection state={overview} prefs={prefs} />

          <section className="panel home-card prog-recent" aria-labelledby="prog-recent" data-testid="recent-workouts">
            <header className="home-card-head">
              <div><span className="eyebrow">HISTORY</span><h2 id="prog-recent">Recent workouts in this range</h2></div>
              <Link to={historyLink} className="btn btn-outline btn-sm">View all history</Link>
            </header>
            {recent.error && !recent.data ? <ErrorState title="Couldn't load workouts" message={recent.error} onRetry={recent.reload} />
              : !recent.data ? <div className="skeleton" style={{ height: 90 }} role="status" aria-label="Loading workouts" />
                : recent.data.items.length === 0 ? <p className="home-note">No completed workouts in this range.</p>
                  : <ul className="history-list" aria-label="Recent completed workouts">{recent.data.items.map((s) => <HistoryRow key={s.id} s={s} fmt={fmt} />)}</ul>}
          </section>

          {tabsNav}
          <section className="panel prog-panel" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
            {tab === "consistency" && <ConsistencyTab q={q} prefs={prefs} />}
            {tab === "strength" && <StrengthTab q={q} prefs={prefs} exerciseKey={params.get("exercise")} onSelect={(k) => update({ exercise: k })} />}
            {tab === "volume" && <VolumeTab q={q} prefs={prefs} />}
            {tab === "records" && <RecordsTab q={q} prefs={prefs} />}
            {tab === "muscles" && <MuscleTab q={q} prefs={prefs} />}
            {tab === "cardio" && <CardioTab q={q} prefs={prefs} activity={params.get("activity")} onActivity={(a) => update({ activity: a })} />}
          </section>
        </>
      )}
      </>}
    </>
  );
}
