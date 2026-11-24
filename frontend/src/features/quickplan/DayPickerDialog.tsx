import { useState } from "react";
import Modal from "../../components/ui/Modal";
import { getErrorMessage } from "../../services/apiError";
import type { DaySummary } from "../../types/planner";
import { DAY_NAMES } from "../planner/plannerLogic";

export type PickerMode = "copy-to" | "move-to" | "copy-from";

interface Props {
  mode: PickerMode;
  /** The day being copied / moved / filled (0 = Monday). */
  dayIndex: number;
  week: number;
  totalWeeks: number;
  /** This week's days, Monday first. */
  days: DaySummary[];
  onClose: () => void;
  /** `week`/`day` is the OTHER day. Resolve when saved. */
  onChoose: (target: { week: number; day: number }, overwrite: boolean) => Promise<void>;
}

const TITLES: Record<PickerMode, (name: string) => string> = {
  "copy-to": (n) => `Copy ${n} to…`,
  "move-to": (n) => `Move ${n} to…`,
  "copy-from": (n) => `Fill ${n} from…`,
};

function summary(d: DaySummary | undefined): string {
  if (!d || d.kind === "empty") return "Nothing planned";
  if (d.kind === "rest") return "Rest day";
  return d.display_title || `${d.exercise_count} exercises`;
}

/** Choose the other day for a copy / move: one tap, with a clear warning when it would replace a plan. */
export default function DayPickerDialog({ mode, dayIndex, week, totalWeeks, days, onClose, onChoose }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const name = DAY_NAMES[dayIndex];
  const occupied = (d: DaySummary | undefined) => !!d && d.kind !== "empty";

  async function choose(key: string, target: { week: number; day: number }, replaces: boolean) {
    if (busy) return;
    if (replaces && confirm !== key) { setConfirm(key); return; }
    setBusy(key); setError(null);
    try { await onChoose(target, replaces); } catch (e) { setError(getErrorMessage(e)); setBusy(null); setConfirm(null); }
  }

  // copy-from: the source is the other day, and what would be replaced is this day.
  const thisDayOccupied = occupied(days[dayIndex]);

  return (
    <Modal title={TITLES[mode](name)} size="sm" onClose={onClose} dismissible={busy === null} closeOnBackdrop>
      {error && <p className="form-alert" role="alert">{error}</p>}
      <ul className="dp-list" aria-label="Days">
        {DAY_NAMES.map((n, i) => {
          if (i === dayIndex) return null;
          const d = days[i];
          const replaces = mode === "copy-from" ? thisDayOccupied : occupied(d);
          const disabled = busy !== null || (mode === "copy-from" && !occupied(d));
          const key = `w${week}d${i}`;
          return (
            <li key={n}>
              <button type="button" className={confirm === key ? "dp-row is-confirm" : "dp-row"} disabled={disabled}
                data-testid={`day-${i}`} onClick={() => choose(key, { week, day: i }, replaces)}>
                <b>{n}</b>
                <small>{confirm === key ? `Replaces what is on ${mode === "copy-from" ? name : n}. Tap again to confirm.` : summary(d)}</small>
              </button>
            </li>
          );
        })}
        {mode === "copy-to" && week < totalWeeks && (
          <li>
            <button type="button" className="dp-row" disabled={busy !== null} data-testid="next-week"
              onClick={() => choose("next", { week: week + 1, day: dayIndex }, false)}>
              <b>{name} next week</b><small>Week {week + 1}</small>
            </button>
          </li>
        )}
      </ul>
    </Modal>
  );
}
