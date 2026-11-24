import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDown, ArrowUp, Check, ClipboardPaste, Copy, MoveRight, Moon, Pencil, Plus, Repeat, Trash2, X, Eraser, ExternalLink,
} from "lucide-react";
import Menu, { type MenuItem } from "../../components/ui/Menu";
import type { ScheduledExercise, ScheduledMuscleGroup, DayDetail } from "../../types/planner";
import { parseWholeNumber, weightLabel, weightToCanonical, weightToInput } from "../workout/units";
import type { WeightUnit } from "../../types/settings";
import ExerciseIcon from "../masters/ExerciseIcon";
import ExerciseDetailDialog from "../exercises/ExerciseDetailDialog";
import ExerciseThumb from "../exercises/ExerciseThumb";
import { useCatalogue } from "../exercises/catalogueStore";

export interface TargetEdit { target_sets: number; target_reps: string; target_weight_kg: number | null }

interface Props {
  heading: string;                 // "Today" or "Thursday"
  dateLabel: string;               // "Thu, 20 Nov 2026"
  detail: DayDetail | null;
  loading: boolean;
  busy: boolean;
  weightUnit: WeightUnit;
  iconFor: (name: string) => string | undefined;
  plannerLink: string;
  startSlot?: ReactNode;           // the Start / Resume button (today only)
  onAdd: () => void;
  onReplace: (group: ScheduledMuscleGroup, item: ScheduledExercise) => void;
  onRemove: (item: ScheduledExercise) => void;
  onMove: (group: ScheduledMuscleGroup, item: ScheduledExercise, delta: -1 | 1) => void;
  onSaveTarget: (item: ScheduledExercise, values: TargetEdit) => Promise<void>;
  onRemoveCardio: (id: number) => void;
  onRest: () => void;
  onClear: () => void;
  onCopyTo: () => void;
  onMoveTo: () => void;
  onCopyFrom: () => void;
}

function TargetEditor({ item, unit, onSave, onCancel }: { item: ScheduledExercise; unit: WeightUnit; onSave: (v: TargetEdit) => Promise<void>; onCancel: () => void }) {
  const [sets, setSets] = useState(String(item.target_sets));
  const [reps, setReps] = useState(item.target_reps);
  const [weight, setWeight] = useState(weightToInput(item.target_weight_kg, unit));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    const s = parseWholeNumber(sets, 20);
    const w = weightToCanonical(weight, unit);
    const r = reps.trim();
    if (!s.ok || s.value === null || s.value < 1) { setError("Sets: a whole number from 1 to 20."); return; }
    if (!/^\d{1,3}(\s*[-–]\s*\d{1,3})?$/.test(r)) { setError("Reps: a number like 10 or a range like 8-12."); return; }
    if (!w.ok) { setError(w.message); return; }
    setSaving(true); setError(null);
    try { await onSave({ target_sets: s.value, target_reps: r.replace(/\s+/g, ""), target_weight_kg: w.value }); }
    catch { setSaving(false); }
  }
  return (
    <form className="dp-edit" onSubmit={(e) => { e.preventDefault(); save(); }} aria-label={`Edit ${item.exercise.name}`}>
      <label>Sets<input inputMode="numeric" value={sets} onChange={(e) => setSets(e.target.value)} maxLength={2} /></label>
      <label>Reps<input value={reps} onChange={(e) => setReps(e.target.value)} maxLength={7} /></label>
      <label>Weight ({unit})<input inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="Optional" maxLength={7} /></label>
      <div className="dp-edit-actions">
        <button type="submit" className="btn btn-sm" disabled={saving}><Check size={14} /> Save</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={saving}><X size={14} /> Cancel</button>
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
    </form>
  );
}

/** One day of the plan with one-tap actions on every row. Pure display: all changes go out through the callbacks. */
export default function DayPanel(p: Props) {
  const [editing, setEditing] = useState<number | null>(null);
  const { catalogue, byName } = useCatalogue();
  const [viewing, setViewing] = useState<string | null>(null);      // catalogue key whose pictures / videos are open
  const d = p.detail;
  const planned = d?.status === "planned";
  const hasItems = !!d && (d.strength.some((g) => g.exercises.length > 0) || d.cardio.length > 0);
  const isRest = d?.status === "rest";

  const dayMenu: MenuItem[] = [
    { label: "Copy to another day", icon: <Copy size={16} />, onSelect: p.onCopyTo, disabled: !hasItems && !isRest },
    { label: "Move to another day", icon: <MoveRight size={16} />, onSelect: p.onMoveTo, disabled: !hasItems && !isRest },
    { label: "Fill from another day", icon: <ClipboardPaste size={16} />, onSelect: p.onCopyFrom },
    { label: isRest ? "Make it a workout day" : "Mark as rest day", icon: <Moon size={16} />, onSelect: isRest ? p.onAdd : p.onRest, separated: true },
    { label: "Clear the day", icon: <Eraser size={16} />, onSelect: p.onClear, danger: true, disabled: !d || d.status === "unplanned" },
  ];

  return (
    <section className="panel dp" aria-labelledby="dp-title" data-testid="day-panel" aria-busy={p.loading || p.busy || undefined}>
      <header className="dp-head">
        <div>
          <span className="eyebrow">{p.heading.toUpperCase()}</span>
          <h2 id="dp-title">{d?.display_title || (isRest ? "Rest day" : "Not planned")}</h2>
          <p className="dp-date">{p.dateLabel}</p>
        </div>
        <div className="dp-head-actions">
          {hasItems && !isRest && (
            <button type="button" className="btn btn-sm" onClick={p.onAdd} disabled={p.busy} aria-label="Add exercise" data-testid="day-add">
              <Plus size={16} /> Add
            </button>
          )}
          <Menu label="Day actions" items={dayMenu} />
        </div>
      </header>

      {p.startSlot}

      {!d && p.loading ? <div className="skeleton" style={{ height: 120 }} role="status" aria-label="Loading the day" /> : isRest ? (
        <div className="dp-empty" data-testid="day-rest">
          <Moon size={22} aria-hidden />
          <b>Rest day</b>
          <p>Recovery is part of the plan.</p>
          <button type="button" className="btn btn-outline" onClick={p.onAdd} disabled={p.busy}><Plus size={16} /> Add a workout instead</button>
        </div>
      ) : !hasItems ? (
        <div className="dp-empty" data-testid="day-empty">
          <b>{planned ? "No exercises yet" : "Nothing planned"}</b>
          <p>Add an exercise, copy another day, or mark it as a rest day.</p>
          <div className="dp-empty-actions">
            <button type="button" className="btn" onClick={p.onAdd} disabled={p.busy}><Plus size={16} /> Add exercise</button>
            <button type="button" className="btn btn-outline" onClick={p.onCopyFrom} disabled={p.busy}><ClipboardPaste size={16} /> Copy another day</button>
            <button type="button" className="btn btn-outline" onClick={p.onRest} disabled={p.busy}><Moon size={16} /> Rest day</button>
          </div>
        </div>
      ) : (
        <>
          {d!.strength.filter((g) => g.exercises.length > 0).map((g) => (
            <div key={g.id} className="dp-group">
              <h3>{g.muscle_group.name}</h3>
              <ul className="dp-rows" aria-label={`${g.muscle_group.name} exercises`}>
                {g.exercises.map((e, i) => (
                  <li key={e.id} className="dp-row-wrap" data-testid={`ex-${e.id}`}>
                    <div className="dp-ex">
                      {(() => {
                        const info = byName(e.exercise.name);
                        const thumb = <ExerciseThumb item={info} motion={p.iconFor(e.exercise.name)} size={40} />;
                        return info ? (
                          <button type="button" className="dp-icon dp-icon-btn" aria-label={`Show ${e.exercise.name}`} onClick={() => setViewing(info.key)}>{thumb}</button>
                        ) : <span className="dp-icon">{thumb}</span>;
                      })()}
                      <div className="dp-ex-text">
                        {byName(e.exercise.name)
                          ? <button type="button" className="dp-name" onClick={() => setViewing(byName(e.exercise.name)!.key)}>{e.exercise.name}</button>
                          : <b>{e.exercise.name}</b>}
                        <button type="button" className="dp-target" onClick={() => setEditing(editing === e.id ? null : e.id)}
                          aria-label={`Edit sets and reps of ${e.exercise.name}`}>
                          {e.target_sets} × {e.target_reps}{e.target_weight_kg ? ` · ${weightLabel(e.target_weight_kg, p.weightUnit)}` : ""} <Pencil size={12} aria-hidden />
                        </button>
                      </div>
                      <div className="dp-ex-actions">
                        <button type="button" className="icon-btn" aria-label={`Move ${e.exercise.name} up`} disabled={p.busy || i === 0}
                          onClick={() => p.onMove(g, e, -1)}><ArrowUp size={16} /></button>
                        <button type="button" className="icon-btn" aria-label={`Move ${e.exercise.name} down`} disabled={p.busy || i === g.exercises.length - 1}
                          onClick={() => p.onMove(g, e, 1)}><ArrowDown size={16} /></button>
                        <button type="button" className="icon-btn" aria-label={`Replace ${e.exercise.name}`} disabled={p.busy}
                          onClick={() => p.onReplace(g, e)}><Repeat size={16} /></button>
                        <button type="button" className="icon-btn is-danger" aria-label={`Remove ${e.exercise.name}`} disabled={p.busy}
                          onClick={() => p.onRemove(e)}><Trash2 size={16} /></button>
                      </div>
                      {/* phones: the same four actions behind one small menu, so each exercise stays on one slim row */}
                      <div className="dp-ex-menu">
                        <Menu label={`More actions for ${e.exercise.name}`} items={[
                          { label: "Move up", icon: <ArrowUp size={15} aria-hidden />, disabled: p.busy || i === 0, onSelect: () => p.onMove(g, e, -1) },
                          { label: "Move down", icon: <ArrowDown size={15} aria-hidden />, disabled: p.busy || i === g.exercises.length - 1, onSelect: () => p.onMove(g, e, 1) },
                          { label: "Replace", icon: <Repeat size={15} aria-hidden />, disabled: p.busy, onSelect: () => p.onReplace(g, e) },
                          { label: "Remove", icon: <Trash2 size={15} aria-hidden />, danger: true, separated: true, disabled: p.busy, onSelect: () => p.onRemove(e) },
                        ]} />
                      </div>
                    </div>
                    {editing === e.id && (
                      <TargetEditor item={e} unit={p.weightUnit} onCancel={() => setEditing(null)}
                        onSave={async (v) => { await p.onSaveTarget(e, v); setEditing(null); }} />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {d!.cardio.length > 0 && (
            <div className="dp-group">
              <h3>Cardio</h3>
              <ul className="dp-rows" aria-label="Cardio">
                {d!.cardio.map((c) => (
                  <li key={c.id} className="dp-row-wrap">
                    <div className="dp-ex">
                      <span className="dp-icon"><ExerciseIcon motion="cardio" size={40} /></span>
                      <div className="dp-ex-text"><b>{c.cardio_activity.name}</b><span className="dp-target-static">{c.duration_minutes} min</span></div>
                      <div className="dp-ex-actions">
                        <button type="button" className="icon-btn is-danger" aria-label={`Remove ${c.cardio_activity.name}`} disabled={p.busy}
                          onClick={() => p.onRemoveCardio(c.id)}><Trash2 size={16} /></button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="dp-foot">
            <Link to={p.plannerLink} className="btn btn-ghost btn-sm"><ExternalLink size={14} /> Full editor (cardio, notes)</Link>
          </div>
        </>
      )}
      {viewing && catalogue && catalogue.items.some((i) => i.key === viewing) && (
        <ExerciseDetailDialog item={catalogue.items.find((i) => i.key === viewing)!} motions={catalogue.motions} onClose={() => setViewing(null)} />
      )}
    </section>
  );
}

