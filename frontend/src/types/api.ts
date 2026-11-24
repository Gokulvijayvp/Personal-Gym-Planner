/** Mirrors backend `app.schemas.common` / `app.schemas.health`. */

/** ISO-8601 UTC timestamp, e.g. "2026-11-18T20:00:00Z". Convert with utils/date.ts for display. */
export type UtcDateTimeString = string;
/** Local calendar date in the app timezone, "YYYY-MM-DD". */
export type DateString = string;

export interface HealthResponse {
  status: string;
  application: string;
  environment: string;
  timezone: string;
  server_time: UtcDateTimeString;
  today: DateString;
}

export interface ApiErrorDetail {
  field?: string;
  message: string;
  type?: string;
}

/** Shape of every non-2xx response from the backend. */
export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: ApiErrorDetail[];
    /** Short id for server-side log lookup (unexpected errors only). */
    reference?: string;
  };
}
