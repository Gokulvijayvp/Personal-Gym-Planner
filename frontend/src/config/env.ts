/** Typed access to Vite env vars (see frontend/.env.example). */
export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL || "/api/v1";

/** Timezone used for all date display. Must match backend TIMEZONE. */
export const APP_TIMEZONE: string = import.meta.env.VITE_APP_TIMEZONE || "Asia/Kolkata";
