import { useCallback, useEffect, useState } from "react";
import { masterDataService } from "../../services/exerciseService";
import { getErrorMessage } from "../../services/apiError";
import type { MuscleGroup, WorkoutType } from "../../types/exercise";

export type MasterData =
  | { status: "loading" }
  | { status: "error"; message: string; reload: () => void }
  | { status: "ready"; muscleGroups: MuscleGroup[]; workoutTypes: WorkoutType[] };

/** Loads the seeded muscle groups (with target areas) and workout types once per page visit. */
export function useMasterData(): MasterData {
  const [state, setState] = useState<MasterData>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => { setState({ status: "loading" }); setAttempt((n) => n + 1); }, []);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([masterDataService.muscleGroups(controller.signal), masterDataService.workoutTypes(controller.signal)])
      .then(([muscleGroups, workoutTypes]) => setState({ status: "ready", muscleGroups, workoutTypes }))
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", message: getErrorMessage(e), reload });
      });
    return () => controller.abort();
  }, [attempt, reload]);

  return state;
}
