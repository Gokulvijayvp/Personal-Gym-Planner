import { Link } from "react-router-dom";
import { CircleCheck, Play } from "lucide-react";
import type { CycleStatus } from "../../types/planner";
import type { SessionRef } from "../../types/workout";
import { todayISO } from "../../utils/date";
import { useStartWorkout } from "./useStartWorkout";

interface Props {
  cycleId: number;
  cycleStatus: CycleStatus;
  weekNumber: number;
  dayOfWeek: number;
  date: string;
  /** The day has strength or cardio planned (not a rest or empty day). */
  hasWorkout: boolean;
  workout: SessionRef | null;
  className?: string;
}

/** Start, resume or open the logged workout for one planned day. It never touches the plan. */
export default function DayWorkoutAction({ cycleId, cycleStatus, weekNumber, dayOfWeek, date, hasWorkout, workout, className = "" }: Props) {
  const { start, starting } = useStartWorkout();
  if (workout?.status === "in_progress") {
    return <Link to={`/workout/${workout.id}`} className={`btn ${className}`}><Play size={14} aria-hidden /> Resume workout</Link>;
  }
  if (workout?.status === "completed") {
    return (
      <span className={`logged-actions ${className}`}>
        <span className="logged-badge s-completed"><CircleCheck size={13} aria-hidden /> Workout logged</span>
        <Link to={`/workout/${workout.id}`} className="btn btn-outline btn-sm">View workout</Link>
      </span>
    );
  }
  const startable = hasWorkout && (cycleStatus === "active" || cycleStatus === "completed") && date <= todayISO();
  if (!startable) return null;
  return (
    <button type="button" className={`btn ${className}`} disabled={starting}
      onClick={() => start({ source: "plan", cycle_id: cycleId, week_number: weekNumber, day_of_week: dayOfWeek })}>
      <Play size={14} aria-hidden /> {starting ? "Starting…" : "Start workout"}
    </button>
  );
}
