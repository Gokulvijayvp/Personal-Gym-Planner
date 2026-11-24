import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import Modal from "../../components/ui/Modal";
import { getErrorMessage } from "../../services/apiError";
import { exerciseSetService } from "../../services/exerciseSetService";
import type { Catalogue } from "../../types/catalogue";
import type { ExerciseSet } from "../../types/exerciseSet";
import ExerciseThumb from "./ExerciseThumb";
import { nextSetName } from "./exerciseSetLogic";

interface Props {
  catalogue: Catalogue;
  /** Names already used, to suggest the next free one. */
  existing: ExerciseSet[];
  /** Set to edit; leave out to add a new one. */
  editing?: ExerciseSet;
  onClose: () => void;
  onSaved: (saved: ExerciseSet, wasNew: boolean) => void;
}

/**
 * Add (or edit) a set of exercises. Step 1: which muscle. Step 2: the name, suggested automatically
 * ("Chest A", "Chest B"…) unless switched off. Step 3: tick that muscle's exercises from the catalogue.
 */
export default function ExerciseSetDialog({ catalogue, existing, editing, onClose, onSaved }: Props) {
  const others = useMemo(() => existing.filter((s) => s.id !== editing?.id).map((s) => s.name), [existing, editing]);
  const [muscle, setMuscle] = useState(editing?.muscle_group ?? "");
  const [auto, setAuto] = useState(!editing);
  const [name, setName] = useState(editing?.name ?? "");
  const [picked, setPicked] = useState<string[]>(editing?.exercises.map((e) => e.key) ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choices = useMemo(() => catalogue.items.filter((i) => i.muscle_group === muscle), [catalogue, muscle]);
  const shownName = auto && muscle ? nextSetName(muscle, others) : name;

  function chooseMuscle(m: string) {
    if (m === muscle) return;
    setMuscle(m);
    setPicked([]);                                  // exercises belong to one muscle, so start the list again
    setError(null);
  }
  const toggle = (key: string) => setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]));

  async function save() {
    if (busy) return;
    const finalName = shownName.replace(/\s+/g, " ").trim();
    if (!muscle) { setError("Choose a muscle first."); return; }
    if (!finalName) { setError("Give the set a name."); return; }
    if (picked.length === 0) { setError("Tick at least one exercise."); return; }
    setBusy(true); setError(null);
    try {
      const input = { name: finalName, muscle_group: muscle, exercise_keys: picked };
      const saved = editing ? await exerciseSetService.update(editing.id, input) : await exerciseSetService.create(input);
      onSaved(saved, !editing);
    } catch (e) {
      setError(getErrorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Modal title={editing ? `Edit ${editing.name}` : "Add exercises"} size="lg" onClose={onClose} dismissible={!busy}
      footer={<>
        <span className="qs-summary" aria-live="polite">{picked.length} {picked.length === 1 ? "exercise" : "exercises"} selected</span>
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn" onClick={save} disabled={busy} data-testid="set-save">{busy ? "Saving…" : editing ? "Save" : "Add"}</button>
      </>}>
      <div className="qs">
        {error && <p className="form-alert" role="alert">{error}</p>}

        <div className="field">
          <span className="qs-label" id="set-muscle">1. Which muscle?</span>
          <div className="cat-chips" role="group" aria-labelledby="set-muscle">
            {catalogue.muscle_groups.map((m) => (
              <button key={m} type="button" className={muscle === m ? "cat-chip is-on" : "cat-chip"} aria-pressed={muscle === m} onClick={() => chooseMuscle(m)}>{m}</button>
            ))}
          </div>
        </div>

        {muscle && (
          <>
            <div className="field">
              <label htmlFor="set-name" className="qs-label">2. Name</label>
              <input id="set-name" value={shownName} maxLength={120} autoComplete="off" disabled={auto}
                onChange={(e) => setName(e.target.value)} />
              <label className="qs-radio">
                <input type="checkbox" checked={auto} onChange={(e) => { setAuto(e.target.checked); if (!e.target.checked) setName(shownName); }} />
                <span>Name it automatically ({muscle} A, {muscle} B…)</span>
              </label>
            </div>

            <div className="field">
              <span className="qs-label" id="set-ex">3. Choose {muscle.toLowerCase()} exercises</span>
              <ul className="sx-pick" aria-labelledby="set-ex">
                {choices.map((i) => {
                  const on = picked.includes(i.key);
                  return (
                    <li key={i.key}>
                      <button type="button" className={on ? "sx-row is-on" : "sx-row"} aria-pressed={on} onClick={() => toggle(i.key)}>
                        <span className="qa-icon"><ExerciseThumb item={i} size={36} /></span>
                        <span className="qa-text"><b>{i.name}</b><small>{i.target_area ? `${i.target_area} · ` : ""}{i.equipment}</small></span>
                        <span className="sx-check" aria-hidden>{on && <Check size={16} />}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
