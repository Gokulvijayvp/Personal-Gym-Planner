import type { SessionStatus, SessionSummary, WorkoutSession } from "../../types/workout";

/** Counted from what was logged: planned targets never count as performance. Mirrors the backend `summarize`. */
export function summarize(s: Pick<WorkoutSession, "exercises" | "cardio">): SessionSummary {
  const doneCardio = s.cardio.filter((c) => c.status === "completed");
  return {
    total_exercises: s.exercises.length,
    completed_exercises: s.exercises.filter((e) => e.status === "completed").length,
    skipped_exercises: s.exercises.filter((e) => e.status === "skipped").length,
    total_sets: s.exercises.reduce((n, e) => n + e.sets.length, 0),
    completed_sets: s.exercises.reduce((n, e) => n + e.sets.filter((x) => x.status === "completed").length, 0),
    cardio_entries: s.cardio.length,
    cardio_completed: doneCardio.length,
    cardio_minutes: doneCardio.reduce((n, c) => n + (c.duration_minutes ?? 0), 0),
  };
}

/** Elapsed seconds: the server's figure at the moment it was received, plus the time since, while unfinished.
 *  Because it is derived from stored timestamps it is right after a refresh, a sleep or a closed tab. */
export function elapsedSeconds(duration: number, receivedAt: number, running: boolean, now: number): number {
  return running ? duration + Math.max(0, Math.floor((now - receivedAt) / 1000)) : duration;
}

export const STATUS_TEXT: Record<SessionStatus, string> = { in_progress: "In progress", completed: "Completed", cancelled: "Cancelled" };

/** True when nothing has been logged, so finishing would save an empty workout. */
export function isEmptyLog(s: Pick<WorkoutSession, "exercises" | "cardio">): boolean {
  const sum = summarize(s);
  return sum.completed_sets === 0 && sum.completed_exercises === 0 && sum.cardio_completed === 0;
}
