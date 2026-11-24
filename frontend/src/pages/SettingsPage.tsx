import { useCallback, useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { Calendar, Dumbbell, RotateCcw, User } from "lucide-react";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import ErrorState from "../components/ui/ErrorState";
import PageHeader from "../components/ui/PageHeader";
import { useToast } from "../components/ui/Toast";
import ChoiceGroup from "../features/settings/ChoiceGroup";
import DataManagement from "../features/settings/DataManagement";
import {
  DATE_FORMATS, LIMITS, SECTION_TITLES, applySection, describeMinutes, describeSeconds, formatWithPreference,
  isDirty, parseDraft, sectionIsDirty, toDraft, type Draft, type DraftField,
} from "../features/settings/settingsForm";
import { ApiError, getErrorMessage } from "../services/apiError";
import { settingsService } from "../services/settingsService";
import type { ResetSection, Settings } from "../types/settings";
import { todayISO } from "../utils/date";

type Section = Exclude<ResetSection, "all">;
type Errors = Partial<Record<DraftField, string>>;

function DefaultsList({ section }: { section: Section }) {
  const lines: Record<Section, string[]> = {
    workout: ["Rest between sets: 90 s", "Rest between exercises: 120 s", "Workout duration target: 60 min", "Weight in kg, distance in km"],
    calendar: ["First day of week: Monday", "Date format: DD MMM YYYY"],
    personal: ["Display name: cleared"],
  };
  return <ul>{lines[section].map((l) => <li key={l}>{l}</li>)}</ul>;
}

interface FieldProps {
  id: string; label: string; value: string; error?: string; hint?: string; unit?: string; disabled: boolean;
  inputMode?: "numeric" | "text"; maxLength?: number; optional?: boolean; autoComplete?: string;
  onChange: (value: string) => void;
}

function TextField({ id, label, value, error, hint, unit, disabled, inputMode = "text", maxLength, optional, autoComplete, onChange }: FieldProps) {
  const describedBy = [error ? `${id}-err` : null, hint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={error ? "field has-error" : "field"}>
      <label htmlFor={id}>{label}{optional && <span className="optional"> (optional)</span>}</label>
      <div className="input-unit">
        <input id={id} type="text" inputMode={inputMode} enterKeyHint="done" autoComplete={autoComplete ?? "off"}
          value={value} maxLength={maxLength} disabled={disabled} aria-invalid={error ? true : undefined}
          aria-describedby={describedBy} onChange={(e) => onChange(e.target.value)} />
        {unit && <span className="unit" aria-hidden>{unit}</span>}
      </div>
      {error && <span className="error-text" id={`${id}-err`} role="alert">{error}</span>}
      {hint && <span className="hint" id={`${id}-hint`}>{hint}</span>}
    </div>
  );
}

function ConfigureTab() {
  const toast = useToast();
  const uid = useId();
  const [saved, setSaved] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [serverErrors, setServerErrors] = useState<Errors>({});

  const [resetting, setResetting] = useState<Section | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoadError(null);
    settingsService.get(controller.signal)
      .then((s) => { setSaved(s); setDraft(toDraft(s)); })
      .catch((e: unknown) => { if (!controller.signal.aborted) setLoadError(getErrorMessage(e)); });
    return () => controller.abort();
  }, [attempt]);

  const dirty = saved !== null && draft !== null && isDirty(draft, saved);

  // Browsers show their own "leave site?" prompt while there are unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const parsed = useMemo(() => (draft ? parseDraft(draft) : null), [draft]);
  const errors: Errors = { ...(showErrors ? parsed?.errors : {}), ...serverErrors };

  const edit = useCallback(<K extends DraftField>(field: K, value: Draft[K]) => {
    setDraft((d) => (d ? { ...d, [field]: value } : d));
    setServerErrors((e) => { if (!(field in e)) return e; const { [field]: _gone, ...rest } = e; return rest; });
    setSaveError(null);
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving || !draft || !parsed) return;
    if (!parsed.values) {
      setShowErrors(true);
      setSaveError("Fix the highlighted fields, then save again.");
      requestAnimationFrame(() => document.querySelector<HTMLElement>(".settings-form .has-error input")?.focus());
      return;
    }
    setSaving(true);
    setSaveError(null);
    setServerErrors({});
    try {
      const result = await settingsService.update(parsed.values);
      setSaved(result);
      setDraft(toDraft(result));
      setShowErrors(false);
      toast.success("Settings saved.");
    } catch (e) {
      if (e instanceof ApiError && e.kind === "validation") {
        setServerErrors(e.fieldErrors as Errors);
        setSaveError("Some values were not accepted. Check the highlighted fields.");
      } else {
        setSaveError(getErrorMessage(e));
      }
    } finally {
      setSaving(false);
    }
  }

  async function confirmReset() {
    if (!resetting || !draft || resetBusy) return;
    setResetBusy(true);
    setResetError(null);
    try {
      const result = await settingsService.reset(resetting);
      setSaved(result);
      // Only this section is replaced; edits waiting in other sections are kept.
      setDraft((d) => (d ? applySection(d, toDraft(result), resetting) : d));
      setServerErrors({});
      toast.success(`${SECTION_TITLES[resetting]} restored to defaults.`);
      setResetting(null);
    } catch (e) {
      setResetError(getErrorMessage(e));
    } finally {
      setResetBusy(false);
    }
  }

  function discard() {
    if (!saved) return;
    setDraft(toDraft(saved));
    setShowErrors(false);
    setServerErrors({});
    setSaveError(null);
  }

  if (loadError) {
    return (
      <section className="panel page-empty">
        <ErrorState title="Couldn't load your settings" message={loadError} onRetry={() => setAttempt((n) => n + 1)} />
      </section>
    );
  }
  if (!saved || !draft) {
    return (
      <div className="settings-stack" aria-busy="true" role="status" aria-label="Loading settings">
        {[0, 1, 2].map((i) => <div key={i} className="skeleton settings-skeleton" />)}
      </div>
    );
  }

  const busy = saving || resetBusy;
  const today = todayISO();
  const sectionBtn = (section: Section) => (
    <button type="button" className="btn btn-ghost btn-sm" disabled={busy}
      onClick={() => { setResetError(null); setResetting(section); }}
      aria-label={`Reset ${SECTION_TITLES[section]} to defaults`}>
      <RotateCcw size={14} /> Reset section
    </button>
  );
  const unitNote = "Units change how values are shown (80 kg appears as 176.4 lbs). Saved plans and workouts stay stored in kg and km and are never edited.";

  return (
    <>
      <form className="settings-form" onSubmit={onSubmit} noValidate aria-label="Settings">
        <div className="settings-stack">
          {/* ---- A. Workout ---- */}
          <section className="panel settings-card" aria-labelledby={`${uid}-workout`}>
            <header className="settings-card-head">
              <span className="settings-icon"><Dumbbell size={18} /></span>
              <div><h2 id={`${uid}-workout`}>Workout Preferences</h2><p>Defaults suggested when you log workouts.</p></div>
              {sectionBtn("workout")}
            </header>
            <div className="settings-grid">
              <TextField id={`${uid}-rest-sets`} label="Rest between sets" unit="seconds" inputMode="numeric" maxLength={4}
                value={draft.rest_between_sets_seconds} error={errors.rest_between_sets_seconds} disabled={busy}
                hint={describeSeconds(draft.rest_between_sets_seconds) || `0 to ${LIMITS.restMax} seconds`}
                onChange={(v) => edit("rest_between_sets_seconds", v)} />
              <TextField id={`${uid}-rest-ex`} label="Rest between exercises" unit="seconds" inputMode="numeric" maxLength={4}
                value={draft.rest_between_exercises_seconds} error={errors.rest_between_exercises_seconds} disabled={busy}
                hint={describeSeconds(draft.rest_between_exercises_seconds) || `0 to ${LIMITS.restMax} seconds`}
                onChange={(v) => edit("rest_between_exercises_seconds", v)} />
              <TextField id={`${uid}-target`} label="Workout duration target" unit="minutes" inputMode="numeric" maxLength={3}
                value={draft.target_workout_minutes} error={errors.target_workout_minutes} disabled={busy}
                hint={describeMinutes(draft.target_workout_minutes) || `1 to ${LIMITS.minutesMax} minutes`}
                onChange={(v) => edit("target_workout_minutes", v)} />
            </div>
            <div className="settings-grid">
              <ChoiceGroup legend="Weight unit" name={`${uid}-weight`} value={draft.weight_unit} disabled={busy}
                options={[{ value: "kg", label: "kg" }, { value: "lbs", label: "lbs" }]} onChange={(v) => edit("weight_unit", v)} />
              <ChoiceGroup legend="Distance unit" name={`${uid}-distance`} value={draft.distance_unit} disabled={busy}
                options={[{ value: "km", label: "km" }, { value: "miles", label: "miles" }]} onChange={(v) => edit("distance_unit", v)} />
            </div>
            <p className="settings-note">{unitNote}</p>
          </section>

          {/* ---- B. Calendar ---- */}
          <section className="panel settings-card" aria-labelledby={`${uid}-calendar`}>
            <header className="settings-card-head">
              <span className="settings-icon"><Calendar size={18} /></span>
              <div><h2 id={`${uid}-calendar`}>Calendar Preferences</h2><p>How dates are shown.</p></div>
              {sectionBtn("calendar")}
            </header>
            <ChoiceGroup legend="First day of week" name={`${uid}-week`} value={draft.week_start} disabled={busy}
              options={[{ value: "monday", label: "Monday" }, { value: "sunday", label: "Sunday" }]}
              onChange={(v) => edit("week_start", v)}
              help="Saved as your preference. The Calendar and cycle planning stay Monday-first so cycle dates remain correct." />
            <ChoiceGroup legend="Date format" name={`${uid}-date`} value={draft.date_format} disabled={busy}
              options={DATE_FORMATS.map((f) => ({ value: f, label: f, hint: formatWithPreference(today, f) }))}
              onChange={(v) => edit("date_format", v)}
              help="Display only. Stored dates stay in YYYY-MM-DD and the Asia/Kolkata timezone is unchanged." />
            <p className="settings-preview" aria-live="polite">
              Today would read: <b data-testid="date-preview">{formatWithPreference(today, draft.date_format)}</b>
            </p>
          </section>

          {/* ---- C. Personal ---- */}
          <section className="panel settings-card" aria-labelledby={`${uid}-personal`}>
            <header className="settings-card-head">
              <span className="settings-icon"><User size={18} /></span>
              <div><h2 id={`${uid}-personal`}>Personal Preferences</h2><p>There is no account or login in this app.</p></div>
              {sectionBtn("personal")}
            </header>
            <TextField id={`${uid}-name`} label="Display name" optional maxLength={LIMITS.nameMax + 20} autoComplete="nickname"
              value={draft.display_name} error={errors.display_name} disabled={busy}
              hint={`Up to ${LIMITS.nameMax} characters.`} onChange={(v) => edit("display_name", v)} />
            <p className="settings-note">Weight and distance units are set under Workout Preferences.</p>
          </section>

          <DataManagement />
        </div>

        {/* ---- save bar ---- */}
        <div className={dirty ? "save-bar is-dirty" : "save-bar"} role="group" aria-label="Save settings">
          <p className="save-status" role="status" aria-live="polite">
            {saving ? "Saving…" : dirty ? <><i className="status-dot" /> Unsaved changes</> : "All changes saved"}
          </p>
          {saveError && <p className="save-error" role="alert">{saveError}</p>}
          <div className="save-actions">
            <button type="button" className="btn btn-ghost" onClick={discard} disabled={!dirty || busy}>Discard changes</button>
            <button type="submit" className="btn" disabled={!dirty || busy}>{saving ? "Saving…" : "Save changes"}</button>
          </div>
        </div>
      </form>

      {resetting && (
        <ConfirmDialog title={`Reset ${SECTION_TITLES[resetting]}?`} confirmLabel="Reset to defaults" tone="danger"
          busy={resetBusy} error={resetError} onConfirm={confirmReset} onCancel={() => setResetting(null)}>
          <p>This restores the following defaults and saves them straight away:</p>
          <DefaultsList section={resetting} />
          {sectionIsDirty(draft, saved, resetting) && <p><b>Edits you haven't saved in this section will be lost.</b></p>}
          <p>Your plans, cycles, exercises and workout history are not affected.</p>
        </ConfirmDialog>
      )}
    </>
  );
}

export default function SettingsPage() {
  return (
    <>
      <PageHeader eyebrow="PREFERENCES" title="Settings"
        description="Defaults and display preferences for your planner. Changing them never alters saved plans or past workouts." />
      <ConfigureTab />
    </>
  );
}
