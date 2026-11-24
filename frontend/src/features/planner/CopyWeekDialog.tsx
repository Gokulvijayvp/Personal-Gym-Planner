import { useState } from "react";
import Modal from "../../components/ui/Modal";
import { ApiError, getErrorMessage } from "../../services/apiError";
import { plannerService } from "../../services/plannerService";
import type { CopyResult } from "../../types/planner";

interface Props {
  cycleId: number;
  weekNumber: number;
  totalWeeks: number;
  onClose: () => void;
  onCopied: (result: CopyResult) => void;
}

export default function CopyWeekDialog({ cycleId, weekNumber, totalWeeks, onClose, onCopied }: Props) {
  const others = Array.from({ length: totalWeeks }, (_, i) => i + 1).filter((w) => w !== weekNumber);
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsOverwrite, setNeedsOverwrite] = useState(false);

  const toggle = (w: number) => {
    setSelected((s) => (s.includes(w) ? s.filter((x) => x !== w) : [...s, w].sort((a, b) => a - b)));
    setNeedsOverwrite(false);
    setError(null);
  };

  async function copy(overwrite: boolean) {
    setBusy(true);
    setError(null);
    try {
      onCopied(await plannerService.copyWeek(cycleId, weekNumber, selected, overwrite));
    } catch (e) {
      setNeedsOverwrite(e instanceof ApiError && e.code === "target_not_empty");
      setError(getErrorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Modal title="Copy week" size="sm" onClose={onClose} dismissible={!busy} closeOnBackdrop
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          {needsOverwrite
            ? <button type="button" className="btn btn-danger" onClick={() => copy(true)} disabled={busy}>Replace them</button>
            : <button type="button" className="btn" onClick={() => copy(false)} disabled={busy || selected.length === 0}>
              {busy ? "Copying…" : selected.length === 0 ? "Copy week" : `Copy to ${selected.length} week${selected.length === 1 ? "" : "s"}`}</button>}
        </>
      }>
      <p className="confirm-text">
        Copy everything planned in <b>week {weekNumber}</b> to the weeks you choose. Each copy is independent, so editing
        one week never changes another.
      </p>
      {others.length === 0 ? (
        <p className="muted-note">This cycle has only one week.</p>
      ) : (
        <fieldset className="field chip-field">
          <legend>Copy to</legend>
          <div className="chips">
            {others.map((w) => (
              <label key={w} className={selected.includes(w) ? "chip checked" : "chip"}>
                <input type="checkbox" checked={selected.includes(w)} disabled={busy} onChange={() => toggle(w)} />
                Week {w}
              </label>
            ))}
          </div>
          <button type="button" className="link-btn" disabled={busy}
            onClick={() => { setSelected(others); setNeedsOverwrite(false); setError(null); }}>Select all other weeks</button>
        </fieldset>
      )}
      {error && <p className="form-alert" role="alert">{error}</p>}
    </Modal>
  );
}
