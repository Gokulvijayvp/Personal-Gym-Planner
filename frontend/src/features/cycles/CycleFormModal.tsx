import { useId, useMemo, useState, type FormEvent } from "react";
import Modal from "../../components/ui/Modal";
import { ApiError, getErrorMessage } from "../../services/apiError";
import { cycleService } from "../../services/plannerService";
import type { CycleDetail, CycleSummary } from "../../types/planner";
import { formatDateOnly, todayISO } from "../../utils/date";
import {
  MAX_WEEKS, WEEK_PRESETS, computeEndDate, emptyCycleForm, nextMonday, toCycleInput, validateCycleForm,
  valuesFromCycle, type CycleFormErrors, type CycleFormValues,
} from "./cycleForm";

interface Props {
  /** Present = edit, absent = create. */
  cycle?: CycleSummary;
  onClose: () => void;
  onSaved: (saved: CycleDetail, mode: "created" | "updated") => void;
}

export default function CycleFormModal({ cycle, onClose, onSaved }: Props) {
  const uid = useId();
  const id = (n: string) => `${uid}-${n}`;
  const isEdit = Boolean(cycle);
  const [values, setValues] = useState<CycleFormValues>(cycle ? valuesFromCycle(cycle) : emptyCycleForm());
  const [errors, setErrors] = useState<CycleFormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof CycleFormValues>(k: K, v: CycleFormValues[K]) => setValues((p) => ({ ...p, [k]: v }));
  const clear = (k: keyof CycleFormErrors) => setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));

  const endDate = useMemo(() => computeEndDate(values.startDate, values.totalWeeks), [values.startDate, values.totalWeeks]);
  const mondayHint = useMemo(() => {
    try { return nextMonday(values.startDate || todayISO()); } catch { return null; }
  }, [values.startDate]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSubmitError(null);
    const found = validateCycleForm(values);
    setErrors(found);
    const first = (["name", "start_date", "total_weeks", "description"] as const).find((k) => found[k]);
    if (first) { document.getElementById(id(first))?.focus(); return; }
    setSaving(true);
    try {
      const input = toCycleInput(values);
      const saved = cycle ? await cycleService.update(cycle.id, input) : await cycleService.create(input);
      onSaved(saved, isEdit ? "updated" : "created");
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fieldErrors).length > 0) setErrors(err.fieldErrors as CycleFormErrors);
      setSubmitError(err instanceof ApiError && err.kind === "validation" ? "Please fix the highlighted fields." : getErrorMessage(err));
      setSaving(false);
    }
  }

  const describedBy = (k: keyof CycleFormErrors) => (errors[k] ? `${id(k)}-error` : undefined);
  const fieldClass = (k: keyof CycleFormErrors) => (errors[k] ? "field has-error" : "field");

  return (
    <Modal
      title={isEdit ? "Edit cycle" : "New workout cycle"} onClose={onClose} dismissible={!saving}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" form={id("form")} className="btn" disabled={saving}>
            {saving ? "Saving…" : isEdit ? "Save changes" : "Create cycle"}
          </button>
        </>
      }
    >
      <form id={id("form")} onSubmit={submit} noValidate className="ex-form">
        {submitError && <p className="form-alert" role="alert">{submitError}</p>}

        <div className={fieldClass("name")}>
          <label htmlFor={id("name")}>Cycle name <span className="req" aria-hidden>*</span></label>
          <input id={id("name")} value={values.name} placeholder="e.g. Winter strength block" autoComplete="off"
            aria-invalid={Boolean(errors.name)} aria-describedby={describedBy("name")}
            onChange={(e) => { set("name", e.target.value); clear("name"); }} />
          {errors.name && <small className="error-text" id={id("name-error")} role="alert">{errors.name}</small>}
        </div>

        <div className={fieldClass("start_date")}>
          <label htmlFor={id("start_date")}>Start date <span className="req" aria-hidden>*</span></label>
          <input id={id("start_date")} type="date" value={values.startDate} aria-invalid={Boolean(errors.start_date)}
            aria-describedby={describedBy("start_date")}
            onChange={(e) => { set("startDate", e.target.value); clear("start_date"); }} />
          {errors.start_date && <small className="error-text" id={id("start_date-error")} role="alert">{errors.start_date}</small>}
          <small className="hint">Cycles start on a Monday.
            {mondayHint && mondayHint !== values.startDate && (
              <> <button type="button" className="link-btn" onClick={() => { set("startDate", mondayHint); clear("start_date"); }}>
                Use Monday {formatDateOnly(mondayHint, { day: "numeric", month: "short" })}</button></>
            )}
          </small>
        </div>

        <div className={fieldClass("total_weeks")}>
          <label htmlFor={id("total_weeks")}>Number of weeks <span className="req" aria-hidden>*</span></label>
          <div className="week-presets" role="group" aria-label="Common durations">
            {WEEK_PRESETS.map((n) => (
              <button type="button" key={n} className={values.totalWeeks === String(n) ? "chip checked" : "chip"}
                aria-pressed={values.totalWeeks === String(n)}
                onClick={() => { set("totalWeeks", String(n)); clear("total_weeks"); }}>{n} weeks</button>
            ))}
          </div>
          <input id={id("total_weeks")} type="number" inputMode="numeric" min={1} max={MAX_WEEKS} value={values.totalWeeks}
            aria-invalid={Boolean(errors.total_weeks)} aria-describedby={describedBy("total_weeks")}
            onChange={(e) => { set("totalWeeks", e.target.value); clear("total_weeks"); }} />
          {errors.total_weeks
            ? <small className="error-text" id={id("total_weeks-error")} role="alert">{errors.total_weeks}</small>
            : <small className="hint">Any length from 1 to {MAX_WEEKS} weeks.</small>}
        </div>

        <p className="end-date" data-testid="end-date" aria-live="polite">
          {endDate
            ? <>Ends <b>{formatDateOnly(endDate)}</b> · {values.totalWeeks} week{values.totalWeeks === "1" ? "" : "s"}</>
            : "Choose a start date and number of weeks to see the end date."}
        </p>

        <div className={fieldClass("description")}>
          <label htmlFor={id("description")}>Description</label>
          <textarea id={id("description")} rows={3} value={values.description} placeholder="Goal or focus (optional)"
            aria-invalid={Boolean(errors.description)} aria-describedby={describedBy("description")}
            onChange={(e) => { set("description", e.target.value); clear("description"); }} />
          {errors.description && <small className="error-text" id={id("description-error")} role="alert">{errors.description}</small>}
        </div>
      </form>
    </Modal>
  );
}
