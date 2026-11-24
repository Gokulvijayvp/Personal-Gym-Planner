import { useRef, useState } from "react";
import { Copy } from "lucide-react";
import Modal from "../../components/ui/Modal";
import { useToast } from "../../components/ui/Toast";
import { getErrorMessage } from "../../services/apiError";
import { planShareService } from "../../services/planShareService";
import type { PlanShareCreated, ShareKind } from "../../types/planShare";
import { copyText } from "../exercises/copyText";

interface Props {
  cycleId: number;
  week: number;
  day: number;
  dayName: string;
  onClose: () => void;
}

/** Make a code for this day or this whole week of the plan, and copy it. */
export default function PlanShareDialog({ cycleId, week, day, dayName, onClose }: Props) {
  const toast = useToast();
  const box = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<ShareKind>("day");
  const [made, setMade] = useState<PlanShareCreated | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const share = kind === "day" ? await planShareService.shareDay(cycleId, week, day) : await planShareService.shareWeek(cycleId, week);
      setMade(share);
      const ok = await copyText(share.code);
      setCopied(ok);
      if (ok) toast.success(`Code ${share.code} copied.`);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function copyAgain() {
    if (!made) return;
    if (await copyText(made.code)) { setCopied(true); toast.success("Code copied."); }
    else { box.current?.select(); toast.error("Your browser blocked copying. The code is selected: press Ctrl+C."); }
  }

  return (
    <Modal title="Share workout plan" size="sm" onClose={onClose} dismissible={!busy} closeOnBackdrop
      footer={made
        ? <button type="button" className="btn" onClick={onClose}>Done</button>
        : <><button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className="btn" onClick={create} disabled={busy} data-testid="make-plan-code">{busy ? "Making code…" : "Create code"}</button></>}>
      <div className="shc">
        {error && <p className="form-alert" role="alert">{error}</p>}
        {!made ? (
          <fieldset className="shc-choice">
            <legend>What do you want to share?</legend>
            <label className="qs-radio"><input type="radio" name="share-kind" checked={kind === "day"} onChange={() => setKind("day")} />
              <span><b>This day</b> ({dayName}, week {week})</span></label>
            <label className="qs-radio"><input type="radio" name="share-kind" checked={kind === "week"} onChange={() => setKind("week")} />
              <span><b>This whole week</b> (week {week})</span></label>
            <p className="hint">The other person gets the exercises, sets, reps, notes and cardio exactly as they are now.</p>
          </fieldset>
        ) : (
          <>
            <p>{copied ? "Your code is copied. Send it to the other person." : "Copy this code and send it to the other person."}</p>
            <div className="shc-row">
              <input ref={box} className="shc-code" readOnly value={made.code} aria-label="Share code" onFocus={(e) => e.target.select()} />
              <button type="button" className="btn btn-outline" onClick={copyAgain}><Copy size={16} aria-hidden /> {copied ? "Copied" : "Copy"}</button>
            </div>
            <p className="hint">
              {made.kind === "day" ? `It holds ${dayName}'s plan.` : `It holds ${made.days_count} planned ${made.days_count === 1 ? "day" : "days"} of week ${week}.`}{" "}
              When they paste it into their Workout, it replaces the day or week they choose. Your own plan is not changed.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
