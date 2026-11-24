import type { HealthResponse } from "../types/api";
import { api } from "./client";

export function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return api.get<HealthResponse>("/health", { signal });
}

export { ApiError, getErrorMessage } from "./apiError";
