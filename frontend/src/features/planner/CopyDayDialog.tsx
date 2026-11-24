import { useState } from "react";
import Modal from "../../components/ui/Modal";
import { ApiError, getErrorMessage } from "../../services/apiError";
import { plannerService } from "../../services/plannerService";
import type { DayDetail } from "../../types/planner";
import { DAY_NAMES } from "./plannerLogic";

interface Props {
  cycleId: number;
  weekNumber: number;
  dayOfWeek: number;
  totalWeeks: number;
  onClose: () => void;
  onCopied: (target: DayDetail) => void;
}

export default function CopyDayDialog({ cycleId, weekNumber, dayOfWeek, totalWeeks, onClose, onCopied }: Props) {
  const [targetWeek, setTargetWeek] = useState(weekNumber);
  const [targetDay, setTargetDay] = useState((dayOfWeek + 1) % 7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsOverwrite, setNeedsOverwrite] = useState(false);

  const same = targetWeek === weekNumber && targetDay === dayOfWeek;

  async function copy(overwrite: boolean) {
    setBusy(true);
    setError(null);
    try {
      onCopied(await plannerService.copyDay(cycleId, weekNumber, dayOfWeek, targetWeek, targetDay, overwrite));
    } catch (e) {
      setNeedsOverwrite(e instanceof ApiError && e.code === "target_not_empty");
      setError(getErrorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Modal title="Copy day" size="sm" onClose={onClose} dismissible={!busy} closeOnBackdrop
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          {needsOverwrite
            ? <button type="button" className="btn btn-danger" onClick={() => copy(true)} disabled={busy}>Replace it</button>
            : <button type="button" className="btn" onClick={() => copy(false)} disabled={busy || same}>{busy ? "Copying…" : "Copy day"}</button>}
        </>
      }>
      <p className="confirm-text">
        Copy <b>{DAY_NAMES[dayOfWeek]}, week {weekNumber}</b> to another day. The copy is independent: changing it later
        won't change this day.
      </p>
      <div className="field-row">
        <div className="field">
          <label htmlFor="copy-day-week">Week</label>
          <select id="copy-day-week" value={targetWeek} disabled={busy} onChange={(e) => { setTargetWeek(Number(e.target.value)); setNeedsOverwrite(false); setError(null); }}>
            {Array.from({ length: totalWeeks }, (_, i) => i + 1).map((w) => <option key={w} value={w}>Week {w}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="copy-day-day">Day</label>
          <select id="copy-day-day" value={targetDay} disabled={busy} onChange={(e) => { setTargetDay(Number(e.target.value)); setNeedsOverwrite(false); setError(null); }}>
            {DAY_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
          </select>
        </div>
      </div>
      {same && <p className="hint">Choose a different day to copy to.</p>}
      {error && <p className="form-alert" role="alert">{error}</p>}
    </Modal>
  );
}
