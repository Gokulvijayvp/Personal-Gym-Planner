import type { Dashboard } from "../types/dashboard";
import { api } from "./client";

/** Read-only. Home never creates or changes anything. */
export const dashboardService = {
  get: (signal?: AbortSignal) => api.get<Dashboard>("/dashboard", { signal }),
};
