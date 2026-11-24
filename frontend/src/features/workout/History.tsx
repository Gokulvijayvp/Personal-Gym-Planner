import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronRight, History as HistoryIcon, Search, X } from "lucide-react";
import ErrorState from "../../components/ui/ErrorState";
import Pagination from "../../components/ui/Pagination";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { getErrorMessage } from "../../services/apiError";
import { workoutService } from "../../services/workoutService";
import type { SessionList, SessionListItem } from "../../types/workout";
import { formatDateOnly } from "../../utils/date";
import type { DateFormatter } from "../home/prefs";
import { STATUS_TEXT } from "./sessionLogic";
import { formatDurationShort } from "./units";

const PAGE_SIZE = 10;

export interface HistoryFilters { includeCancelled: boolean; start: string; end: string; exercise: string; page: number }

export function parseHistoryParams(p: URLSearchParams): HistoryFilters {
  const page = Number(p.get("page"));
  return {
    includeCancelled: p.get("cancelled") === "1", start: p.get("from") ?? "", end: p.get("to") ?? "",
    exercise: p.get("exercise") ?? "", page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

export function historyQuery(f: HistoryFilters) {
  return {
    status: f.includeCancelled ? ("finished" as const) : ("completed" as const), start: f.start || undefined, end: f.end || undefined,
    exercise: f.exercise.trim() || undefined, page: f.page, page_size: PAGE_SIZE,
  };
}

export function HistoryRow({ s, fmt }: { s: SessionListItem; fmt: DateFormatter }) {
  const label = `${formatDateOnly(s.workout_date, { weekday: "long" })} ${fmt(s.workout_date)}: ${s.title || "Blank workout"}, ${STATUS_TEXT[s.status]}`;
  return (
    <li>
      <Link to={`/workout/${s.id}`} className={`history-row s-${s.status}`} aria-label={`${label}. Open`} data-testid={`history-${s.id}`}>
        <span className="hr-date"><b>{formatDateOnly(s.workout_date, { weekday: "short" })}</b><small>{fmt(s.workout_date)}</small></span>
        <span className="hr-main">
          <span className="hr-title">
            {s.title || (s.source === "blank" ? "Blank workout" : "Workout")}
            {s.status === "cancelled" && <span className="session-badge s-cancelled">Cancelled</span>}
          </span>
          <span className="hr-meta">
            {formatDurationShort(s.duration_seconds)} · {s.completed_exercise_count} of {s.exercise_count} {s.exercise_count === 1 ? "exercise" : "exercises"} done · {s.completed_sets} {s.completed_sets === 1 ? "set" : "sets"}
            {s.cardio_minutes > 0 && <> · {s.cardio_minutes} min cardio</>}
          </span>
          {s.exercise_names.length > 0 && <span className="hr-names">{s.exercise_names.join(", ")}{s.exercise_count > s.exercise_names.length ? "…" : ""}</span>}
        </span>
        <ChevronRight size={16} className="wr-chevron" aria-hidden />
      </Link>
    </li>
  );
}

/** Finished workouts, newest first, with date-range and exercise filters kept in the URL. */
/** `keep`: URL parameters that belong to the host page (e.g. {tab: "history"}) and must survive filter changes. */
export default function History({ fmt, keep = {} }: { fmt: DateFormatter; keep?: Record<string, string> }) {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => parseHistoryParams(params), [params]);
  const [text, setText] = useState(filters.exercise);
  const debounced = useDebouncedValue(text, 300);
  const [data, setData] = useState<SessionList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const rangeInvalid = !!filters.start && !!filters.end && filters.end < filters.start;

  const patch = (next: Partial<HistoryFilters>) => {
    const f = { ...filters, page: 1, ...next };
    const p = new URLSearchParams(keep);
    if (f.includeCancelled) p.set("cancelled", "1");
    if (f.start) p.set("from", f.start);
    if (f.end) p.set("to", f.end);
    if (f.exercise.trim()) p.set("exercise", f.exercise.trim());
    if (f.page > 1) p.set("page", String(f.page));
    setParams(p, { replace: true });
  };

  useEffect(() => {
    if (debounced.trim() !== filters.exercise.trim()) patch({ exercise: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const queryKey = JSON.stringify(historyQuery(filters));
  useEffect(() => {
    if (rangeInvalid) return;
    const controller = new AbortController();
    setError(null);
    workoutService.list(historyQuery(filters), controller.signal).then(setData)
      .catch((e: unknown) => { if (!controller.signal.aborted) setError(getErrorMessage(e)); });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, attempt, rangeInvalid]);

  const filtered = !!(filters.start || filters.end || filters.exercise.trim());
  const clear = () => { setText(""); setParams(new URLSearchParams({ ...keep, ...(filters.includeCancelled ? { cancelled: "1" } : {}) }), { replace: true }); };
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <section className="panel home-card" aria-labelledby="hist-title" data-testid="history">
      <header className="home-card-head">
        <div><span className="eyebrow">HISTORY</span><h2 id="hist-title">Workout history</h2></div>
        <span className="home-icon"><HistoryIcon size={18} /></span>
      </header>

      <div className="history-filters">
        <div className="search-box">
          <Search size={16} aria-hidden />
          <input type="search" aria-label="Filter by exercise" placeholder="Filter by exercise, e.g. bench" value={text} maxLength={100} onChange={(e) => setText(e.target.value)} />
          {text && <button type="button" className="icon-btn icon-btn-plain" aria-label="Clear exercise filter" onClick={() => setText("")}><X size={15} /></button>}
        </div>
        <label className="select-field"><span>From</span>
          <input type="date" value={filters.start} max={filters.end || undefined} onChange={(e) => patch({ start: e.target.value })} />
        </label>
        <label className="select-field"><span>To</span>
          <input type="date" value={filters.end} min={filters.start || undefined} onChange={(e) => patch({ end: e.target.value })} />
        </label>
        <label className="check-field">
          <input type="checkbox" checked={filters.includeCancelled} onChange={(e) => patch({ includeCancelled: e.target.checked })} />
          <span>Include cancelled</span>
        </label>
        {filtered && <button type="button" className="btn btn-ghost btn-sm" onClick={clear}>Clear filters</button>}
      </div>
      {rangeInvalid && <p className="form-alert" role="alert">The end date must be on or after the start date.</p>}

      {error ? <ErrorState title="Couldn't load your history" message={error} onRetry={() => setAttempt((n) => n + 1)} />
        : rangeInvalid ? null
          : data === null ? <div className="skeleton" style={{ height: 160 }} role="status" aria-label="Loading history" />
            : data.items.length === 0 ? (
              <div className="home-empty" data-testid="history-empty">
                <b>{filtered ? "No workouts match these filters" : "No finished workouts yet"}</b>
                <p>{filtered ? "Try a wider date range or a different exercise." : "Completed workouts will be listed here."}</p>
                {filtered && <button type="button" className="btn btn-outline btn-sm" onClick={clear}>Clear filters</button>}
              </div>
            ) : (
              <>
                <p className="hist-count" aria-live="polite">{data.total} workout{data.total === 1 ? "" : "s"}</p>
                <ul className="history-list" aria-label="Past workouts">{data.items.map((s) => <HistoryRow key={s.id} s={s} fmt={fmt} />)}</ul>
                <Pagination page={filters.page} pages={pages} onChange={(page) => patch({ page })} />
              </>
            )}
    </section>
  );
}
