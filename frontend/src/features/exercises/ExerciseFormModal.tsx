import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import Modal from "../../components/ui/Modal";
import { ApiError, getErrorMessage } from "../../services/apiError";
import { exerciseService } from "../../services/exerciseService";
import { exerciseMasterService } from "../../services/exerciseMasterService";
import type { ExerciseMaster } from "../../types/exerciseMaster";
import ExerciseIcon from "../masters/ExerciseIcon";
import type { Exercise, MuscleGroup, WorkoutType } from "../../types/exercise";
import { targetAreaOptions } from "./exerciseFilters";
import {
  EMPTY_FORM, LIMITS, toInput, validateForm, valuesFromExercise, withPrimaryMuscle,
  type ExerciseFormValues, type FormErrors,
} from "./exerciseForm";

interface Props {
  /** Present = edit, absent = create. */
  exercise?: Exercise;
  muscleGroups: MuscleGroup[];
  workoutTypes: WorkoutType[];
  onClose: () => void;
  onSaved: (saved: Exercise, mode: "created" | "updated") => void;
}

function Field({ id, label, error, hint, required, children }: {
  id: string; label: string; error?: string; hint?: string; required?: boolean; children: ReactNode;
}) {
  return (
    <div className={error ? "field has-error" : "field"}>
      <label htmlFor={id}>{label}{required && <span className="req" aria-hidden> *</span>}</label>
      {children}
      {hint && !error && <small className="hint" id={`${id}-hint`}>{hint}</small>}
      {error && <small className="error-text" id={`${id}-error`} role="alert">{error}</small>}
    </div>
  );
}

export default function ExerciseFormModal({ exercise, muscleGroups, workoutTypes, onClose, onSaved }: Props) {
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;
  const isEdit = Boolean(exercise);

  const [values, setValues] = useState<ExerciseFormValues>(exercise ? valuesFromExercise(exercise) : EMPTY_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Optional details stay folded away for a new exercise; editing, or an error in one of them, opens the section.
  const [moreOpen, setMoreOpen] = useState(isEdit);

  // Names from the master list, offered as suggestions. If it can't be loaded the field simply works as before.
  const [masters, setMasters] = useState<ExerciseMaster[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    exerciseMasterService.list(controller.signal).then((r) => setMasters(r?.items ?? [])).catch(() => undefined);
    return () => controller.abort();
  }, []);
  const typed = values.name.replace(/\s+/g, " ").trim().toLowerCase();
  const matched = typed ? masters.find((m) => m.name.toLowerCase() === typed) : undefined;

  const set = <K extends keyof ExerciseFormValues>(key: K, value: ExerciseFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));
  const clearError = (key: keyof FormErrors) => setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));

  const areaGroups = targetAreaOptions(muscleGroups, values.muscleGroupId);
  const areas = areaGroups.flatMap((g) => g.areas);
  const secondaryChoices = muscleGroups.filter((g) => String(g.id) !== values.muscleGroupId);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSubmitError(null);
    const found = validateForm(values, muscleGroups);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      // Move focus to the first invalid field so keyboard / screen-reader users land on it.
      const order: (keyof FormErrors)[] = ["name", "muscle_group_id", "target_area_id", "media_url", "description", "instructions"];
      const first = order.find((k) => found[k]);
      if (first) {
        const optional = first !== "name" && first !== "muscle_group_id";
        if (optional) setMoreOpen(true);
        setTimeout(() => document.getElementById(id(first))?.focus(), 0);
      }
      return;
    }
    setSaving(true);
    try {
      const input = toInput(values);
      const saved = exercise ? await exerciseService.update(exercise.id, input) : await exerciseService.create(input);
      onSaved(saved, isEdit ? "updated" : "created");
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fieldErrors).length > 0) {
        setErrors(err.fieldErrors as FormErrors);
        if (Object.keys(err.fieldErrors).some((k) => k !== "name" && k !== "muscle_group_id")) setMoreOpen(true);
        setSubmitError(err.kind === "validation" ? "Please fix the highlighted fields." : err.message);
      } else {
        setSubmitError(getErrorMessage(err));
      }
      setSaving(false);
    }
  }

  const describedBy = (name: keyof FormErrors, hasHint = false) =>
    errors[name] ? `${id(name)}-error` : hasHint ? `${id(name)}-hint` : undefined;

  return (
    <Modal
      title={isEdit ? "Edit exercise" : "Add exercise"} onClose={onClose} dismissible={!saving}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" form={id("form")} className="btn" disabled={saving}>
            {saving ? "Saving…" : isEdit ? "Save changes" : "Add exercise"}
          </button>
        </>
      }
    >
      <form id={id("form")} onSubmit={handleSubmit} noValidate className="ex-form">
        {submitError && <p className="form-alert" role="alert">{submitError}</p>}

        <Field id={id("name")} label="Exercise name" required error={errors.name}>
          <input id={id("name")} value={values.name} maxLength={LIMITS.name.max + 40} autoComplete="off"
            list={masters.length ? id("masters") : undefined}
            placeholder="e.g. Barbell Bench Press" aria-invalid={Boolean(errors.name)} aria-describedby={describedBy("name")}
            onChange={(e) => { set("name", e.target.value); clearError("name"); }} />
          {masters.length > 0 && (
            <datalist id={id("masters")}>{masters.map((m) => <option key={m.id} value={m.name} />)}</datalist>
          )}
          {typed.length >= 2 && !errors.name && (
            <span className="name-master" data-testid="name-master" aria-live="polite">
              {matched ? <ExerciseIcon motion={matched.icon_motion} size={32} /> : null}
              {matched ? "From the exercise master" : "New name: it will be added to the exercise master (Settings > Masters)."}
            </span>
          )}
        </Field>

        <Field id={id("muscle_group_id")} label="Primary muscle group" required error={errors.muscle_group_id}>
            <select id={id("muscle_group_id")} value={values.muscleGroupId} aria-invalid={Boolean(errors.muscle_group_id)}
              aria-describedby={describedBy("muscle_group_id")}
              onChange={(e) => {
                setValues((v) => withPrimaryMuscle(v, e.target.value, muscleGroups));
                clearError("muscle_group_id"); clearError("target_area_id"); clearError("secondary_muscle_group_ids");
              }}>
              <option value="">Select muscle group</option>
              {muscleGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </Field>

        <details className="ex-more" open={moreOpen} onToggle={(e) => setMoreOpen((e.currentTarget as HTMLDetailsElement).open)}>
          <summary>More details <span className="optional">(optional)</span></summary>
          <div className="ex-more-body">
          <Field id={id("target_area_id")} label="Target muscle area" error={errors.target_area_id}
            hint={values.muscleGroupId ? undefined : "Choose a primary muscle group first"}>
            <select id={id("target_area_id")} value={values.targetAreaId} disabled={!values.muscleGroupId}
              aria-invalid={Boolean(errors.target_area_id)} aria-describedby={describedBy("target_area_id", !values.muscleGroupId)}
              onChange={(e) => { set("targetAreaId", e.target.value); clearError("target_area_id"); }}>
              <option value="">{values.muscleGroupId ? "Not specified" : "—"}</option>
              {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>

        <Field id={id("workout_type_id")} label="Workout type / equipment" error={errors.workout_type_id}>
          <select id={id("workout_type_id")} value={values.workoutTypeId} aria-invalid={Boolean(errors.workout_type_id)}
            aria-describedby={describedBy("workout_type_id")}
            onChange={(e) => { set("workoutTypeId", e.target.value); clearError("workout_type_id"); }}>
            <option value="">Not specified</option>
            {workoutTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>

        <fieldset className="field chip-field" aria-describedby={errors.secondary_muscle_group_ids ? id("secondary-error") : undefined}>
          <legend>Secondary muscle groups <span className="optional">(optional)</span></legend>
          <div className="chips">
            {secondaryChoices.map((g) => {
              const checked = values.secondaryIds.includes(g.id);
              return (
                <label key={g.id} className={checked ? "chip checked" : "chip"}>
                  <input type="checkbox" checked={checked} onChange={() => {
                    set("secondaryIds", checked ? values.secondaryIds.filter((i) => i !== g.id) : [...values.secondaryIds, g.id]);
                    clearError("secondary_muscle_group_ids");
                  }} />
                  {g.name}
                </label>
              );
            })}
          </div>
          {errors.secondary_muscle_group_ids && <small className="error-text" id={id("secondary-error")} role="alert">{errors.secondary_muscle_group_ids}</small>}
        </fieldset>

        <Field id={id("description")} label="Description" error={errors.description}>
          <textarea id={id("description")} rows={2} value={values.description} placeholder="Short summary (optional)"
            aria-invalid={Boolean(errors.description)} aria-describedby={describedBy("description")}
            onChange={(e) => { set("description", e.target.value); clearError("description"); }} />
        </Field>

        <Field id={id("instructions")} label="Instructions" error={errors.instructions}>
          <textarea id={id("instructions")} rows={4} value={values.instructions}
            placeholder="How to perform the exercise (optional)" aria-invalid={Boolean(errors.instructions)}
            aria-describedby={describedBy("instructions")}
            onChange={(e) => { set("instructions", e.target.value); clearError("instructions"); }} />
        </Field>

        <Field id={id("media_url")} label="Image URL" error={errors.media_url} hint="Optional link to an image or demo">
          <input id={id("media_url")} type="url" inputMode="url" value={values.mediaUrl} placeholder="https://…"
            autoComplete="off" aria-invalid={Boolean(errors.media_url)} aria-describedby={describedBy("media_url", true)}
            onChange={(e) => { set("mediaUrl", e.target.value); clearError("media_url"); }} />
        </Field>

        <label className="switch-row">
          <input type="checkbox" role="switch" checked={values.isActive} onChange={(e) => set("isActive", e.target.checked)} />
          <span className="switch" aria-hidden />
          <span>
            <b>Active</b>
            <small>Inactive exercises stay in your library but are hidden from new plans.</small>
          </span>
        </label>
          </div>
        </details>
      </form>
    </Modal>
  );
}
