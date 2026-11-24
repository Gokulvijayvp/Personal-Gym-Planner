import { useSearchParams } from "react-router-dom";
import { Activity, Crosshair, Dumbbell, Layers, PersonStanding } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import ExerciseMasterPanel from "./ExerciseMasterPanel";
import ReadOnlyMasterPanel, { type ReadOnlyKind } from "./ReadOnlyMasterPanel";

interface MasterDef { id: string; title: string; blurb: string; Icon: LucideIcon; editable: boolean }

export const MASTERS: MasterDef[] = [
  { id: "exercise", title: "Exercise master", blurb: "Exercise names and animated icons", Icon: Dumbbell, editable: true },
  { id: "muscle-groups", title: "Muscle groups", blurb: "Primary and secondary muscles", Icon: PersonStanding, editable: false },
  { id: "target-areas", title: "Target areas", blurb: "Areas within each muscle group", Icon: Crosshair, editable: false },
  { id: "workout-types", title: "Workout types", blurb: "Barbell, dumbbell, cable and more", Icon: Layers, editable: false },
  { id: "cardio-activities", title: "Cardio activities", blurb: "Running, cycling and more", Icon: Activity, editable: false },
];

/** The list of all masters; picking one shows it beside (or below) the list. The choice lives in the URL. */
export default function MastersTab() {
  const [params, setParams] = useSearchParams();
  const current = MASTERS.find((m) => m.id === params.get("master")) ?? MASTERS[0];

  function select(id: string) {
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (id === MASTERS[0].id) next.delete("master"); else next.set("master", id);
      return next;
    }, { replace: true });
  }

  return (
    <div className="masters-layout">
      <nav className="masters-nav" aria-label="Masters">
        <ul>
          {MASTERS.map((m) => (
            <li key={m.id}>
              <button type="button" className={m.id === current.id ? "master-item is-on" : "master-item"}
                aria-current={m.id === current.id ? "true" : undefined} onClick={() => select(m.id)}>
                <span className="settings-icon"><m.Icon size={18} /></span>
                <span className="master-item-text"><b>{m.title}</b><small>{m.blurb}</small></span>
                {!m.editable && <span className="master-lock">View only</span>}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <section className="panel masters-panel" aria-labelledby="masters-title">
        <h2 id="masters-title">{current.title}</h2>
        {current.id === "exercise"
          ? <ExerciseMasterPanel />
          : <ReadOnlyMasterPanel kind={current.id as ReadOnlyKind} title={current.title} />}
      </section>
    </div>
  );
}
