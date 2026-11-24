import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { WeekStats } from "../../types/planner";

interface Props {
  totalWeeks: number;
  current: number;
  /** Per-week stats from the cycle (used to mark weeks that already have a plan). */
  weeks: WeekStats[];
  onChange: (week: number) => void;
}

export default function WeekSelector({ totalWeeks, current, weeks, onChange }: Props) {
  const activeRef = useRef<HTMLButtonElement>(null);
  const planned = new Set(weeks.filter((w) => w.planned_days + w.rest_days > 0).map((w) => w.week_number));

  useEffect(() => { // keep the selected chip visible when there are many weeks
    activeRef.current?.scrollIntoView?.({ block: "nearest", inline: "center" });
  }, [current]);

  return (
    <nav className="week-selector" aria-label="Select week">
      <button type="button" className="icon-btn" aria-label="Previous week" disabled={current <= 1} onClick={() => onChange(current - 1)}>
        <ChevronLeft size={18} />
      </button>
      <ul className="week-chips">
        {Array.from({ length: totalWeeks }, (_, i) => i + 1).map((n) => (
          <li key={n}>
            <button type="button" ref={n === current ? activeRef : undefined}
              className={`week-chip${n === current ? " current" : ""}${planned.has(n) ? " has-plan" : ""}`}
              aria-current={n === current ? "true" : undefined}
              aria-label={`Week ${n}${planned.has(n) ? ", has a plan" : ""}`} onClick={() => onChange(n)}>
              <span>Week {n}</span>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="icon-btn" aria-label="Next week" disabled={current >= totalWeeks} onClick={() => onChange(current + 1)}>
        <ChevronRight size={18} />
      </button>
    </nav>
  );
}
