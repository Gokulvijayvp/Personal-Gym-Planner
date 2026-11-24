import { API_BASE_URL } from "../config/env";
import type { DataInfo, ResetSection, Settings, SettingsValues } from "../types/settings";
import { ApiError, NETWORK_MESSAGE, errorFromResponse } from "./apiError";
import { api } from "./client";

export interface BackupFile { blob: Blob; filename: string }

/** Pull the filename out of a Content-Disposition header, falling back to a safe default. */
export function filenameFrom(disposition: string | null): string {
  const match = disposition?.match(/filename="?([^";]+)"?/i);
  const name = match?.[1]?.trim();
  return name && /^[\w.\- ]+$/.test(name) ? name : "gym-planner-backup.db";
}

export const settingsService = {
  get: (signal?: AbortSignal) => api.get<Settings>("/settings", { signal }),
  update: (values: SettingsValues) => api.put<Settings>("/settings", values),
  reset: (section: ResetSection) => api.post<Settings>("/settings/reset", { section }),
  dataInfo: (signal?: AbortSignal) => api.get<DataInfo>("/settings/data", { signal }),

  /** The shared client only speaks JSON, so the binary download uses fetch directly (same error mapping). */
  async downloadBackup(): Promise<BackupFile> {
    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL.replace(/\/+$/, "")}/settings/data/backup`, { credentials: "include" });
    } catch {
      throw new ApiError({ kind: "network", code: "network_error", message: NETWORK_MESSAGE });
    }
    if (!response.ok) {
      const data = await response.json().catch(() => undefined);
      throw errorFromResponse(response.status, data);
    }
    return { blob: await response.blob(), filename: filenameFrom(response.headers.get("content-disposition")) };
  },
};
