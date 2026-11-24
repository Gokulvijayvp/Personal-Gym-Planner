import { useSearchParams } from "react-router-dom";
import { useSession } from "../features/auth/session";
import PageHeader from "../components/ui/PageHeader";
import CatalogueBrowser from "../features/exercises/CatalogueBrowser";
import MyExercises from "../features/exercises/MyExercises";

type View = "browse" | "mine";
const VIEWS: { id: View; label: string }[] = [{ id: "browse", label: "Browse" }, { id: "mine", label: "My exercises" }];

/**
 * Exercises: browse the catalogue (with your own pictures and videos), and keep your own named sets such as
 * "Chest A". The view lives in the URL (`?view=mine`).
 */
export default function ExercisesPage() {
  const [params, setParams] = useSearchParams();
  const session = useSession();
  const isAdmin = session.status === "in" && session.user.role === "admin";
  const view: View = params.get("view") === "mine" ? "mine" : "browse";

  const select = (v: View) => setParams(v === "mine" ? { view: "mine" } : {}, { replace: true });
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const next = view === "browse" ? "mine" : "browse";
    select(next);
    requestAnimationFrame(() => document.getElementById(`exv-${next}`)?.focus());
  };

  return (
    <div className="ex-page">
      <PageHeader eyebrow="EXERCISES" title="Exercises"
        description={view === "browse"
          ? (isAdmin ? "Find an exercise by muscle and see how it is done. As admin you can add exercises and, with the pencil, their pictures and videos."
                     : "Find an exercise by muscle and see how it is done.")
          : "Your own sets of exercises, like Chest A or Leg B."}>
        <div className="ex-head-tools">
          <div className="seg" role="tablist" aria-label="Exercises view" onKeyDown={onKey}>
            {VIEWS.map((v) => (
              <button key={v.id} type="button" role="tab" id={`exv-${v.id}`} aria-selected={view === v.id} tabIndex={view === v.id ? 0 : -1}
                aria-controls="exv-panel" className={view === v.id ? "seg-btn is-on" : "seg-btn"} onClick={() => select(v.id)}>{v.label}</button>
            ))}
          </div>
        </div>
      </PageHeader>
      <div role="tabpanel" id="exv-panel" aria-labelledby={`exv-${view}`}>
        {view === "browse" ? <CatalogueBrowser readOnly allowMedia /> : <MyExercises />}
      </div>
    </div>
  );
}
