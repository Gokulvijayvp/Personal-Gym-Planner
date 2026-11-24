import { Lock } from "lucide-react";
import ErrorState from "../../components/ui/ErrorState";
import { exerciseMasterService } from "../../services/exerciseMasterService";
import { masterDataService } from "../../services/exerciseService";
import { useAsync } from "../progress/useAsync";

export type ReadOnlyKind = "muscle-groups" | "target-areas" | "workout-types" | "cardio-activities";

interface Group { title?: string; names: string[] }

async function load(kind: ReadOnlyKind, signal: AbortSignal): Promise<Group[]> {
  switch (kind) {
    case "muscle-groups":
      return [{ names: (await masterDataService.muscleGroups(signal)).map((g) => g.name) }];
    case "target-areas":
      return (await masterDataService.muscleGroups(signal)).map((g) => ({ title: g.name, names: g.target_areas.map((a) => a.name) }));
    case "workout-types":
      return [{ names: (await masterDataService.workoutTypes(signal)).map((t) => t.name) }];
    case "cardio-activities":
      return [{ names: (await exerciseMasterService.cardioActivities(signal)).map((a) => a.name) }];
  }
}

/** A built-in list shown for reference only. */
export default function ReadOnlyMasterPanel({ kind, title }: { kind: ReadOnlyKind; title: string }) {
  const state = useAsync((s) => load(kind, s), [kind]);
  if (state.error && !state.data) return <ErrorState title={`Couldn't load ${title.toLowerCase()}`} message={state.error} onRetry={state.reload} />;
  if (!state.data) return <div className="skeleton settings-skeleton" aria-busy="true" role="status" aria-label={`Loading ${title}`} />;
  return (
    <div className="master-panel">
      <p className="settings-note"><Lock size={13} aria-hidden /> These are built into the app and can't be edited. They are used to describe your exercises and workouts.</p>
      {state.data.map((g) => (
        <section key={g.title ?? "all"} className="master-group" aria-label={g.title ?? title}>
          {g.title && <h3>{g.title}</h3>}
          <ul className="master-chips">
            {g.names.map((n) => <li key={n}>{n}</li>)}
          </ul>
        </section>
      ))}
    </div>
  );
}
