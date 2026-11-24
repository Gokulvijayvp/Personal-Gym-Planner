import type { PlanImportRequest, PlanImportResult, PlanShareCreated, PlanSharePreview } from "../types/planShare";
import { api } from "./client";

export const planShareService = {
  /** A code for one planned day. */
  shareDay: (cycleId: number, week: number, day: number) =>
    api.post<PlanShareCreated>("/plan-shares/day", { cycle_id: cycleId, week_number: week, day_of_week: day }),
  /** A code for one whole planned week. */
  shareWeek: (cycleId: number, week: number) =>
    api.post<PlanShareCreated>("/plan-shares/week", { cycle_id: cycleId, week_number: week }),
  /** What a code contains. Changes nothing. */
  preview: (code: string) => api.post<PlanSharePreview>("/plan-shares/preview", { code }),
  /** Copies the shared day/week into your plan. 409 `target_not_empty` until `confirm_replace` is true. */
  importPlan: (req: PlanImportRequest) =>
    api.post<PlanImportResult>("/plan-shares/import", { day_of_week: null, confirm_replace: false, ...req }),
};
