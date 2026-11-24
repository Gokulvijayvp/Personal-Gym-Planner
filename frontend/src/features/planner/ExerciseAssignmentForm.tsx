import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { Exercise, MuscleGroup, WorkoutType } from "../../types/exercise";
import type { ExerciseAssignmentInput } from "../../types/planner";
import ExercisePicker from "./ExercisePicker";
import {
  validateAssignment, toAssignmentInput, type AssignmentErrors, type AssignmentFormValues,
} from "./plannerLogic";

interface Props {
  mode: "add" | "edit";
  initial: AssignmentFormValues;
  /** Name shown as "selected" when editing, before the picker list has loaded. */
  initialExerciseName?: string;
  muscleGroupId: number | null;
  muscleGroups: MuscleGroup[];
  workoutTypes: WorkoutType[];
  saving: boolean;
  /** Field errors from the server (same keys as AssignmentErrors). */
  serverErrors?: AssignmentErrors;
  formError?: string | null;
  onSubmit: (input: ExerciseAssignmentInput) => void;
  onCancel: () => void;
}

export default function ExerciseAssignmentForm({
  mode, initial, initialExerciseName, muscleGroupId, muscleGroups, workoutTypes, saving, serverErrors, formError, onSubmit, onCancel,
}: Props) {
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  // An inline form opens inside a scrolling dialog: make sure it is on screen.
  useEffect(() => { formRef.current?.scrollIntoView?.({ block: "nearest" }); }, []);
  const id = (n: string) => `${uid}-${n}`;
  const [values, setValues] = useState<AssignmentFormValues>(initial);
  const [chosen, setChosen] = useState<string | null>(initialExerciseName ?? null);
  const [localErrors, setLocalErrors] = useState<AssignmentErrors>({});
  const errors = { ...serverErrors, ...localErrors };

  const set = <K extends keyof AssignmentFormValues>(k: K, v: AssignmentFormValues[K]) => setValues((p) => ({ ...p, [k]: v }));
  const clear = (k: keyof AssignmentErrors) => setLocalErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));

  function pick(ex: Exercise) {
    setValues((p) => ({ ...p, exerciseId: ex.id }));
    setChosen(ex.name);
    clear("exercise_id");
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    const found = validateAssignment(values);
    setLocalErrors(found);
    if (Object.keys(found).length > 0) {
      const first = (["target_sets", "target_reps", "target_weight_kg", "rest_seconds", "notes"] as const).find((k) => found[k]);
      if (first) document.getElementById(id(first))?.focus();
      return;
    }
    onSubmit(toAssignmentInput(values));
  }

  const field = (k: keyof AssignmentErrors) => (errors[k] ? "field has-error" : "field");
  const err = (k: keyof AssignmentErrors) => errors[k] && <small className="error-text" id={id(`${k}-error`)} role="alert">{errors[k]}</small>;
  const desc = (k: keyof AssignmentErrors) => (errors[k] ? `${id(k)}-error` : undefined);

  return (
    <form ref={formRef} className="assign-form" onSubmit={submit} noValidate aria-label={mode === "add" ? "Add exercise" : "Edit planned exercise"}>
      <h4>{mode === "add" ? "Add exercise" : "Edit exercise"}</h4>
      {formError && <p className="form-alert" role="alert">{formError}</p>}

      <div className={field("exercise_id")}>
        <span className="label-like">Exercise <span className="req" aria-hidden>*</span></span>
        <ExercisePicker muscleGroups={muscleGroups} workoutTypes={workoutTypes} defaultMuscleGroupId={muscleGroupId}
          selectedId={values.exerciseId} onSelect={pick} invalid={Boolean(errors.exercise_id)} />
        {chosen && <p className="picked" data-testid="picked-exercise">Selected: <b>{chosen}</b></p>}
        {err("exercise_id")}
        <small className="hint">Workout type and target area come from the exercise in your library.</small>
      </div>

      <div className="assign-grid">
        <div className={field("target_sets")}>
          <label htmlFor={id("target_sets")}>Sets</label>
          <input id={id("target_sets")} inputMode="numeric" value={values.sets} aria-invalid={Boolean(errors.target_sets)}
            aria-describedby={desc("target_sets")} onChange={(e) => { set("sets", e.target.value); clear("target_sets"); }} />
          {err("target_sets")}
        </div>
        <div className={field("target_reps")}>
          <label htmlFor={id("target_reps")}>Target reps</label>
          <input id={id("target_reps")} value={values.reps} placeholder="10 or 8-12" aria-invalid={Boolean(errors.target_reps)}
            aria-describedby={desc("target_reps")} onChange={(e) => { set("reps", e.target.value); clear("target_reps"); }} />
          {err("target_reps")}
        </div>
        <div className={field("target_weight_kg")}>
          <label htmlFor={id("target_weight_kg")}>Weight (kg)</label>
          <input id={id("target_weight_kg")} inputMode="decimal" value={values.weight} placeholder="Optional"
            aria-invalid={Boolean(errors.target_weight_kg)} aria-describedby={desc("target_weight_kg")}
            onChange={(e) => { set("weight", e.target.value); clear("target_weight_kg"); }} />
          {err("target_weight_kg")}
        </div>
        <div className={field("rest_seconds")}>
          <label htmlFor={id("rest_seconds")}>Rest (seconds)</label>
          <input id={id("rest_seconds")} inputMode="numeric" value={values.rest} placeholder="Optional"
            aria-invalid={Boolean(errors.rest_seconds)} aria-describedby={desc("rest_seconds")}
            onChange={(e) => { set("rest", e.target.value); clear("rest_seconds"); }} />
          {err("rest_seconds")}
        </div>
      </div>

      <div className={field("notes")}>
        <label htmlFor={id("notes")}>Notes</label>
        <textarea id={id("notes")} rows={2} value={values.notes} placeholder="Optional" aria-invalid={Boolean(errors.notes)}
          aria-describedby={desc("notes")} onChange={(e) => { set("notes", e.target.value); clear("notes"); }} />
        {err("notes")}
      </div>

      <div className="assign-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn btn-sm" disabled={saving}>
          {saving ? "Saving…" : mode === "add" ? "Add to day" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
