import { useMemo, useState } from "react";
import { Ban, Check, HeartPulse, NotebookPen, RotateCcw, X } from "lucide-react";
import type { DisplayPrefs } from "../home/prefs";
import type { LoggedCardio, LogStatus } from "../../types/workout";
import NumberField from "./NumberField";
import { distanceLabel, distanceToCanonical, distanceToInput, parseWholeNumber, speedToCanonical, speedToInput, speedUnit } from "./units";

interface Props {
  cardio: LoggedCardio;
  prefs: DisplayPrefs;
  readOnly: boolean;
  edit: (cardioId: number, patch: Record<string, unknown>, immediate?: boolean) => void;
  remove: (cardioId: number) => void;
  typing: (on: boolean) => void;
}

const STATUS_LABEL: Record<LogStatus, string> = { pending: "To do", completed: "Done", skipped: "Skipped" };

export default function CardioCard({ cardio: c, prefs, readOnly, edit, remove, typing }: Props) {
  const [noteOpen, setNoteOpen] = useState(false);
  const du = prefs.distanceUnit;
  const minutes = useMemo(() => (t: string) => parseWholeNumber(t, 1440), []);
  const calories = useMemo(() => (t: string) => parseWholeNumber(t, 20000), []);
  const plain = useMemo(() => (v: number | null) => (v === null ? "" : String(v)), []);
  const distText = useMemo(() => (v: number | null) => distanceToInput(v, du), [du]);
  const distParse = useMemo(() => (t: string) => distanceToCanonical(t, du), [du]);
  const spdText = useMemo(() => (v: number | null) => speedToInput(v, du), [du]);
  const spdParse = useMemo(() => (t: string) => speedToCanonical(t, du), [du]);
  const toggle = (status: LogStatus) => edit(c.id, { status: c.status === status ? "pending" : status }, true);
  const target = c.from_plan
    ? [c.target_duration_minutes !== null ? `${c.target_duration_minutes} min` : null, c.target_distance_km !== null ? distanceLabel(c.target_distance_km, du) : null].filter(Boolean).join(" · ")
    : null;

  return (
    <article className={`panel ex-log cardio-log status-${c.status}`} aria-label={`${c.activity_name} cardio`} data-testid={`cardio-${c.id}`}>
      <header className="ex-log-head">
        <div className="ex-log-title">
          <h3><HeartPulse size={16} aria-hidden /> {c.activity_name}</h3>
          <p className="ex-log-target">{c.from_plan ? `Planned: ${target || "cardio"}` : "Added during this workout"}</p>
          {c.plan_notes && <p className="ex-log-plan-note">Plan note: {c.plan_notes}</p>}
        </div>
        <div className="ex-log-side"><span className={`log-chip chip-${c.status}`}>{STATUS_LABEL[c.status]}</span></div>
      </header>

      <div className="cardio-inputs">
        <NumberField label={`${c.activity_name} duration (minutes)`} showLabel value={c.duration_minutes} toText={plain} parse={minutes} inputMode="numeric" unit="min"
          disabled={readOnly} placeholder={c.target_duration_minutes !== null ? String(c.target_duration_minutes) : "—"} maxLength={4}
          onTyping={typing} onCommit={(v, now) => edit(c.id, { duration_minutes: v }, now)} />
        <NumberField label={`${c.activity_name} distance (${du})`} showLabel value={c.distance_km} toText={distText} parse={distParse} unit={du}
          disabled={readOnly} placeholder={c.target_distance_km !== null ? distanceToInput(c.target_distance_km, du) : "—"} maxLength={8}
          onTyping={typing} onCommit={(v, now) => edit(c.id, { distance_km: v }, now)} />
        <NumberField label={`${c.activity_name} calories (optional)`} showLabel value={c.calories} toText={plain} parse={calories} inputMode="numeric" unit="kcal"
          disabled={readOnly} placeholder="optional" maxLength={5} onTyping={typing} onCommit={(v, now) => edit(c.id, { calories: v }, now)} />
        <NumberField label={`${c.activity_name} speed (${speedUnit(du)})`} showLabel value={c.speed_kmh} toText={spdText} parse={spdParse} unit={speedUnit(du)}
          disabled={readOnly} placeholder="optional" maxLength={7} onTyping={typing} onCommit={(v, now) => edit(c.id, { speed_kmh: v }, now)} />
        <div className="num-field">
          <label className="num-label" htmlFor={`res-${c.id}`}>{c.activity_name} resistance / incline</label>
          <input id={`res-${c.id}`} type="text" maxLength={40} autoComplete="off" disabled={readOnly} placeholder="e.g. Level 8" defaultValue={c.resistance ?? ""}
            onChange={(e) => edit(c.id, { resistance: e.target.value.trim() === "" ? null : e.target.value })} />
        </div>
      </div>

      {!readOnly && (
        <div className="ex-log-actions">
          <button type="button" className={`btn${c.status === "completed" ? " is-on" : " btn-outline"}`} aria-pressed={c.status === "completed"} onClick={() => toggle("completed")}>
            {c.status === "completed" ? <><RotateCcw size={15} aria-hidden /> Reopen cardio</> : <><Check size={16} aria-hidden /> Complete cardio</>}
          </button>
          <button type="button" className={`btn btn-outline${c.status === "skipped" ? " is-skipped" : ""}`} aria-pressed={c.status === "skipped"} onClick={() => toggle("skipped")}>
            <Ban size={15} aria-hidden /> {c.status === "skipped" ? "Unskip cardio" : "Skip cardio"}
          </button>
          <span className="ex-log-tools">
            <button type="button" className="icon-btn" aria-label={`Note for ${c.activity_name}`} aria-expanded={noteOpen} onClick={() => setNoteOpen((o) => !o)}><NotebookPen size={17} /></button>
            <button type="button" className="icon-btn danger" aria-label={`Remove ${c.activity_name}`} onClick={() => remove(c.id)}><X size={18} /></button>
          </span>
        </div>
      )}
      {(noteOpen || c.notes) && (
        <label className="ex-note">
          <span>Cardio notes</span>
          <textarea rows={2} maxLength={2000} placeholder="Pace, how it felt…" disabled={readOnly} defaultValue={c.notes ?? ""}
            onChange={(e) => edit(c.id, { notes: e.target.value.trim() === "" ? null : e.target.value })} />
        </label>
      )}
    </article>
  );
}
