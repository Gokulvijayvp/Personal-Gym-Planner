import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import ErrorState from "../components/ui/ErrorState";
import PageHeader from "../components/ui/PageHeader";
import CalendarDayRow from "../features/calendar/CalendarDayRow";
import CalendarToolbar from "../features/calendar/CalendarToolbar";
import DayView from "../features/calendar/DayView";
import MonthView from "../features/calendar/MonthView";
import {
  monthGrid, parseCalendarParams, rangeFor, serializeCalendarParams, shiftDate, titleFor, weekDates,
  type CalendarView,
} from "../features/calendar/calendarLogic";
import { getErrorMessage } from "../services/apiError";
import { calendarService } from "../services/calendarService";
import type { CalendarDay, CalendarResponse } from "../types/calendar";
import { todayISO } from "../utils/date";

/**
 * Read-only calendar over the Workout Cycles and Weekly Planner data.
 * State lives in the URL (?view=week&date=2026-11-19) so refresh and the back button work.
 */
export default function CalendarPage() {
  const [params, setParams] = useSearchParams();
  const today = todayISO(); // Asia/Kolkata, never the browser's zone
  const { view, date } = useMemo(() => parseCalendarParams(params, today), [params, today]);
  const range = useMemo(() => rangeFor(view, date), [view, date]);

  const go = useCallback((next: { view?: CalendarView; date?: string }) => {
    setParams(serializeCalendarParams({ view: next.view ?? view, date: next.date ?? date }, today));
  }, [setParams, view, date, today]);

  // ---- data (previous data stays visible, dimmed, while the next range loads) ---------------
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    calendarService.get(range.start, range.end, controller.signal)
      .then((res) => { setData(res); setError(null); setLoading(false); })
      .catch((e: unknown) => { if (!controller.signal.aborted) { setError(getErrorMessage(e)); setLoading(false); } });
    return () => controller.abort();
  }, [range.start, range.end, attempt]);

  const byDate = useMemo(() => new Map<string, CalendarDay>((data?.days ?? []).map((d) => [d.date, d])), [data]);
  // Only trust data that matches what is on screen (avoids flashing the wrong month while loading).
  const fresh = data !== null && data.start === range.start && data.end === range.end;
  const weeks = useMemo(() => (view === "month" ? monthGrid(date) : []), [view, date]);

  // A cycle can cover the visible dates while nothing is planned in it yet: say so, instead of looking empty.
  const unplannedCycle = useMemo(() => {
    if (!fresh || view === "day") return null;
    const inCycle = (data?.days ?? []).filter((d) => d.cycle);
    if (inCycle.length === 0 || inCycle.some((d) => d.plan && d.plan.kind !== "empty")) return null;
    const shown = new Map(inCycle.map((d) => [d.cycle!.id, d.cycle!]));
    return [...shown.values()].sort((a, b) => Number(b.status === "active") - Number(a.status === "active"))[0];
  }, [data, fresh, view]);

  return (
    <>
      <PageHeader eyebrow="SCHEDULE" title="Calendar" back={{ to: "/workout", label: "Workout" }}
        description="See what your Weekly Planner has scheduled, day by day. To change a plan, open it in the Weekly Planner." />

      <CalendarToolbar view={view} title={titleFor(view, date)} onView={(v) => go({ view: v })}
        onPrev={() => go({ date: shiftDate(view, date, -1) })} onNext={() => go({ date: shiftDate(view, date, 1) })}
        onToday={() => go({ date: today })} />

      {error && !fresh ? (
        <section className="panel page-empty">
          <ErrorState title="Couldn't load the calendar" message={error} onRetry={() => { setError(null); setAttempt((n) => n + 1); }} />
        </section>
      ) : !data ? (
        <div className="cal-skeleton" aria-busy="true" role="status" aria-label="Loading calendar">
          {Array.from({ length: view === "month" ? 5 : 3 }, (_, i) => <div key={i} className="skeleton cal-sk-row" data-testid="cal-skeleton" />)}
        </div>
      ) : (
        <div className={loading || !fresh ? "cal-body is-refreshing" : "cal-body"} aria-busy={loading || !fresh}>
          {error && <p className="form-alert" role="alert">{error}</p>}
          {unplannedCycle && (
            <p className="banner" role="note" data-testid="unplanned-cycle">
              <b>{unplannedCycle.name}</b> covers these dates, but no workouts are planned in it yet.{" "}
              <Link to={`/planner?cycle=${unplannedCycle.id}`}>Plan it in the Weekly Planner</Link>.
            </p>
          )}
          {view === "month" && (
            <>
              <MonthView weeks={weeks} anchor={date} days={byDate} today={today} selected={date} onSelect={(d) => go({ view: "day", date: d })} />
              <ul className="cal-legend" aria-label="Legend">
                <li><i className="dot dot-strength" /> Strength</li>
                <li><i className="dot dot-cardio" /> Cardio</li>
                <li><i className="dot dot-mixed" /> Strength + cardio</li>
                <li><i className="dot dot-rest" /> Rest day</li>
                <li><i className="dot dot-empty" /> In a cycle, not planned</li>
                <li><span className="legend-today" /> Today</li>
              </ul>
            </>
          )}
          {view === "week" && (
            <ol className="week-list" aria-label="Week">
              {weekDates(date).map((d) => byDate.get(d)
                ? <CalendarDayRow key={d} day={byDate.get(d)!} isToday={d === today} isSelected={d === date} onOpen={(x) => go({ view: "day", date: x })} />
                : <li key={d} className="day-row kind-empty"><div className="day-date"><b>{d}</b></div><div className="day-main"><div className="skeleton sk-line" /></div></li>)}
            </ol>
          )}
          {view === "day" && byDate.get(date) && <DayView day={byDate.get(date)!} isToday={date === today} />}
        </div>
      )}
    </>
  );
}
