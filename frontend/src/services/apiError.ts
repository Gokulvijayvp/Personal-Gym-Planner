import type { ApiErrorDetail, ApiErrorEnvelope } from "../types/api";

/**
 * - network:    request never got a response (offline, server down, CORS, timeout)
 * - validation: 422, field-level problems in `fieldErrors`
 * - client:     other 4xx (not found, conflict, ...)
 * - server:     5xx
 * - parse:      response was not the JSON we expected
 */
export type ApiErrorKind = "network" | "validation" | "client" | "server" | "parse";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  readonly code: string;
  readonly details: ApiErrorDetail[];
  readonly reference?: string;

  constructor(init: {
    kind: ApiErrorKind; message: string; status?: number | null; code?: string;
    details?: ApiErrorDetail[]; reference?: string;
  }) {
    super(init.message);
    this.name = "ApiError";
    this.kind = init.kind;
    this.status = init.status ?? null;
    this.code = init.code ?? init.kind;
    this.details = init.details ?? [];
    this.reference = init.reference;
  }

  /** Field name -> first message, ready to show next to form inputs. */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const d of this.details) {
      if (d.field && !(d.field in out)) out[d.field] = d.message;
    }
    return out;
  }
}

function isEnvelope(value: unknown): value is ApiErrorEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const err = (value as { error?: unknown }).error;
  return typeof err === "object" && err !== null
    && typeof (err as { message?: unknown }).message === "string"
    && typeof (err as { code?: unknown }).code === "string";
}

export const NETWORK_MESSAGE = "Can't reach the server. Check your connection and that the backend is running.";
export const TIMEOUT_MESSAGE = "The server took too long to respond. Please try again.";
export const SERVER_MESSAGE = "Something went wrong on the server. Please try again.";

/** Build an ApiError from a non-OK response whose body was already read (and maybe parsed). */
export function errorFromResponse(status: number, body: unknown): ApiError {
  if (isEnvelope(body)) {
    const { code, message, details, reference } = body.error;
    return new ApiError({
      kind: status === 422 ? "validation" : status >= 500 ? "server" : "client",
      status, code, message, details, reference,
    });
  }
  // Not our envelope (proxy error page, backend down behind the Vite proxy, ...).
  if (status >= 500) return new ApiError({ kind: "server", status, code: "server_error", message: SERVER_MESSAGE });
  return new ApiError({ kind: "client", status, code: "http_error", message: `Request failed (${status}).` });
}

/** Message safe to show in the UI for anything that was thrown. */
export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "An unexpected error occurred.";
}
