import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ClipboardList, Copy, Repeat2, Trash2 } from "lucide-react";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import EmptyState from "../components/ui/EmptyState";
import ErrorState from "../components/ui/ErrorState";
import PageHeader from "../components/ui/PageHeader";
import { useToast } from "../components/ui/Toast";
import { STATUS_LABEL, formatRange } from "../features/cycles/cycleForm";
import CopyWeekDialog from "../features/planner/CopyWeekDialog";
import DayEditorModal from "../features/planner/DayEditorModal";
import DayRow from "../features/planner/DayRow";
import WeekSelector from "../features/planner/WeekSelector";
import { clampWeek, defaultCycle } from "../features/planner/plannerLogic";
import { usePlannerMasterData } from "../features/planner/usePlannerMasterData";
import { getErrorMessage } from "../services/apiError";
import { cycleService, plannerService } from "../services/plannerService";
import type { CycleDetail, CycleSummary, WeekDetail } from "../types/planner";
import { todayISO } from "../utils/date";

export default function WeeklyPlannerPage() {
  const toast = useToast();
  const master = usePlannerMasterData();
  const [params, setParams] = useSearchParams();

  // ---- cycles list and selection (kept in the URL: ?cycle=ID&week=N) -----------------------
  const [cycles, setCycles] = useState<CycleSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [listAttempt, setListAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    cycleService.list(undefined, controller.signal)
      .then((l) => { setCycles(l); setListError(null); })
      .catch((e: unknown) => { if (!controller.signal.aborted) setListError(getErrorMessage(e)); });
    return () => controller.abort();
  }, [listAttempt]);

  const requestedCycle = Number(params.get("cycle")) || null;
  const selected: CycleSummary | null = useMemo(() => {
    if (!cycles || cycles.length === 0) return null;
    return cycles.find((c) => c.id === requestedCycle) ?? defaultCycle(cycles);
  }, [cycles, requestedCycle]);
  const weekNumber = selected ? clampWeek(Number(params.get("week")) || 1, selected.total_weeks) : 1;

  const select = useCallback((patch: { cycle?: number; week?: number }, replace = false) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (patch.cycle !== undefined) { next.set("cycle", String(patch.cycle)); next.delete("week"); }
      if (patch.week !== undefined) { if (patch.week > 1) next.set("week", String(patch.week)); else next.delete("week"); }
      return next;
    }, { replace });
  }, [setParams]);

  // ---- the selected cycle's detail + week --------------------------------------------------
  const [detail, setDetail] = useState<CycleDetail | null>(null);
  const [week, setWeek] = useState<WeekDetail | null>(null);
  const [weekError, setWeekError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken((n) => n + 1), []);
  const cycleId = selected?.id ?? null;

  useEffect(() => { setWeek(null); setDetail(null); }, [cycleId]);
  useEffect(() => { setWeek(null); }, [weekNumber]);

  useEffect(() => {
    if (cycleId === null) return;
    const controller = new AbortController();
    Promise.all([plannerService.getWeek(cycleId, weekNumber, controller.signal), cycleService.get(cycleId, controller.signal)])
      .then(([w, d]) => { setWeek(w); setDetail(d); setWeekError(null); })
      .catch((e: unknown) => { if (!controller.signal.aborted) setWeekError(getErrorMessage(e)); });
    return () => controller.abort();
  }, [cycleId, weekNumber, reloadToken]);

  // ---- dialogs -----------------------------------------------------------------------------
  // `?day=N` (0 = Monday) opens that day straight away; the Calendar links here.
  const [editingDay, setEditingDay] = useState<number | null>(() => {
    const raw = params.get("day");
    return raw !== null && /^[0-6]$/.test(raw) ? Number(raw) : null;
  });
  const closeEditor = () => {
    setEditingDay(null);
    if (params.has("day")) setParams((prev) => { const next = new URLSearchParams(prev); next.delete("day"); return next; }, { replace: true });
  };
  const [copyingWeek, setCopyingWeek] = useState(false);
  const [clearingWeek, setClearingWeek] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  async function clearWeek() {
    if (!selected) return;
    setClearBusy(true);
    setClearError(null);
    try {
      await plannerService.clearWeek(selected.id, weekNumber);
      setClearingWeek(false);
      toast.success(`Week ${weekNumber} cleared.`);
      reload();
    } catch (e) {
      setClearError(getErrorMessage(e));
    } finally {
      setClearBusy(false);
    }
  }

  const editable = selected !== null && (selected.status === "draft" || selected.status === "active");
  const today = todayISO();
  const weekHasContent = Boolean(week?.days.some((d) => d.kind !== "empty" || d.title || d.notes));
  const ready = master.status === "ready";

  return (
    <>
      <PageHeader eyebrow="PLANNING" title="Weekly Planner" back={{ to: "/workout", label: "Workout" }}
        description="Plan every week of a cycle on its own: muscle groups, exercises, cardio and rest days.">
        {cycles && cycles.length > 0 && selected && (
          <div className="header-actions planner-select">
            <label className="select-field inline">
              <span>Cycle</span>
              <select value={selected.id} onChange={(e) => select({ cycle: Number(e.target.value) })} aria-label="Select cycle">
                {cycles.map((c) => <option key={c.id} value={c.id}>{c.name} ({STATUS_LABEL[c.status]})</option>)}
              </select>
            </label>
          </div>
        )}
      </PageHeader>

      {listError ? (
        <section className="panel page-empty">
          <ErrorState title="Couldn't load your cycles" message={listError} onRetry={() => { setListError(null); setListAttempt((n) => n + 1); }} />
        </section>
      ) : cycles === null ? (
        <div className="ex-grid" aria-busy="true" role="status" aria-label="Loading planner"><div className="ex-card skeleton-card"><div className="skeleton sk-title" /><div className="skeleton sk-line" /></div></div>
      ) : !selected ? (
        <section className="panel page-empty">
          <EmptyState Icon={ClipboardList} title="No cycle to plan yet"
            description="Create a workout cycle first. Its weeks are generated automatically and you plan each one here.">
            <Link className="btn" to="/cycles"><Repeat2 size={16} /> Go to Workout Cycles</Link>
          </EmptyState>
        </section>
      ) : (
        <>
          <section className="panel planner-bar" aria-label="Cycle">
            <div>
              <h2 className="planner-cycle-name">{selected.name} <span className={`badge badge-${selected.status}`}>{STATUS_LABEL[selected.status]}</span></h2>
              <p className="muted">{formatRange(selected.start_date, selected.end_date)} · {selected.total_weeks} week{selected.total_weeks === 1 ? "" : "s"}</p>
            </div>
            <Link className="btn btn-outline btn-sm" to="/cycles"><Repeat2 size={14} /> Manage cycles</Link>
          </section>

          {!editable && (
            <p className="banner" role="note" data-testid="locked-banner">
              This cycle is {selected.status}, so its plan is view-only.
            </p>
          )}

          {master.status === "error" && (
            <section className="panel page-empty">
              <ErrorState title="Couldn't load muscle groups and workout types" message={master.message} onRetry={master.reload} />
            </section>
          )}

          <WeekSelector totalWeeks={selected.total_weeks} current={weekNumber} weeks={detail?.weeks ?? []}
            onChange={(w) => select({ week: w })} />

          {weekError ? (
            <section className="panel page-empty">
              <ErrorState title="Couldn't load this week" message={weekError} onRetry={() => { setWeekError(null); reload(); }} />
            </section>
          ) : !week ? (
            <div className="ex-grid" aria-busy="true" role="status" aria-label="Loading week">
              {[0, 1, 2].map((i) => <div key={i} className="ex-card skeleton-card"><div className="skeleton sk-title" /><div className="skeleton sk-line" /></div>)}
            </div>
          ) : (
            <section aria-labelledby="week-heading">
              <div className="week-head">
                <div>
                  <h2 id="week-heading" className="section-h">Week {week.week_number}</h2>
                  <p className="muted" data-testid="week-range">{formatRange(week.start_date, week.end_date)}</p>
                </div>
                {editable && (
                  <div className="header-actions">
                    <button type="button" className="btn btn-outline btn-sm" disabled={!weekHasContent || selected.total_weeks < 2}
                      onClick={() => setCopyingWeek(true)}><Copy size={14} /> Copy week</button>
                    <button type="button" className="btn btn-outline btn-sm btn-danger-outline" disabled={!weekHasContent}
                      onClick={() => { setClearError(null); setClearingWeek(true); }}><Trash2 size={14} /> Clear week</button>
                  </div>
                )}
              </div>
              <ol className="week-list" aria-label={`Week ${week.week_number} days`}>
                {week.days.map((d) => (
                  <DayRow key={d.day_of_week} day={d} isToday={d.date === today} editable={editable}
                    onOpen={(dow) => ready ? setEditingDay(dow) : toast.error("Reference data is still loading. Try again in a moment.")} />
                ))}
              </ol>
            </section>
          )}
        </>
      )}

      {editingDay !== null && selected && master.status === "ready" && (
        <DayEditorModal
          cycleId={selected.id} weekNumber={weekNumber} dayOfWeek={editingDay} totalWeeks={selected.total_weeks}
          editable={editable} cycleStatus={selected.status} muscleGroups={master.muscleGroups} workoutTypes={master.workoutTypes}
          cardioActivities={master.cardioActivities} onClose={closeEditor} onChanged={reload}
        />
      )}

      {copyingWeek && selected && (
        <CopyWeekDialog cycleId={selected.id} weekNumber={weekNumber} totalWeeks={selected.total_weeks}
          onClose={() => setCopyingWeek(false)}
          onCopied={(r) => {
            setCopyingWeek(false);
            toast.success(`Week ${weekNumber} copied to week${r.target_week_numbers.length === 1 ? "" : "s"} ${r.target_week_numbers.join(", ")}.`);
            reload();
          }} />
      )}

      {clearingWeek && (
        <ConfirmDialog title={`Clear week ${weekNumber}?`} confirmLabel="Clear week" tone="danger" busy={clearBusy} error={clearError}
          onConfirm={clearWeek} onCancel={() => setClearingWeek(false)}>
          <p>Remove everything planned in week {weekNumber}: all seven days, including rest days, titles and notes.
            Other weeks and your exercise library are not affected.</p>
        </ConfirmDialog>
      )}
    </>
  );
}
