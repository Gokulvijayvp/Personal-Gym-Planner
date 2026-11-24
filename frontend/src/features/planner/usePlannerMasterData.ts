import { useCallback, useEffect, useState } from "react";
import { getErrorMessage } from "../../services/apiError";
import { masterDataService } from "../../services/exerciseService";
import { planningMasterData } from "../../services/plannerService";
import type { MuscleGroup, WorkoutType } from "../../types/exercise";
import type { CardioActivity } from "../../types/planner";

export type PlannerMasterData =
  | { status: "loading" }
  | { status: "error"; message: string; reload: () => void }
  | { status: "ready"; muscleGroups: MuscleGroup[]; workoutTypes: WorkoutType[]; cardioActivities: CardioActivity[] };

/** Reference data the day editor needs: muscle groups, workout types and cardio activities. */
export function usePlannerMasterData(): PlannerMasterData {
  const [state, setState] = useState<PlannerMasterData>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => { setState({ status: "loading" }); setAttempt((n) => n + 1); }, []);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      masterDataService.muscleGroups(controller.signal),
      masterDataService.workoutTypes(controller.signal),
      planningMasterData.cardioActivities(controller.signal),
    ])
      .then(([muscleGroups, workoutTypes, cardioActivities]) => setState({ status: "ready", muscleGroups, workoutTypes, cardioActivities }))
      .catch((e: unknown) => { if (!controller.signal.aborted) setState({ status: "error", message: getErrorMessage(e), reload }); });
    return () => controller.abort();
  }, [attempt, reload]);

  return state;
}
