import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "../../components/ui/Toast";
import { ApiError, getErrorMessage } from "../../services/apiError";
import { workoutService } from "../../services/workoutService";
import type { StartInput } from "../../types/workout";

/**
 * Starts (or resumes) a workout and opens it. Repeated taps are ignored while a start is in flight, and if a
 * workout is already unfinished for that day the server says so and we open that one instead of failing.
 */
export function useStartWorkout() {
  const navigate = useNavigate();
  const toast = useToast();
  const busy = useRef(false);
  const [starting, setStarting] = useState(false);

  const start = useCallback(async (input: StartInput) => {
    if (busy.current) return;
    busy.current = true;
    setStarting(true);
    try {
      const session = await workoutService.start(input);
      navigate(`/workout/${session.id}`);
    } catch (e) {
      const existing = e instanceof ApiError && e.code === "session_in_progress" ? e.details.find((d) => d.field === "session_id")?.message : null;
      if (existing) {
        toast.success("A workout is already in progress, so it was opened for you.");
        navigate(`/workout/${existing}`);
      } else {
        toast.error(getErrorMessage(e));
      }
    } finally {
      busy.current = false;
      setStarting(false);
    }
  }, [navigate, toast]);

  return { start, starting };
}
