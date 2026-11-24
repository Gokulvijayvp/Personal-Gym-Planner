import { API_BASE_URL } from "../config/env";
import { clearSession } from "../features/auth/session";
import { createApiClient } from "./apiClient";

/** The one shared API client. Feature services import this; components never call fetch. */
export const api = createApiClient({ baseUrl: API_BASE_URL, onUnauthorized: clearSession });
