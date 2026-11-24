import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarClock, CalendarDays, ClipboardPaste, Layers, LayoutGrid, Play, Share2, Zap } from "lucide-react";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import { useToast } from "../../components/ui/Toast";
import { getErrorMessage } from "../../services/apiError";
import { exerciseMasterService } from "../../services/exerciseMasterService";
import { cycleService, plannerService } from "../../services/plannerService";
import type { Dashboard } from "../../types/dashboard";
import type { DayDetail, DaySummary, ScheduledExercise, ScheduledMuscleGroup } from "../../types/planner";
import { formatDateOnly } from "../../utils/date";
import type { DateFormatter, DisplayPrefs } from "../home/prefs";
import { useStartWorkout } from "../workout/useStartWorkout";
import { DAY_NAMES } from "../planner/plannerLogic";
import * as ops from "./dayOps";
import type { DayRef } from "./dayOps";
import DayPanel, { type TargetEdit } from "./DayPanel";
import DayPickerDialog, { type PickerMode } from "./DayPickerDialog";
import PlanImportDialog from "./PlanImportDialog";
import PlanShareDialog from "./PlanShareDialog";
import QuickAddDialog, { type PickedExercise } from "./QuickAddDialog";
import QuickPlanDialog from "./QuickPlanDialog";
import QuickSetupDialog from "./QuickSetupDialog";
import WeekStrip from "./WeekStrip";

interface Props {
  dash: Dashboard;
  prefs: DisplayPrefs;
  fmt: DateFormatter;
  /** Reload the dashboard so the week strip (and Home) show the change. */
  onRefresh: () => Promise<void>;
}

type Dialog =
  | null
  | { kind: "add" }
  | { kind: "replace"; group: ScheduledMuscleGroup; item: ScheduledExercise }
  | { kind: "pick"; mode: PickerMode }
  | { kind: "plan" }
  | { kind: "setup" }
  | { kind: "share" }
  | { kind: "paste" }
  | { kind: "needplan" };

interface Snapshot { ref: DayRef; snap: DayDetail }

/** The Workout tab's body: pick a day of this week (today first), then change it with one-tap actions and Undo. */
export default function PlanBoard({ dash, prefs, fmt, onRefresh }: Props) {
  const toast = useToast();
  const { start, starting } = useStartWorkout();
  const [params, setParams] = useSearchParams();
  // "?date=YYYY-MM-DD" (Home's week rows) opens that day of this week instead of today
  const wanted = params.get("date");
  const [selected, setSelected] = useState(wanted && dash.week.days.some((d) => d.date === wanted) ? wanted : dash.date);
  const [detail, setDetail] = useState<DayDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [activating, setActivating] = useState(false);
  const [icons, setIcons] = useState<Record<string, string>>({});
  const working = useRef(false);

  const weekDay = dash.week.days.find((d) => d.date === selected) ?? dash.week.days[0];
  const isToday = weekDay.date === dash.date;
  const planCycle = weekDay.cycle ?? dash.active_cycle?.cycle ?? null;
  const planWeek = weekDay.cycle ? weekDay.week_number : dash.active_cycle?.current_week ?? null;
  const ref: DayRef | null = weekDay.cycle && weekDay.week_number != null
    ? { cycleId: weekDay.cycle.id, week: weekDay.week_number, day: weekDay.day_of_week } : null;
  const refKey = ref ? `${ref.cycleId}/${ref.week}/${ref.day}` : "none";

  // names -> icon motions, so each row shows its own animation
  useEffect(() => {
    const c = new AbortController();
    exerciseMasterService.list(c.signal).then((r) => {
      const map: Record<string, string> = {};
      for (const m of r.items) map[m.name.toLowerCase()] = m.icon_motion;
      setIcons(map);
    }).catch(() => undefined);
    return () => c.abort();
  }, []);

  // the selected day's full detail (kept on screen while it refreshes)
  useEffect(() => {
    if (!ref) { setDetail(null); setLoading(false); return; }
    const c = new AbortController();
    setLoading(true);
    plannerService.getDay(ref.cycleId, ref.week, ref.day, c.signal)
      .then((d) => { setDetail(d); setLoading(false); })
      .catch((e: unknown) => { if (!c.signal.aborted) { setLoading(false); toast.error(getErrorMessage(e)); } });
    return () => c.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refKey, version]);

  // "?add=1" (Home's shortcut) opens the add dialog for today as soon as the day has loaded
  useEffect(() => {
    if (params.get("add") === "1" && ref && detail && !dialog) {
      setDialog({ kind: "add" });
      setParams((p) => { const n = new URLSearchParams(p); n.delete("add"); return n; }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, detail]);

  // "?setup=1" (Home's Quick setup shortcut) opens Quick setup once the plan is known
  useEffect(() => {
    if (params.get("setup") === "1" && planCycle && !dialog) {
      setDialog({ kind: "setup" });
      setParams((p) => { const n = new URLSearchParams(p); n.delete("setup"); return n; }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, planCycle?.id]);

  const refresh = useCallback(async () => { setVersion((v) => v + 1); await onRefresh(); }, [onRefresh]);

  const weekDays: DaySummary[] = useMemo(() => dash.week.days.map((d) => d.plan ?? ({
    day_of_week: d.day_of_week, date: d.date, schedule_id: null, status: "unplanned", kind: "empty", title: null,
    display_title: null, notes: null, muscle_groups: [], exercise_count: 0, cardio_count: 0,
  } as DaySummary)), [dash.week.days]);

  async function snapshotOf(day: number): Promise<Snapshot | null> {
    if (!ref) return null;
    const r: DayRef = { ...ref, day };
    return { ref: r, snap: await plannerService.getDay(r.cycleId, r.week, r.day) };
  }
  const thisSnapshot = (): Snapshot | null => (ref && detail ? { ref, snap: detail } : null);

  /** Runs one action, refreshes, and offers Undo that restores every snapshot taken before it. */
  async function perform(fn: () => Promise<unknown>, message: string, snaps: (Snapshot | null)[]) {
    if (working.current) return;
    working.current = true; setBusy(true);
    try {
      await fn();
      await refresh();
      const usable = snaps.filter((s): s is Snapshot => s !== null);
      toast.success(message, usable.length === 0 ? undefined : {
        label: "Undo",
        onClick: async () => {
          try {
            for (const s of usable) await ops.restoreDay(s.ref, s.snap);
            await refresh();
            toast.success("Undone.");
          } catch (e) { toast.error(getErrorMessage(e)); }
        },
      });
    } finally {
      working.current = false; setBusy(false);
    }
  }
  /** Same, for buttons: failures become a toast. */
  const quick = (fn: () => Promise<unknown>, message: string, snaps: (Snapshot | null)[]) =>
    perform(fn, message, snaps).catch((e: unknown) => { toast.error(getErrorMessage(e)); });

  const name = DAY_NAMES[weekDay.day_of_week];
  const needDetail = (): DayDetail | null => detail;

  const onAddPick = async (ex: PickedExercise) => {
    const d = needDetail(); if (!ref || !d) return;
    await perform(() => ops.addExercise(ref, d, ex), `Added ${ex.name} to ${isToday ? "today" : name}.`, [thisSnapshot()]);
    setDialog(null);
  };
  /** A saved set ("Chest A"): every exercise goes into the day in one go; ones already there are skipped. */
  const onAddMany = async (list: PickedExercise[], setName: string) => {
    const d = needDetail(); if (!ref || !d) return;
    const have = new Set(d.strength.flatMap((g) => g.exercises.map((e) => e.exercise.id)));
    const fresh = list.filter((e) => !have.has(e.id));
    const where = isToday ? "today" : name;
    if (fresh.length === 0) { toast.success(`${setName} is already in ${where}.`); setDialog(null); return; }
    await perform(async () => {
      let day = d;
      for (const ex of fresh) day = await ops.addExercise(ref, day, ex);
    }, `Added ${setName} (${fresh.length} ${fresh.length === 1 ? "exercise" : "exercises"}) to ${where}.`, [thisSnapshot()]);
    setDialog(null);
  };
  const onReplacePick = async (group: ScheduledMuscleGroup, item: ScheduledExercise, ex: PickedExercise) => {
    const d = needDetail(); if (!ref || !d) return;
    await perform(() => ops.replaceExercise(ref, d, group, item, ex), `Replaced ${item.exercise.name} with ${ex.name}.`, [thisSnapshot()]);
    setDialog(null);
  };
  const onRemove = (item: ScheduledExercise) => {
    if (!ref) return;
    quick(() => ops.removeExercise(item), `Removed ${item.exercise.name}.`, [thisSnapshot()]);
  };
  const onMove = (group: ScheduledMuscleGroup, item: ScheduledExercise, delta: -1 | 1) => {
    if (!ref) return;
    quick(() => ops.moveExercise(ref, group, item.id, delta), `Moved ${item.exercise.name} ${delta < 0 ? "up" : "down"}.`, [thisSnapshot()]);
  };
  const onSaveTarget = async (item: ScheduledExercise, v: TargetEdit) => {
    await perform(() => plannerService.updateExercise(item.id, {
      exercise_id: item.exercise.id, target_sets: v.target_sets, target_reps: v.target_reps, target_weight_kg: v.target_weight_kg,
      rest_seconds: item.rest_seconds, notes: item.notes,
    }), `Updated ${item.exercise.name}.`, [thisSnapshot()]).catch((e: unknown) => { toast.error(getErrorMessage(e)); throw e; });
  };
  const onRemoveCardio = (id: number) => {
    if (!ref) return;
    quick(() => plannerService.removeCardio(id), "Removed cardio.", [thisSnapshot()]);
  };
  const onRest = () => { if (ref) quick(() => ops.markRest(ref), `${isToday ? "Today" : name} is now a rest day.`, [thisSnapshot()]); };
  const onClear = () => { if (ref) quick(() => ops.clearDay(ref), `Cleared ${isToday ? "today" : name}.`, [thisSnapshot()]); };
  /** Add on a rest/empty day: the dialog does the switching; nothing else to do here. */
  const openAdd = () => setDialog({ kind: "add" });

  async function onPicked(mode: PickerMode, target: { week: number; day: number }, overwrite: boolean) {
    if (!ref) return;
    if (mode === "copy-from") {
      // `target` is the source: bring it into the selected day
      const src: DayRef = { ...ref, week: target.week, day: target.day };
      await perform(() => ops.copyDay(src, { week: ref.week, day: ref.day }, overwrite), `Copied ${DAY_NAMES[target.day]} to ${isToday ? "today" : name}.`, [thisSnapshot()]);
    } else if (mode === "copy-to") {
      const other = await snapshotOf(target.day).catch(() => null);
      const sameWeek = target.week === ref.week;
      const label = sameWeek ? DAY_NAMES[target.day] : `${name} next week`;
      await perform(() => ops.copyDay(ref, target, overwrite), `Copied ${name} to ${label}.`, sameWeek ? [other] : []);
    } else {
      const other = await snapshotOf(target.day).catch(() => null);
      await perform(() => ops.moveDay(ref, target, overwrite), `Moved ${name} to ${DAY_NAMES[target.day]}.`, [thisSnapshot(), other]);
    }
    setDialog(null);
    if (mode === "move-to") setSelected(dash.week.days.find((d) => d.day_of_week === target.day)?.date ?? selected);
  }

  async function activatePlan(id: number) {
    setActivating(true);
    try { await cycleService.activate(id); await refresh(); toast.success("Plan activated."); }
    catch (e) { toast.error(getErrorMessage(e)); }
    finally { setActivating(false); }
  }

  const inactive = isToday ? dash.today.covered_by_inactive : null;
  const heading = isToday ? "Today" : name;
  const dateLabel = `${formatDateOnly(weekDay.date, { weekday: "long" })}, ${fmt(weekDay.date)}`;
  const resume = dash.in_progress_session;
  const doneToday = dash.today_workout?.status === "completed" ? dash.today_workout : null;
  const startable = isToday && ref && detail && detail.status === "planned" && detail.strength.some((g) => g.exercises.length > 0 || detail.cardio.length > 0);

  const startSlot = isToday ? (
    <div className="dp-start" data-testid="start-card">
      {resume ? (
        <Link to={`/workout/${resume.id}`} className="btn" data-testid="resume-link"><Play size={15} aria-hidden /> Resume workout</Link>
      ) : (
        <>
          {startable && ref && (
            <button type="button" className="btn" disabled={starting} data-testid="start-plan"
              onClick={() => start({ source: "plan", cycle_id: ref.cycleId, week_number: ref.week, day_of_week: ref.day })}>
              <Play size={15} aria-hidden /> {starting ? "Starting…" : doneToday ? "Start again" : "Start workout"}
            </button>
          )}
          <button type="button" className={startable ? "btn btn-ghost" : "btn btn-outline"} disabled={starting} data-testid="start-blank"
            onClick={() => start({ source: "blank" })}>{starting ? "Starting…" : "Start a blank workout"}</button>
        </>
      )}
      {doneToday && !resume && <Link to={`/workout/${doneToday.id}`} className="dp-done">Today's workout is logged. View it</Link>}
    </div>
  ) : null;


  return (
    <>
      <div className="plan-head" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "space-between", margin: "0 0 12px" }}>
        {planCycle ? (
          <p className="plan-name" data-testid="plan-name" style={{ margin: 0, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "baseline" }}>
            <span className="eyebrow">PLAN</span>
            <b style={{ fontSize: "1.1rem" }}>{planCycle.name}</b>
            {planWeek != null && <span className="plan-week" style={{ opacity: 0.7 }}>Week {planWeek} of {planCycle.total_weeks}</span>}
          </p>
        ) : <span />}
        <div className="plan-head-actions" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <nav className="plan-tools" aria-label="More planning tools" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <Link to="/planner" className="btn btn-outline" aria-label="Full week planner" title="Full week planner"><LayoutGrid size={15} aria-hidden /> <span className="pt-label">Full week planner</span></Link>
            <Link to="/cycles" className="btn btn-outline" aria-label="Workout cycles" title="Workout cycles"><Layers size={15} aria-hidden /> <span className="pt-label">Workout cycles</span></Link>
            <Link to={`/calendar?view=week&date=${dash.date}`} className="btn btn-outline" aria-label="Calendar" title="Calendar"><CalendarDays size={15} aria-hidden /> <span className="pt-label">Calendar</span></Link>
          </nav>
          {planCycle && (
            <button type="button" className="btn btn-outline" data-testid="quick-setup" onClick={() => setDialog({ kind: "setup" })}>
              <Zap size={15} aria-hidden /> Quick setup
            </button>
          )}
          {/* Share and Paste are for every signed-in user, with or without a plan yet */}
          <button type="button" className="icon-btn sx-tool" aria-label="Share workout plan"
            title={ref ? "Share: copy a code for this day or week" : "Start a plan first, then you can share it"}
            disabled={!ref} onClick={() => setDialog({ kind: "share" })} data-testid="plan-share"><Share2 size={17} aria-hidden /></button>
          <button type="button" className="icon-btn sx-tool" aria-label="Paste a plan code" title="Paste a code to copy someone else's day or week"
            onClick={() => setDialog({ kind: planCycle ? "paste" : "needplan" })} data-testid="plan-paste"><ClipboardPaste size={17} aria-hidden /></button>
        </div>
      </div>
      <WeekStrip days={dash.week.days} selected={selected} onSelect={setSelected} />

      {ref ? (
        <DayPanel heading={heading} dateLabel={dateLabel} detail={detail} loading={loading} busy={busy} weightUnit={prefs.weightUnit}
          iconFor={(n) => icons[n.toLowerCase()]} startSlot={startSlot}
          plannerLink={`/planner?cycle=${ref.cycleId}&week=${ref.week}&day=${ref.day}`}
          onAdd={openAdd}
          onReplace={(group, item) => setDialog({ kind: "replace", group, item })}
          onRemove={onRemove} onMove={onMove} onSaveTarget={onSaveTarget} onRemoveCardio={onRemoveCardio}
          onRest={onRest} onClear={onClear}
          onCopyTo={() => setDialog({ kind: "pick", mode: "copy-to" })}
          onMoveTo={() => setDialog({ kind: "pick", mode: "move-to" })}
          onCopyFrom={() => setDialog({ kind: "pick", mode: "copy-from" })} />
      ) : (
        <section className="panel dp" data-testid="no-plan">
          <header className="dp-head"><div><span className="eyebrow">{heading.toUpperCase()}</span><h2>No plan for this day</h2><p className="dp-date">{dateLabel}</p></div></header>
          {startSlot}
          <div className="dp-empty">
            <CalendarClock size={22} aria-hidden />
            {inactive ? (
              <>
                <b>“{inactive.name}” covers this day but isn't active</b>
                <p>Turn it on to see and edit its workouts here.</p>
                <button type="button" className="btn" disabled={activating} onClick={() => activatePlan(inactive.id)}>{activating ? "Activating…" : "Activate plan"}</button>
              </>
            ) : (
              <>
                <b>No workout plan covers this week</b>
                <p>Start a plan in one step, then add exercises to any day.</p>
                <button type="button" className="btn" onClick={() => setDialog({ kind: "plan" })}>Start a plan</button>
              </>
            )}
          </div>
        </section>
      )}

      {dialog?.kind === "add" && ref && detail && (
        <QuickAddDialog title={`Add exercise to ${isToday ? "today" : name}`}
          excludeIds={detail.strength.flatMap((g) => g.exercises.map((e) => e.exercise.id))}
          onClose={() => setDialog(null)} onPick={onAddPick} onPickMany={onAddMany} />
      )}
      {dialog?.kind === "replace" && ref && detail && (
        <QuickAddDialog title={`Replace ${dialog.item.exercise.name}`} muscle={dialog.group.muscle_group.name} allowSets={false}
          excludeIds={detail.strength.flatMap((g) => g.exercises.map((e) => e.exercise.id))}
          onClose={() => setDialog(null)} onPick={(ex) => onReplacePick(dialog.group, dialog.item, ex)} />
      )}
      {dialog?.kind === "pick" && ref && weekDay.cycle && (
        <DayPickerDialog mode={dialog.mode} dayIndex={weekDay.day_of_week} week={ref.week} totalWeeks={weekDay.cycle.total_weeks}
          days={weekDays} onClose={() => setDialog(null)} onChoose={(t, o) => onPicked(dialog.mode, t, o)} />
      )}
      {dialog?.kind === "setup" && planCycle && (
        <QuickSetupDialog cycle={planCycle} week={planWeek ?? 1} day={weekDay.day_of_week} onClose={() => setDialog(null)}
          onApplied={(message) => { setDialog(null); void refresh(); toast.success(message); }} />
      )}
      {dialog?.kind === "share" && ref && (
        <PlanShareDialog cycleId={ref.cycleId} week={ref.week} day={ref.day} dayName={name} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "paste" && planCycle && (
        <PlanImportDialog cycle={planCycle} week={planWeek ?? 1} day={weekDay.day_of_week} onClose={() => setDialog(null)}
          onImported={(r) => {
            setDialog(null);
            void refresh();
            const added = r.added_exercises.length ? ` ${r.added_exercises.length} new ${r.added_exercises.length === 1 ? "exercise was" : "exercises were"} added to your library.` : "";
            toast.success(`${r.kind === "day" ? "Day" : `${r.imported_days} ${r.imported_days === 1 ? "day" : "days"}`} copied into your plan.${added}`);
          }} />
      )}
      {dialog?.kind === "needplan" && (
        <ConfirmDialog title="Start a plan first" confirmLabel="Start a plan" onConfirm={() => setDialog({ kind: "plan" })} onCancel={() => setDialog(null)}>
          <p>A pasted day or week is copied into your workout plan, and you don't have one yet. Start a plan in one step, then paste the code.</p>
        </ConfirmDialog>
      )}
      {dialog?.kind === "plan" && (
        <QuickPlanDialog onClose={() => setDialog(null)} onCreated={() => { setDialog(null); refresh(); toast.success("Plan started. Add your first exercise."); }} />
      )}
    </>
  );
}
