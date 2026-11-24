import { Link } from "react-router-dom";
import { Circle, CircleCheck, CircleSlash, ListChecks } from "lucide-react";
import type { ActiveCycleCard, ChecklistItem, SetupStatus } from "../../types/dashboard";
import { plannerWeekLink, plural } from "./homeLogic";

interface Props { setup: SetupStatus; activeCycle: ActiveCycleCard | null }

interface Row { title: string; detail: string; to: string }

function describe(item: ChecklistItem, activeCycle: ActiveCycleCard | null): Row {
  const n = item.count ?? 0;
  switch (item.key) {
    case "exercises":
      return { title: "Save your exercise sets", to: "/exercises?view=mine",
        detail: item.status === "done" ? `${plural(n, "set")} saved` : "Group exercises into sets like Chest A, then add a whole set in one tap" };
    case "cycle":
      return { title: "Create a workout cycle", to: "/cycles",
        detail: item.status === "done" ? `${plural(n, "cycle")} created` : "Choose a start Monday and a number of weeks" };
    default:
      return { title: "Plan workouts for this week",
        to: activeCycle ? plannerWeekLink(activeCycle.cycle.id, activeCycle.current_week) : "/planner",
        detail: item.status === "done" ? `${plural(n, "workout day")} planned this week`
          : item.status === "not_applicable" ? (item.reason ?? "Not applicable yet") : "Assign workouts to this week's days" };
  }
}

/** Setup progress computed from real data by the API. Collapses to one line when everything is done. */
export default function SetupChecklist({ setup, activeCycle }: Props) {
  return (
    <section className="panel home-card" aria-labelledby="home-setup" data-testid="setup-checklist">
      <header className="home-card-head">
        <div><span className="eyebrow">SETUP</span><h2 id="home-setup">{setup.all_done ? "Setup complete" : "Get set up"}</h2></div>
        <span className="home-icon"><ListChecks size={18} /></span>
      </header>
      {setup.all_done ? (
        <p className="home-text"><CircleCheck size={15} className="ok-icon" aria-hidden /> All {setup.applicable} setup steps are done.</p>
      ) : (
        <p className="home-text" data-testid="setup-count">{setup.completed} of {setup.applicable} steps done</p>
      )}
      {/* When everything applicable is done only the not-applicable steps stay listed, so the reason is never lost. */}
      {(() => {
        const rows = setup.all_done ? setup.items.filter((i) => i.status === "not_applicable") : setup.items;
        if (rows.length === 0) return null;
        return (
          <ul className="checklist-list">
            {rows.map((item) => {
              const row = describe(item, activeCycle);
              const Icon = item.status === "done" ? CircleCheck : item.status === "not_applicable" ? CircleSlash : Circle;
              const state = item.status === "done" ? "Done" : item.status === "pending" ? "To do" : "Not applicable";
              const body = (
                <>
                  <Icon size={20} className={`ck-icon ck-${item.status}`} aria-hidden />
                  <span className="ck-text"><b>{row.title}</b><small>{row.detail}</small></span>
                  <span className="sr-only">{state}</span>
                </>
              );
              return (
                <li key={item.key} data-status={item.status}>
                  {item.status === "not_applicable"
                    ? <div className="ck-row is-na">{body}</div>
                    : <Link to={row.to} className="ck-row">{body}</Link>}
                </li>
              );
            })}
          </ul>
        );
      })()}
    </section>
  );
}
