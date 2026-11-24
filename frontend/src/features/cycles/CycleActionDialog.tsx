import { useState } from "react";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import { getErrorMessage } from "../../services/apiError";
import { cycleService } from "../../services/plannerService";
import type { CycleSummary } from "../../types/planner";
import { formatRange } from "./cycleForm";

export type CycleAction = "activate" | "complete" | "archive" | "delete";

interface Props {
  action: CycleAction;
  cycle: CycleSummary;
  onClose: () => void;
  onDone: (action: CycleAction, cycle: CycleSummary) => void;
}

const CONFIG: Record<CycleAction, {
  title: string; confirm: string; danger?: boolean; run: (id: number) => Promise<unknown>;
  message: (c: CycleSummary) => string;
}> = {
  activate: {
    title: "Activate this cycle?", confirm: "Activate cycle", run: cycleService.activate,
    message: (c) => `"${c.name}" will become your active cycle (${formatRange(c.start_date, c.end_date)}). ` +
      "Two active cycles can't cover the same dates.",
  },
  complete: {
    title: "Complete this cycle?", confirm: "Complete cycle", run: cycleService.complete,
    message: (c) => `Mark "${c.name}" as completed. Completed cycles can no longer be edited, but stay in your history.`,
  },
  archive: {
    title: "Archive this cycle?", confirm: "Archive cycle", run: cycleService.archive,
    message: (c) => `Archive "${c.name}"? It moves to your previous cycles and can no longer be edited.`,
  },
  delete: {
    title: "Delete this draft?", confirm: "Delete draft", danger: true, run: cycleService.remove,
    message: (c) => `Delete the draft "${c.name}" and its whole weekly plan? This can't be undone.`,
  },
};

export default function CycleActionDialog({ action, cycle, onClose, onDone }: Props) {
  const cfg = CONFIG[action];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await cfg.run(cycle.id);
      onDone(action, cycle);
    } catch (e) {
      setError(getErrorMessage(e)); // e.g. "These dates overlap the active cycle ..."
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog title={cfg.title} confirmLabel={cfg.confirm} tone={cfg.danger ? "danger" : "default"}
      busy={busy} error={error} onConfirm={confirm} onCancel={onClose}>
      <p>{cfg.message(cycle)}</p>
    </ConfirmDialog>
  );
}
