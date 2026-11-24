import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Copy, Pencil, Plus, Trash2 } from "lucide-react";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import ErrorState from "../../components/ui/ErrorState";
import Modal from "../../components/ui/Modal";
import { useToast } from "../../components/ui/Toast";
import { ApiError, getErrorMessage } from "../../services/apiError";
import { plannerService } from "../../services/plannerService";
import { workoutService } from "../../services/workoutService";
import type { MuscleGroup, WorkoutType } from "../../types/exercise";
import type { CardioActivity, CycleStatus, DayDetail, ScheduledCardio, ScheduledExercise } from "../../types/planner";
import type { SessionRef } from "../../types/workout";
import { formatDateOnly } from "../../utils/date";
import CardioForm from "./CardioForm";
import CopyDayDialog from "./CopyDayDialog";
import ExerciseAssignmentForm from "./ExerciseAssignmentForm";
import DayWorkoutAction from "../workout/DayWorkoutAction";
import {
  DAY_NAMES, EMPTY_ASSIGNMENT, EMPTY_CARDIO, assignmentFromItem, cardioFromItem, describeAssignment, moveItem,
  type AssignmentErrors, type CardioErrors,
} from "./plannerLogic";

interface Props {
  cycleId: number;
  weekNumber: number;
  dayOfWeek: number;
  totalWeeks: number;
  /** false for completed / archived cycles: everything is read-only. */
  editable: boolean;
  /** Needed to know whether a workout can be started from this day. */
  cycleStatus?: CycleStatus;
  muscleGroups: MuscleGroup[];
  workoutTypes: WorkoutType[];
  cardioActivities: CardioActivity[];
  onClose: () => void;
  /** Called after every successful change so the week overview can refresh. */
  onChanged: () => void;
}

type ExerciseForm = null | { mode: "add"; muscleGroupId: number } | { mode: "edit"; muscleGroupId: number; item: ScheduledExercise };
type CardioFormState = null | { mode: "add" } | { mode: "edit"; item: ScheduledCardio };
type Confirm =
  | null | { type: "rest" } | { type: "clear" } | { type: "group"; muscleGroupId: number; name: string; count: number }
  | { type: "exercise"; item: ScheduledExercise } | { type: "cardio"; item: ScheduledCardio };

export default function DayEditorModal({
  cycleId, weekNumber, dayOfWeek, totalWeeks, editable, cycleStatus, muscleGroups, workoutTypes, cardioActivities, onClose, onChanged,
}: Props) {
  const toast = useToast();
  const [day, setDay] = useState<DayDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);

  const [exForm, setExForm] = useState<ExerciseForm>(null);
  const [cardioForm, setCardioForm] = useState<CardioFormState>(null);
  const [formErrors, setFormErrors] = useState<{ fields?: AssignmentErrors & CardioErrors; message?: string | null }>({});
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const [groupToAdd, setGroupToAdd] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoadError(null);
    plannerService.getDay(cycleId, weekNumber, dayOfWeek, controller.signal)
      .then((d) => { setDay(d); setTitle(d.title ?? ""); setNotes(d.notes ?? ""); })
      .catch((e: unknown) => { if (!controller.signal.aborted) setLoadError(getErrorMessage(e)); });
    return () => controller.abort();
  }, [cycleId, weekNumber, dayOfWeek, attempt]);

  // The workout already logged for this date (if any), so "Start" becomes "Resume" / "View" instead of a duplicate.
  const [logged, setLogged] = useState<SessionRef | null>(null);
  const dayDate = day?.date;
  useEffect(() => {
    if (!dayDate) return;
    const controller = new AbortController();
    workoutService.list({ status: "all", start: dayDate, end: dayDate, page: 1, page_size: 10 }, controller.signal)
      .then((r) => {
        const best = r.items.find((x) => x.status === "in_progress") ?? r.items.find((x) => x.status === "completed");
        setLogged(best ? { id: best.id, status: best.status, workout_date: best.workout_date, title: best.title } : null);
      })
      .catch(() => { /* not being able to look is fine: the server still refuses a duplicate unfinished workout */ });
    return () => controller.abort();
  }, [dayDate]);

  /** Run a change; on success take the server's version of the day, on failure surface the error. */
  const run = useCallback(async (call: () => Promise<DayDetail>, opts: { quiet?: boolean } = {}): Promise<boolean> => {
    setBusy(true);
    try {
      const updated = await call();
      setDay(updated);
      onChanged();
      return true;
    } catch (e) {
      if (!opts.quiet) toast.error(getErrorMessage(e));
      throw e;
    } finally {
      setBusy(false);
    }
  }, [onChanged, toast]);

  const attemptRun = async (call: () => Promise<DayDetail>) => { try { return await run(call); } catch { return false; } };

  const isRest = day?.status === "rest";
  const hasWorkout = Boolean(day && (day.strength.length > 0 || day.cardio.length > 0));
  const addedIds = useMemo(() => new Set(day?.strength.map((g) => g.muscle_group.id) ?? []), [day]);
  const detailsChanged = day !== null && (title.trim() !== (day.title ?? "") || notes.trim() !== (day.notes ?? ""));

  const closeForms = () => { setExForm(null); setCardioForm(null); setFormErrors({}); };

  // ---- day level -------------------------------------------------------------------------
  const saveDetails = () => attemptRun(() => plannerService.putDay(cycleId, weekNumber, dayOfWeek, {
    status: isRest ? "rest" : "planned", title: title.trim() || null, notes: notes.trim() || null,
  }));

  async function setRestDay(rest: boolean) {
    if (!day || rest === isRest) return;
    if (rest && hasWorkout) { setConfirmError(null); setConfirm({ type: "rest" }); return; }
    closeForms();
    await attemptRun(() => plannerService.putDay(cycleId, weekNumber, dayOfWeek, {
      status: rest ? "rest" : "planned", title: title.trim() || null, notes: notes.trim() || null }));
  }

  async function runConfirmed() {
    if (!confirm) return;
    setConfirmError(null);
    try {
      switch (confirm.type) {
        case "rest":
          closeForms();
          await run(() => plannerService.putDay(cycleId, weekNumber, dayOfWeek,
            { status: "rest", title: title.trim() || null, notes: notes.trim() || null, clear_workout: true }), { quiet: true });
          toast.success("Marked as a rest day.");
          break;
        case "clear":
          setBusy(true);
          await plannerService.clearDay(cycleId, weekNumber, dayOfWeek);
          onChanged();
          closeForms();
          setAttempt((n) => n + 1);
          toast.success("Day cleared.");
          break;
        case "group":
          await run(() => plannerService.removeMuscleGroup(cycleId, weekNumber, dayOfWeek, confirm.muscleGroupId), { quiet: true });
          break;
        case "exercise":
          await run(() => plannerService.removeExercise(confirm.item.id), { quiet: true });
          break;
        case "cardio":
          await run(() => plannerService.removeCardio(confirm.item.id), { quiet: true });
          break;
      }
      setConfirm(null);
    } catch (e) {
      setConfirmError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  // ---- muscle groups & exercises ---------------------------------------------------------
  async function addGroup() {
    if (!groupToAdd) return;
    if (await attemptRun(() => plannerService.addMuscleGroup(cycleId, weekNumber, dayOfWeek, Number(groupToAdd)))) setGroupToAdd("");
  }

  async function submitExercise(input: Parameters<typeof plannerService.addExercise>[4]) {
    if (!exForm) return;
    setFormErrors({});
    try {
      await run(() => exForm.mode === "add"
        ? plannerService.addExercise(cycleId, weekNumber, dayOfWeek, exForm.muscleGroupId, input)
        : plannerService.updateExercise(exForm.item.id, input), { quiet: true });
      setExForm(null);
    } catch (e) {
      setFormErrors({
        fields: e instanceof ApiError ? (e.fieldErrors as AssignmentErrors) : undefined,
        message: e instanceof ApiError && Object.keys(e.fieldErrors).length > 0 ? null : getErrorMessage(e),
      });
    }
  }

  const move = (group: DayDetail["strength"][number], index: number, delta: -1 | 1) => {
    const next = moveItem(group.exercises.map((e) => e.id), index, delta);
    if (next) void attemptRun(() => plannerService.reorderExercises(cycleId, weekNumber, dayOfWeek, group.muscle_group.id, next));
  };

  async function submitCardio(input: Parameters<typeof plannerService.addCardio>[3]) {
    if (!cardioForm) return;
    setFormErrors({});
    try {
      await run(() => cardioForm.mode === "add"
        ? plannerService.addCardio(cycleId, weekNumber, dayOfWeek, input)
        : plannerService.updateCardio(cardioForm.item.id, input), { quiet: true });
      setCardioForm(null);
    } catch (e) {
      setFormErrors({
        fields: e instanceof ApiError ? (e.fieldErrors as CardioErrors) : undefined,
        message: e instanceof ApiError && Object.keys(e.fieldErrors).length > 0 ? null : getErrorMessage(e),
      });
    }
  }

  // ---- render ----------------------------------------------------------------------------
  const heading = `${DAY_NAMES[dayOfWeek]}${day ? ` · ${formatDateOnly(day.date, { day: "numeric", month: "short", year: "numeric" })}` : ""}`;
  const canEdit = editable && !busy;

  return (
    <Modal title={`${heading} — week ${weekNumber}`} size="lg" onClose={onClose} dismissible={!busy}
      footer={
        <>
          {day && hasWorkout && !isRest && cycleStatus && (
            <DayWorkoutAction cycleId={cycleId} cycleStatus={cycleStatus} weekNumber={weekNumber} dayOfWeek={dayOfWeek} date={day.date}
              hasWorkout workout={logged} />
          )}
          {editable && day && (
            <>
              <button type="button" className="btn btn-outline" onClick={() => setCopying(true)} disabled={busy || !(hasWorkout || isRest || day.title || day.notes)}>
                <Copy size={15} /> Copy day
              </button>
              <button type="button" className="btn btn-outline btn-danger-outline" disabled={busy || !(hasWorkout || isRest || day.title || day.notes)}
                onClick={() => { setConfirmError(null); setConfirm({ type: "clear" }); }}>
                <Trash2 size={15} /> Clear day
              </button>
            </>
          )}
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Done</button>
        </>
      }
    >
      {loadError ? (
        <ErrorState title="Couldn't load this day" message={loadError} onRetry={() => setAttempt((n) => n + 1)} />
      ) : !day ? (
        <div aria-busy="true" role="status" aria-label="Loading day">
          <div className="skeleton sk-title" /><div className="skeleton sk-line" /><div className="skeleton sk-line short" />
        </div>
      ) : (
        <div className="day-editor">
          {!editable && <p className="muted-note" data-testid="read-only">This cycle can no longer be changed, so this day is read-only.</p>}

          {editable && (
            <div className="seg" role="group" aria-label="Day type">
              <button type="button" className={!isRest ? "seg-btn on" : "seg-btn"} aria-pressed={!isRest} disabled={busy}
                onClick={() => setRestDay(false)}>Workout day</button>
              <button type="button" className={isRest ? "seg-btn on" : "seg-btn"} aria-pressed={isRest} disabled={busy}
                onClick={() => setRestDay(true)}>Rest day</button>
            </div>
          )}

          <div className="day-meta">
            <div className="field">
              <label htmlFor="day-title">Day title <span className="optional">(optional)</span></label>
              <input id="day-title" value={title} maxLength={120} placeholder="e.g. Push day" disabled={!canEdit}
                onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="day-notes">Day notes</label>
              <textarea id="day-notes" rows={2} value={notes} maxLength={2000} placeholder="Anything to remember for this day" disabled={!canEdit}
                onChange={(e) => setNotes(e.target.value)} />
            </div>
            {editable && detailsChanged && (
              <button type="button" className="btn btn-sm" disabled={busy} onClick={saveDetails}>Save title & notes</button>
            )}
          </div>

          {isRest ? (
            <p className="rest-note" data-testid="rest-note">Rest day. No workout is planned. Switch to “Workout day” to plan training.</p>
          ) : (
            <>
              <section aria-labelledby="strength-h" className="editor-section">
                <h3 id="strength-h">Strength</h3>
                {editable && (
                  <div className="add-group">
                    <select value={groupToAdd} onChange={(e) => setGroupToAdd(e.target.value)} aria-label="Muscle group to add" disabled={busy}>
                      <option value="">Add a muscle group…</option>
                      {muscleGroups.filter((g) => !addedIds.has(g.id)).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                    <button type="button" className="btn btn-sm" onClick={addGroup} disabled={busy || !groupToAdd}>
                      <Plus size={14} /> Add muscle group
                    </button>
                  </div>
                )}
                {day.strength.length === 0 && <p className="muted-note">No muscle groups yet. Pick one to start planning exercises.</p>}

                {day.strength.map((group) => (
                  <article key={group.id} className="group-card" aria-label={`${group.muscle_group.name} exercises`}>
                    <header className="group-head">
                      <h4>{group.muscle_group.name} <span className="muted">({group.exercises.length})</span></h4>
                      {editable && (
                        <button type="button" className="icon-btn" disabled={busy} aria-label={`Remove ${group.muscle_group.name} from this day`}
                          onClick={() => { setConfirmError(null); setConfirm({ type: "group", muscleGroupId: group.muscle_group.id, name: group.muscle_group.name, count: group.exercises.length }); }}>
                          <Trash2 size={16} />
                        </button>
                      )}
                    </header>

                    <ol className="ex-rows">
                      {group.exercises.map((item, i) => (
                        <li key={item.id}>
                          {exForm?.mode === "edit" && exForm.item.id === item.id ? (
                            <ExerciseAssignmentForm mode="edit" initial={assignmentFromItem(item)} initialExerciseName={item.exercise.name}
                              muscleGroupId={group.muscle_group.id} muscleGroups={muscleGroups} workoutTypes={workoutTypes} saving={busy}
                              serverErrors={formErrors.fields} formError={formErrors.message} onSubmit={submitExercise} onCancel={closeForms} />
                          ) : (
                            <div className="ex-row">
                              <span className="ex-num" aria-label={`Order ${item.order}`}>{item.order}</span>
                              <div className="ex-body">
                                <b>{item.exercise.name}</b>
                                {!item.exercise.is_active && <span className="badge badge-inactive">Inactive in library</span>}
                                <span className="picker-tags">
                                  {item.exercise.target_area && <span className="tag">{item.exercise.target_area.name}</span>}
                                  {item.exercise.workout_type && <span className="tag tag-type">{item.exercise.workout_type.name}</span>}
                                </span>
                                <span className="ex-sub">{describeAssignment(item)}</span>
                                {item.notes && <span className="ex-note">{item.notes}</span>}
                              </div>
                              {editable && (
                                <div className="row-actions">
                                  <button type="button" className="icon-btn" disabled={busy || i === 0} aria-label={`Move ${item.exercise.name} up`} onClick={() => move(group, i, -1)}><ArrowUp size={15} /></button>
                                  <button type="button" className="icon-btn" disabled={busy || i === group.exercises.length - 1} aria-label={`Move ${item.exercise.name} down`} onClick={() => move(group, i, 1)}><ArrowDown size={15} /></button>
                                  <button type="button" className="icon-btn" disabled={busy} aria-label={`Edit ${item.exercise.name}`}
                                    onClick={() => { closeForms(); setExForm({ mode: "edit", muscleGroupId: group.muscle_group.id, item }); }}><Pencil size={15} /></button>
                                  <button type="button" className="icon-btn" disabled={busy} aria-label={`Remove ${item.exercise.name}`}
                                    onClick={() => { setConfirmError(null); setConfirm({ type: "exercise", item }); }}><Trash2 size={15} /></button>
                                </div>
                              )}
                            </div>
                          )}
                        </li>
                      ))}
                    </ol>

                    {exForm?.mode === "add" && exForm.muscleGroupId === group.muscle_group.id ? (
                      <ExerciseAssignmentForm mode="add" initial={EMPTY_ASSIGNMENT} muscleGroupId={group.muscle_group.id}
                        muscleGroups={muscleGroups} workoutTypes={workoutTypes} saving={busy} serverErrors={formErrors.fields}
                        formError={formErrors.message} onSubmit={submitExercise} onCancel={closeForms} />
                    ) : editable && (
                      <button type="button" className="btn btn-outline btn-sm" disabled={busy}
                        onClick={() => { closeForms(); setExForm({ mode: "add", muscleGroupId: group.muscle_group.id }); }}>
                        <Plus size={14} /> Add exercise to {group.muscle_group.name}
                      </button>
                    )}
                  </article>
                ))}
              </section>

              <section aria-labelledby="cardio-h" className="editor-section">
                <h3 id="cardio-h">Cardio</h3>
                {day.cardio.length === 0 && !cardioForm && <p className="muted-note">No cardio planned.</p>}
                <ul className="ex-rows">
                  {day.cardio.map((c) => (
                    <li key={c.id}>
                      {cardioForm?.mode === "edit" && cardioForm.item.id === c.id ? (
                        <CardioForm mode="edit" initial={cardioFromItem(c)} activities={cardioActivities} saving={busy}
                          serverErrors={formErrors.fields} formError={formErrors.message} onSubmit={submitCardio} onCancel={closeForms} />
                      ) : (
                        <div className="ex-row">
                          <span className="ex-num cardio" aria-hidden>♥</span>
                          <div className="ex-body">
                            <b>{c.cardio_activity.name}</b>
                            <span className="ex-sub">{c.duration_minutes} min{c.distance_km !== null ? ` · ${c.distance_km} km` : ""}</span>
                            {c.notes && <span className="ex-note">{c.notes}</span>}
                          </div>
                          {editable && (
                            <div className="row-actions">
                              <button type="button" className="icon-btn" disabled={busy} aria-label={`Edit ${c.cardio_activity.name} cardio`}
                                onClick={() => { closeForms(); setCardioForm({ mode: "edit", item: c }); }}><Pencil size={15} /></button>
                              <button type="button" className="icon-btn" disabled={busy} aria-label={`Remove ${c.cardio_activity.name} cardio`}
                                onClick={() => { setConfirmError(null); setConfirm({ type: "cardio", item: c }); }}><Trash2 size={15} /></button>
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
                {cardioForm?.mode === "add" ? (
                  <CardioForm mode="add" initial={EMPTY_CARDIO} activities={cardioActivities} saving={busy}
                    serverErrors={formErrors.fields} formError={formErrors.message} onSubmit={submitCardio} onCancel={closeForms} />
                ) : editable && (
                  <button type="button" className="btn btn-outline btn-sm" disabled={busy}
                    onClick={() => { closeForms(); setCardioForm({ mode: "add" }); }}>
                    <Plus size={14} /> Add cardio
                  </button>
                )}
              </section>
            </>
          )}
        </div>
      )}

      {confirm && day && (
        <ConfirmDialog
          title={{ rest: "Make this a rest day?", clear: "Clear this day?", group: `Remove ${confirm.type === "group" ? confirm.name : ""}?`,
            exercise: "Remove this exercise?", cardio: "Remove this cardio?" }[confirm.type]}
          confirmLabel={{ rest: "Make rest day", clear: "Clear day", group: "Remove", exercise: "Remove", cardio: "Remove" }[confirm.type]}
          tone={confirm.type === "rest" ? "default" : "danger"} busy={busy} error={confirmError}
          onConfirm={runConfirmed} onCancel={() => setConfirm(null)}>
          <p>{
            confirm.type === "rest" ? "This day has a workout planned. Making it a rest day removes the planned muscle groups, exercises and cardio."
              : confirm.type === "clear" ? "Remove everything planned for this day, including its title and notes. Your exercise library is not affected."
              : confirm.type === "group" ? `Remove ${confirm.name} and its ${confirm.count} planned exercise(s) from this day? The exercises stay in your library.`
              : confirm.type === "exercise" ? `Remove ${confirm.item.exercise.name} from this day? It stays in your library.`
              : `Remove ${confirm.item.cardio_activity.name} from this day?`
          }</p>
        </ConfirmDialog>
      )}

      {copying && day && (
        <CopyDayDialog cycleId={cycleId} weekNumber={weekNumber} dayOfWeek={dayOfWeek} totalWeeks={totalWeeks}
          onClose={() => setCopying(false)}
          onCopied={(target) => {
            setCopying(false);
            onChanged();
            toast.success(`Copied to ${DAY_NAMES[target.day_of_week]}, week ${target.week_number}.`);
          }} />
      )}
    </Modal>
  );
}
