import { useMemo, useState } from "react";
import { Ban, Check, ChevronDown, ChevronUp, NotebookPen, Plus, RotateCcw, Trash2, X } from "lucide-react";
import type { DisplayPrefs } from "../home/prefs";
import type { LoggedExercise, LoggedSet, LogStatus } from "../../types/workout";
import NumberField from "./NumberField";
import { parseWholeNumber, weightLabel, weightToCanonical, weightToInput } from "./units";

export interface ExerciseActions {
  editSet: (setId: number, patch: Record<string, unknown>, immediate?: boolean) => void;
  editExercise: (exerciseId: number, patch: Record<string, unknown>, immediate?: boolean) => void;
  addSet: (exerciseId: number) => void;
  removeSet: (setId: number) => void;
  removeExercise: (exerciseId: number) => void;
  move: (exerciseId: number, delta: -1 | 1) => void;
  typing: (on: boolean) => void;
}

interface Props {
  exercise: LoggedExercise;
  index: number;
  count: number;
  prefs: DisplayPrefs;
  readOnly: boolean;
  actions: ExerciseActions;
}

const STATUS_LABEL: Record<LogStatus, string> = { pending: "To do", completed: "Done", skipped: "Skipped" };

export function targetText(e: { target_sets: number | null; target_reps: string | null; target_weight_kg: number | null }, prefs: DisplayPrefs): string | null {
  if (e.target_sets === null && e.target_reps === null && e.target_weight_kg === null) return null;
  const parts = [e.target_sets !== null && e.target_reps ? `${e.target_sets} × ${e.target_reps}` : e.target_reps ? `${e.target_reps} reps` : e.target_sets !== null ? `${e.target_sets} sets` : null,
    e.target_weight_kg !== null ? weightLabel(e.target_weight_kg, prefs.weightUnit) : null].filter(Boolean);
  return parts.join(" @ ");
}

function SetRow({ s, exercise, prefs, readOnly, actions }: { s: LoggedSet; exercise: LoggedExercise; prefs: DisplayPrefs; readOnly: boolean; actions: ExerciseActions }) {
  const [noteOpen, setNoteOpen] = useState(false);
  const unit = prefs.weightUnit;
  const weightText = useMemo(() => (kg: number | null) => weightToInput(kg, unit), [unit]);
  const weightParse = useMemo(() => (t: string) => weightToCanonical(t, unit), [unit]);
  const reps = useMemo(() => (t: string) => parseWholeNumber(t, 1000), []);
  const rest = useMemo(() => (t: string) => parseWholeNumber(t, 7200), []);
  const plain = useMemo(() => (v: number | null) => (v === null ? "" : String(v)), []);
  const target = [s.target_reps ? `${s.target_reps} reps` : null, s.target_weight_kg !== null ? weightLabel(s.target_weight_kg, unit) : null].filter(Boolean).join(" × ");
  const toggle = (status: LogStatus) => actions.editSet(s.id, { status: s.status === status ? "pending" : status }, true);

  return (
    <li className={`set-row status-${s.status}`} data-testid={`set-${s.id}`}>
      <div className="set-head">
        <b className="set-no">Set {s.set_number}</b>
        <span className="set-target">{target ? `Target ${target}` : "No target"}</span>
        <span className={`log-chip chip-${s.status}`}>{STATUS_LABEL[s.status]}</span>
      </div>
      <div className="set-inputs">
        <NumberField label={`Set ${s.set_number} reps`} showLabel value={s.actual_reps} toText={plain} parse={reps} inputMode="numeric"
          disabled={readOnly} placeholder={s.target_reps && /^\d+$/.test(s.target_reps) ? s.target_reps : "—"} maxLength={4}
          onTyping={actions.typing} onCommit={(v, now) => actions.editSet(s.id, { actual_reps: v }, now)} />
        <NumberField label={`Set ${s.set_number} weight (${unit})`} showLabel value={s.actual_weight_kg} toText={weightText} parse={weightParse}
          unit={unit} disabled={readOnly} placeholder={s.target_weight_kg !== null ? weightToInput(s.target_weight_kg, unit) : "BW"} maxLength={8}
          onTyping={actions.typing} onCommit={(v, now) => actions.editSet(s.id, { actual_weight_kg: v }, now)} />
        <NumberField label={`Set ${s.set_number} rest (seconds)`} showLabel value={s.rest_seconds} toText={plain} parse={rest} inputMode="numeric"
          unit="sec" disabled={readOnly} placeholder={String(exercise.target_rest_seconds ?? prefs.restBetweenSetsSeconds)} maxLength={4}
          onTyping={actions.typing} onCommit={(v, now) => actions.editSet(s.id, { rest_seconds: v }, now)} />
      </div>
      {!readOnly ? (
        <div className="set-actions">
          <button type="button" className={`btn btn-sm set-done${s.status === "completed" ? " is-on" : " btn-outline"}`} aria-pressed={s.status === "completed"}
            aria-label={`${s.status === "completed" ? "Undo done for" : "Mark"} set ${s.set_number}${s.status === "completed" ? "" : " done"}`} onClick={() => toggle("completed")}>
            <Check size={16} aria-hidden /> {s.status === "completed" ? "Done" : "Mark done"}
          </button>
          <button type="button" className={`btn btn-sm btn-outline${s.status === "skipped" ? " is-skipped" : ""}`} aria-pressed={s.status === "skipped"}
            aria-label={`${s.status === "skipped" ? "Unskip" : "Skip"} set ${s.set_number}`} onClick={() => toggle("skipped")}>
            <Ban size={15} aria-hidden /> {s.status === "skipped" ? "Skipped" : "Skip"}
          </button>
          <button type="button" className="icon-btn icon-btn-plain" aria-label={`Note for set ${s.set_number}`} aria-expanded={noteOpen} onClick={() => setNoteOpen((o) => !o)}>
            <NotebookPen size={16} />
          </button>
          <button type="button" className="icon-btn icon-btn-plain danger" aria-label={`Remove set ${s.set_number}`} onClick={() => actions.removeSet(s.id)}>
            <Trash2 size={16} />
          </button>
        </div>
      ) : null}
      {(noteOpen || s.notes) && (
        <textarea className="set-note" aria-label={`Set ${s.set_number} note`} rows={2} maxLength={2000} placeholder="Note for this set" disabled={readOnly}
          defaultValue={s.notes ?? ""} onChange={(e) => actions.editSet(s.id, { notes: e.target.value.trim() === "" ? null : e.target.value })} />
      )}
    </li>
  );
}

export default function ExerciseCard({ exercise: e, index, count, prefs, readOnly, actions }: Props) {
  const target = targetText(e, prefs);
  const [noteOpen, setNoteOpen] = useState(false);
  const setStatus = (status: LogStatus) => actions.editExercise(e.id, { status: e.status === status ? "pending" : status }, true);
  const doneSets = e.sets.filter((s) => s.status === "completed").length;

  return (
    <article className={`panel ex-log status-${e.status}`} aria-label={e.exercise_name} data-testid={`exercise-${e.id}`}>
      <header className="ex-log-head">
        <div className="ex-log-title">
          <h3>{e.exercise_name}</h3>
          <p className="ex-log-sub">
            {[e.muscle_group_name, e.workout_type_name].filter(Boolean).join(" · ")}
            {e.exercise_id === null && <span className="log-chip chip-muted">Removed from library</span>}
          </p>
          <p className="ex-log-target">{e.from_plan ? (target ? `Planned: ${target}` : "Planned") : "Added during this workout"}</p>
          {e.plan_notes && <p className="ex-log-plan-note">Plan note: {e.plan_notes}</p>}
        </div>
        <div className="ex-log-side">
          <span className={`log-chip chip-${e.status}`}>{STATUS_LABEL[e.status]}</span>
          <span className="ex-log-progress">{doneSets}/{e.sets.length} sets</span>
        </div>
      </header>

      <ol className="set-list" aria-label={`${e.exercise_name} sets`}>
        {e.sets.map((s) => <SetRow key={s.id} s={s} exercise={e} prefs={prefs} readOnly={readOnly} actions={actions} />)}
      </ol>
      {e.sets.length === 0 && <p className="home-note">No sets yet.</p>}

      {!readOnly && (
        <div className="ex-log-actions">
          <button type="button" className="btn btn-outline" onClick={() => actions.addSet(e.id)}><Plus size={16} aria-hidden /> Add set</button>
          <button type="button" className={`btn${e.status === "completed" ? " is-on" : " btn-outline"}`} aria-pressed={e.status === "completed"} onClick={() => setStatus("completed")}>
            {e.status === "completed" ? <><RotateCcw size={15} aria-hidden /> Reopen exercise</> : <><Check size={16} aria-hidden /> Complete exercise</>}
          </button>
          <button type="button" className={`btn btn-outline${e.status === "skipped" ? " is-skipped" : ""}`} aria-pressed={e.status === "skipped"} onClick={() => setStatus("skipped")}>
            <Ban size={15} aria-hidden /> {e.status === "skipped" ? "Unskip exercise" : "Skip exercise"}
          </button>
          <span className="ex-log-tools">
            <button type="button" className="icon-btn" aria-label={`Move ${e.exercise_name} up`} disabled={index === 0} onClick={() => actions.move(e.id, -1)}><ChevronUp size={18} /></button>
            <button type="button" className="icon-btn" aria-label={`Move ${e.exercise_name} down`} disabled={index === count - 1} onClick={() => actions.move(e.id, 1)}><ChevronDown size={18} /></button>
            <button type="button" className="icon-btn" aria-label={`Note for ${e.exercise_name}`} aria-expanded={noteOpen} onClick={() => setNoteOpen((o) => !o)}><NotebookPen size={17} /></button>
            <button type="button" className="icon-btn danger" aria-label={`Remove ${e.exercise_name}`} onClick={() => actions.removeExercise(e.id)}><X size={18} /></button>
          </span>
        </div>
      )}
      {(noteOpen || e.notes) && (
        <label className="ex-note">
          <span>Exercise notes</span>
          <textarea rows={2} maxLength={2000} placeholder="How did it feel? Form cues, pain, equipment…" disabled={readOnly} defaultValue={e.notes ?? ""}
            onChange={(ev) => actions.editExercise(e.id, { notes: ev.target.value.trim() === "" ? null : ev.target.value })} />
        </label>
      )}
    </article>
  );
}
