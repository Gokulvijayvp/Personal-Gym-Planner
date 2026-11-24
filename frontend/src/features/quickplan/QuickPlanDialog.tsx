import { useState } from "react";
import Modal from "../../components/ui/Modal";
import { getErrorMessage } from "../../services/apiError";
import { cycleService } from "../../services/plannerService";
import { startOfWeek, todayISO } from "../../utils/date";

interface Props { onClose: () => void; onCreated: () => void }

const WEEKS = [4, 8, 12];

/** The fastest way to get a plan: starts this Monday, repeats for N weeks, and is switched on straight away. */
export default function QuickPlanDialog({ onClose, onCreated }: Props) {
  const [name, setName] = useState("My plan");
  const [weeks, setWeeks] = useState(4);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (busy) return;
    const trimmed = name.replace(/\s+/g, " ").trim();
    if (trimmed.length < 2) { setError("Give the plan a name of at least 2 letters."); return; }
    setBusy(true); setError(null);
    try {
      const cycle = await cycleService.create({ name: trimmed, description: null, start_date: startOfWeek(todayISO()), total_weeks: weeks });
      await cycleService.activate(cycle.id);
      onCreated();
    } catch (e) {
      setError(getErrorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Modal title="Start a plan" size="sm" onClose={onClose} dismissible={!busy}
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn" onClick={create} disabled={busy}>{busy ? "Creating…" : "Create plan"}</button>
      </>}>
      <form className="ex-form" onSubmit={(e) => { e.preventDefault(); create(); }} noValidate>
        {error && <p className="form-alert" role="alert">{error}</p>}
        <div className="field">
          <label htmlFor="qp-name">Plan name</label>
          <input id="qp-name" value={name} maxLength={120} autoComplete="off" onChange={(e) => setName(e.target.value)} />
        </div>
        <fieldset className="icon-picker">
          <legend>How long?</legend>
          <div className="qp-weeks">
            {WEEKS.map((w) => (
              <label key={w} className={weeks === w ? "icon-choice is-on" : "icon-choice"}>
                <input type="radio" name="qp-weeks" value={w} checked={weeks === w} onChange={() => setWeeks(w)} />
                <b>{w}</b><span>weeks</span>
              </label>
            ))}
          </div>
          <p className="hint">Starts this Monday. You can change everything later.</p>
        </fieldset>
      </form>
    </Modal>
  );
}
