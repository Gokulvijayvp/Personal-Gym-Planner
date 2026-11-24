import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CalendarDays, Clock, HeartPulse, Plus, RefreshCw, Timer } from "lucide-react";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import ErrorState from "../components/ui/ErrorState";
import { useToast } from "../components/ui/Toast";
import CardioCard from "../features/workout/CardioCard";
import ExerciseCard, { type ExerciseActions } from "../features/workout/ExerciseCard";
import FinishDialog from "../features/workout/FinishDialogs";
import { AddCardioModal, AddExerciseModal } from "../features/workout/Pickers";
import { STATUS_TEXT, elapsedSeconds, isEmptyLog, summarize } from "../features/workout/sessionLogic";
import { formatClock, formatDurationShort } from "../features/workout/units";
import { useWorkoutEditor } from "../features/workout/useWorkoutEditor";
import { useSettingsPrefs } from "../features/settings/useSettingsPrefs";
import { dateFormatter } from "../features/home/prefs";
import { workoutService } from "../services/workoutService";
import { formatDateOnly, formatTime } from "../utils/date";

type Confirm = { kind: "exercise" | "set" | "cardio"; id: number; label: string; detail: string } | null;

function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);
  return now;
}

function SessionScreen({ sessionId }: { sessionId: number }) {
  const toast = useToast();
  const { prefs } = useSettingsPrefs();
  const fmt = useMemo(() => dateFormatter(prefs), [prefs]);
  const ed = useWorkoutEditor(sessionId);
  const { session } = ed;
  const [picker, setPicker] = useState<null | "exercise" | "cardio">(null);
  const [finish, setFinish] = useState<null | "complete" | "cancel">(null);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const running = session?.status === "in_progress";
  const now = useNow(!!running);

  const actions = useMemo<ExerciseActions>(() => ({
    editSet: (id, patch, immediate) => ed.edit("set", id, patch, immediate),
    editExercise: (id, patch, immediate) => ed.edit("exercise", id, patch, immediate),
    addSet: (exerciseId) => ed.run(() => workoutService.addSet(sessionId, exerciseId)),
    removeSet: (setId) => {
      const s = session?.exercises.flatMap((e) => e.sets).find((x) => x.id === setId);
      if (s && (s.actual_reps !== null || s.actual_weight_kg !== null || s.status !== "pending")) {
        setConfirm({ kind: "set", id: setId, label: `set ${s.set_number}`, detail: "The reps, weight and status you entered for it will be deleted." });
      } else ed.run(() => workoutService.removeSet(sessionId, setId));
    },
    removeExercise: (exerciseId) => {
      const e = session?.exercises.find((x) => x.id === exerciseId);
      if (e) setConfirm({ kind: "exercise", id: exerciseId, label: e.exercise_name, detail: `Its ${e.sets.length} set${e.sets.length === 1 ? "" : "s"} and notes will be deleted from this workout. The Exercise Library is not affected.` });
    },
    typing: ed.typing,
    move: (exerciseId, delta) => {
      if (!session) return;
      const ids = session.exercises.map((e) => e.id);
      const i = ids.indexOf(exerciseId), j = i + delta;
      if (i < 0 || j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      ed.run(() => workoutService.reorderExercises(sessionId, ids));
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [ed.edit, ed.run, ed.typing, session, sessionId]);

  if (ed.loadError) {
    return (
      <section className="panel page-empty">
        <ErrorState title="Couldn't open this workout" message={ed.loadError} onRetry={ed.reload} />
        <p className="center"><Link to="/workout">Back to workouts</Link></p>
      </section>
    );
  }
  if (!session) return <div className="skeleton session-skeleton" role="status" aria-label="Loading workout" aria-busy="true" />;

  const readOnly = session.status !== "in_progress";
  const live = summarize(session);                         // from the records on screen, so it updates as you log
  const elapsed = elapsedSeconds(session.duration_seconds, ed.receivedAt, !!running, now);
  const title = session.title || (session.source === "blank" ? "Blank workout" : "Workout");

  const confirmRemove = () => {
    if (!confirm) return;
    const { kind, id } = confirm;
    setConfirm(null);
    ed.run(() => kind === "exercise" ? workoutService.removeExercise(sessionId, id) : kind === "set" ? workoutService.removeSet(sessionId, id) : workoutService.removeCardio(sessionId, id));
  };

  const onFinish = async (text: string | null) => {
    if (!finish) return;
    setFinishError(null);
    const err = await ed.finish(finish, text);
    if (err) { setFinishError(err); return; }
    toast.success(finish === "complete" ? "Workout completed." : "Workout cancelled.");
    setFinish(null);
  };

  return (
    <>
      <div className="session-top">
        <Link to="/workout" className="back-link"><ArrowLeft size={16} aria-hidden /> Workouts</Link>
      </div>

      <header className="panel session-head" aria-label="Workout details">
        <div className="session-title">
          <span className="eyebrow">{readOnly ? "WORKOUT LOG" : "WORKOUT IN PROGRESS"}</span>
          <h1>{title}</h1>
          {session.cycle_name && <p className="home-sub">{session.cycle_name}{session.week_number ? ` · Week ${session.week_number}` : ""}</p>}
        </div>
        <dl className="session-meta">
          <div><dt><CalendarDays size={14} aria-hidden /> Date</dt><dd data-testid="session-date">{formatDateOnly(session.workout_date, { weekday: "short" })}, {fmt(session.workout_date)}</dd></div>
          <div><dt>Status</dt><dd><span className={`session-badge s-${session.status}`} data-testid="session-status">{STATUS_TEXT[session.status]}</span></dd></div>
          <div><dt><Clock size={14} aria-hidden /> Started</dt><dd data-testid="session-started">{formatTime(session.started_at)}</dd></div>
          <div><dt><Timer size={14} aria-hidden /> {running ? "Elapsed" : "Duration"}</dt><dd data-testid="session-elapsed">{running ? formatClock(elapsed) : formatDurationShort(elapsed)}</dd></div>
        </dl>
        {!readOnly && (
          <p className={`save-pill save-${ed.saveState}`} role="status" aria-live="polite" data-testid="save-status">
            {ed.saveState === "saving" && "Saving…"}
            {ed.saveState === "saved" && "All changes saved"}
            {ed.saveState === "idle" && "Changes save automatically"}
            {ed.saveState === "error" && (
              <>Save failed. Your entries are kept here. <button type="button" className="btn btn-outline btn-sm" onClick={ed.retry}><RefreshCw size={13} aria-hidden /> Retry</button></>
            )}
          </p>
        )}
        {ed.saveState === "error" && ed.saveError && <p className="form-alert session-alert" role="alert">{ed.saveError}</p>}
      </header>

      <section className="session-summary" aria-label="Workout summary">
        <div><b data-testid="sum-exercises">{live.total_exercises}</b><span>Exercises</span></div>
        <div><b data-testid="sum-done">{live.completed_exercises}</b><span>Completed</span></div>
        <div><b data-testid="sum-skipped">{live.skipped_exercises}</b><span>Skipped</span></div>
        <div><b data-testid="sum-sets">{live.completed_sets}</b><span>Sets done{live.total_sets > 0 ? ` of ${live.total_sets}` : ""}</span></div>
        <div><b data-testid="sum-cardio">{live.cardio_minutes}</b><span>Cardio min logged</span></div>
        <div><b data-testid="sum-duration">{running ? formatClock(elapsed) : formatDurationShort(elapsed)}</b><span>{running ? "Elapsed" : "Duration"}</span></div>
      </section>

      {readOnly && (session.notes || session.cancel_reason) && (
        <section className="panel session-note" aria-label="Workout note">
          <b>{session.status === "cancelled" ? "Reason for cancelling" : "Overall note"}</b>
          <p>{session.status === "cancelled" ? session.cancel_reason : session.notes}</p>
        </section>
      )}

      <section className="session-block" aria-label="Exercises">
        <div className="session-block-head"><h2>Exercises</h2></div>
        {session.exercises.length === 0 && session.cardio.length === 0 && (
          <div className="home-empty"><b>{readOnly ? "Nothing was logged" : "Nothing here yet"}</b>
            <p>{readOnly ? "This workout has no exercises or cardio." : "Add exercises from your library, or add cardio below."}</p></div>
        )}
        <div className="ex-log-list">
          {session.exercises.map((e, i) => (
            <ExerciseCard key={e.id} exercise={e} index={i} count={session.exercises.length} prefs={prefs} readOnly={readOnly} actions={actions} />
          ))}
        </div>
        {!readOnly && <button type="button" className="btn btn-outline add-block" onClick={() => setPicker("exercise")}><Plus size={16} aria-hidden /> Add exercise</button>}
      </section>

      {(session.cardio.length > 0 || !readOnly) && (
        <section className="session-block" aria-label="Cardio">
          <div className="session-block-head"><h2><HeartPulse size={17} aria-hidden /> Cardio</h2></div>
          <div className="ex-log-list">
            {session.cardio.map((c) => (
              <CardioCard key={c.id} cardio={c} prefs={prefs} readOnly={readOnly} typing={ed.typing} edit={(id, patch, now2) => ed.edit("cardio", id, patch, now2)}
                remove={(id) => setConfirm({ kind: "cardio", id, label: c.activity_name, detail: "Its duration, distance and notes will be deleted from this workout." })} />
            ))}
          </div>
          {!readOnly && <button type="button" className="btn btn-outline add-block" onClick={() => setPicker("cardio")}><Plus size={16} aria-hidden /> Add cardio</button>}
        </section>
      )}

      {!readOnly && (
        <div className="session-bar" role="group" aria-label="Workout actions">
          <span className={`save-mini save-${ed.saveState}`} aria-hidden>
            {ed.saveState === "saving" ? "Saving…" : ed.saveState === "error" ? "Not saved" : "Saved"}
          </span>
          <button type="button" className="btn btn-ghost" onClick={() => { setFinishError(null); setFinish("cancel"); }}>Cancel workout</button>
          <button type="button" className="btn" onClick={() => { setFinishError(null); setFinish("complete"); }}>Complete workout</button>
        </div>
      )}

      {picker === "exercise" && (
        <AddExerciseModal onClose={() => setPicker(null)} onPick={(x) => { setPicker(null); ed.run(() => workoutService.addExercise(sessionId, x.id)); }} />
      )}
      {picker === "cardio" && (
        <AddCardioModal onClose={() => setPicker(null)} onPick={(a) => { setPicker(null); ed.run(() => workoutService.addCardio(sessionId, a.id)); }} />
      )}
      {finish && (
        <FinishDialog kind={finish} summary={live} elapsed={elapsed} empty={isEmptyLog(session)} busy={ed.finishing} error={finishError}
          onConfirm={onFinish} onClose={() => !ed.finishing && setFinish(null)} />
      )}
      {confirm && (
        <ConfirmDialog title={`Remove ${confirm.label}?`} confirmLabel="Remove" tone="danger" onConfirm={confirmRemove} onCancel={() => setConfirm(null)}>
          <p>{confirm.detail}</p>
        </ConfirmDialog>
      )}
    </>
  );
}

export default function WorkoutSessionPage() {
  const { id } = useParams();
  const sessionId = Number(id);
  if (!id || !Number.isInteger(sessionId) || sessionId < 1) {
    return (
      <section className="panel page-empty">
        <ErrorState title="Workout not found" message="That isn't a valid workout link." />
        <p className="center"><Link to="/workout">Back to workouts</Link></p>
      </section>
    );
  }
  return <SessionScreen key={sessionId} sessionId={sessionId} />;
}
