import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { CardioActivity, CardioInput } from "../../types/planner";
import { toCardioInput, validateCardio, type CardioErrors, type CardioFormValues } from "./plannerLogic";

interface Props {
  mode: "add" | "edit";
  initial: CardioFormValues;
  activities: CardioActivity[];
  saving: boolean;
  serverErrors?: CardioErrors;
  formError?: string | null;
  onSubmit: (input: CardioInput) => void;
  onCancel: () => void;
}

export default function CardioForm({ mode, initial, activities, saving, serverErrors, formError, onSubmit, onCancel }: Props) {
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  // An inline form opens inside a scrolling dialog: make sure it is on screen.
  useEffect(() => { formRef.current?.scrollIntoView?.({ block: "nearest" }); }, []);
  const id = (n: string) => `${uid}-${n}`;
  const [values, setValues] = useState<CardioFormValues>(initial);
  const [localErrors, setLocalErrors] = useState<CardioErrors>({});
  const errors = { ...serverErrors, ...localErrors };
  const set = <K extends keyof CardioFormValues>(k: K, v: CardioFormValues[K]) => setValues((p) => ({ ...p, [k]: v }));
  const clear = (k: keyof CardioErrors) => setLocalErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));

  function submit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    const found = validateCardio(values);
    setLocalErrors(found);
    if (Object.keys(found).length > 0) {
      const first = (["cardio_activity_id", "duration_minutes", "distance_km", "notes"] as const).find((k) => found[k]);
      if (first) document.getElementById(id(first))?.focus();
      return;
    }
    onSubmit(toCardioInput(values));
  }

  const field = (k: keyof CardioErrors) => (errors[k] ? "field has-error" : "field");
  const err = (k: keyof CardioErrors) => errors[k] && <small className="error-text" id={id(`${k}-error`)} role="alert">{errors[k]}</small>;
  const desc = (k: keyof CardioErrors) => (errors[k] ? `${id(k)}-error` : undefined);

  return (
    <form ref={formRef} className="assign-form" onSubmit={submit} noValidate aria-label={mode === "add" ? "Add cardio" : "Edit cardio"}>
      <h4>{mode === "add" ? "Add cardio" : "Edit cardio"}</h4>
      {formError && <p className="form-alert" role="alert">{formError}</p>}
      <div className="assign-grid">
        <div className={field("cardio_activity_id")}>
          <label htmlFor={id("cardio_activity_id")}>Activity</label>
          <select id={id("cardio_activity_id")} value={values.activityId} aria-invalid={Boolean(errors.cardio_activity_id)}
            aria-describedby={desc("cardio_activity_id")} onChange={(e) => { set("activityId", e.target.value); clear("cardio_activity_id"); }}>
            <option value="">Select activity</option>
            {activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          {err("cardio_activity_id")}
        </div>
        <div className={field("duration_minutes")}>
          <label htmlFor={id("duration_minutes")}>Duration (minutes)</label>
          <input id={id("duration_minutes")} inputMode="numeric" value={values.minutes} aria-invalid={Boolean(errors.duration_minutes)}
            aria-describedby={desc("duration_minutes")} onChange={(e) => { set("minutes", e.target.value); clear("duration_minutes"); }} />
          {err("duration_minutes")}
        </div>
        <div className={field("distance_km")}>
          <label htmlFor={id("distance_km")}>Distance (km)</label>
          <input id={id("distance_km")} inputMode="decimal" value={values.distance} placeholder="Optional"
            aria-invalid={Boolean(errors.distance_km)} aria-describedby={desc("distance_km")}
            onChange={(e) => { set("distance", e.target.value); clear("distance_km"); }} />
          {err("distance_km")}
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
          {saving ? "Saving…" : mode === "add" ? "Add cardio" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
