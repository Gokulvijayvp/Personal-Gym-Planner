import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Repeat2 } from "lucide-react";
import CardGridSkeleton from "../components/ui/CardGridSkeleton";
import EmptyState from "../components/ui/EmptyState";
import ErrorState from "../components/ui/ErrorState";
import PageHeader from "../components/ui/PageHeader";
import { useToast } from "../components/ui/Toast";
import CycleActionDialog, { type CycleAction } from "../features/cycles/CycleActionDialog";
import CycleCard from "../features/cycles/CycleCard";
import CycleFormModal from "../features/cycles/CycleFormModal";
import { groupCycles } from "../features/cycles/cycleForm";
import { getErrorMessage } from "../services/apiError";
import { cycleService } from "../services/plannerService";
import type { CycleSummary } from "../types/planner";

type FormState = null | { mode: "create" } | { mode: "edit"; cycle: CycleSummary };

const DONE_MESSAGE: Record<CycleAction, string> = {
  activate: "is now your active cycle.", complete: "was marked as completed.",
  archive: "was archived.", delete: "was deleted.",
};

export default function WorkoutCyclesPage() {
  const toast = useToast();
  const [cycles, setCycles] = useState<CycleSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    cycleService.list(undefined, controller.signal)
      .then((list) => { setCycles(list); setError(null); })
      .catch((e: unknown) => { if (!controller.signal.aborted) setError(getErrorMessage(e)); });
    return () => controller.abort();
  }, [reloadToken]);

  const [form, setForm] = useState<FormState>(null);
  const [action, setAction] = useState<{ action: CycleAction; cycle: CycleSummary } | null>(null);
  const grouped = useMemo(() => (cycles ? groupCycles(cycles) : null), [cycles]);

  const openCreate = () => setForm({ mode: "create" });
  const cardHandlers = {
    onEdit: (c: CycleSummary) => setForm({ mode: "edit", cycle: c }),
    onAction: (a: CycleAction, c: CycleSummary) => setAction({ action: a, cycle: c }),
  };

  return (
    <>
      <PageHeader eyebrow="PLANNING" title="Workout Cycles" back={{ to: "/workout", label: "Workout" }}
        description="Plan your training in blocks of any length. Each cycle gets its own weekly plan.">
        <div className="header-actions">
          {cycles && <span className="count-pill" data-testid="cycle-count">
            {cycles.length} {cycles.length === 1 ? "cycle" : "cycles"}</span>}
          <button type="button" className="btn" onClick={openCreate}><Plus size={17} /> New cycle</button>
        </div>
      </PageHeader>

      {error ? (
        <section className="panel page-empty"><ErrorState title="Couldn't load your cycles" message={error} onRetry={reload} /></section>
      ) : !grouped ? (
        <CardGridSkeleton label="Loading cycles" />
      ) : cycles!.length === 0 ? (
        <section className="panel page-empty">
          <EmptyState Icon={Repeat2} title="No workout cycles yet"
            description="Create a cycle (4, 8, 12 weeks or any length) and the weekly plan is generated for you.">
            <button type="button" className="btn" onClick={openCreate}><Plus size={17} /> Create your first cycle</button>
          </EmptyState>
        </section>
      ) : (
        <>
          <section aria-labelledby="active-heading" className="cycle-section">
            <h2 id="active-heading" className="section-h">Active cycle</h2>
            {grouped.active.length === 0 ? (
              <p className="muted-note" data-testid="no-active">No active cycle. Activate a draft to start following a plan.</p>
            ) : (
              <div className="cycle-grid">
                {grouped.active.map((c) => <CycleCard key={c.id} cycle={c} highlight {...cardHandlers} />)}
              </div>
            )}
          </section>

          {grouped.drafts.length > 0 && (
            <section aria-labelledby="drafts-heading" className="cycle-section">
              <h2 id="drafts-heading" className="section-h">Drafts</h2>
              <div className="cycle-grid">{grouped.drafts.map((c) => <CycleCard key={c.id} cycle={c} {...cardHandlers} />)}</div>
            </section>
          )}

          <section aria-labelledby="previous-heading" className="cycle-section">
            <h2 id="previous-heading" className="section-h">Previous cycles</h2>
            {grouped.previous.length === 0 ? (
              <p className="muted-note" data-testid="no-previous">Completed and archived cycles will appear here.</p>
            ) : (
              <div className="cycle-grid">{grouped.previous.map((c) => <CycleCard key={c.id} cycle={c} {...cardHandlers} />)}</div>
            )}
          </section>
        </>
      )}

      {form && (
        <CycleFormModal
          cycle={form.mode === "edit" ? form.cycle : undefined} onClose={() => setForm(null)}
          onSaved={(saved, mode) => {
            setForm(null);
            toast.success(`"${saved.name}" was ${mode === "created" ? `created with ${saved.total_weeks} weeks` : "updated"}.`);
            reload();
          }}
        />
      )}
      {action && (
        <CycleActionDialog
          action={action.action} cycle={action.cycle} onClose={() => setAction(null)}
          onDone={(a, c) => { setAction(null); toast.success(`"${c.name}" ${DONE_MESSAGE[a]}`); reload(); }}
        />
      )}
    </>
  );
}
