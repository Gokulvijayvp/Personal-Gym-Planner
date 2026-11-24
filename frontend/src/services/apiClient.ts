import {
  ApiError, NETWORK_MESSAGE, TIMEOUT_MESSAGE, errorFromResponse,
} from "./apiError";

type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  query?: Record<string, QueryValue>;
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface ApiClientConfig {
  baseUrl: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Called when the server says 401 on a private call: the session ended, so the user must sign in again. */
  onUnauthorized?: () => void;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export function createApiClient({ baseUrl, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl, onUnauthorized }: ApiClientConfig) {
  const root = baseUrl.replace(/\/+$/, "");
  // Sign-in calls answer 401/403 for "wrong code" etc.; only other calls mean "your session has ended".
  const SIGN_IN_CALLS = /^auth\/(login|signup|verify-otp|logout)/;

  /** The CSRF token the server put in a cookie (readable on purpose). The session cookie itself is httpOnly and never visible here. */
  function csrfToken(): string {
    if (typeof document === "undefined") return "";
    const m = document.cookie.match(/(?:^|;\s*)gp_csrf=([^;]*)/);
    return m ? decodeURIComponent(m[1]) : "";
  }

  function buildUrl(path: string, query?: RequestOptions["query"]): string {
    let url = `${root}/${path.replace(/^\/+/, "")}`;
    if (query) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
      }
      const qs = params.toString();
      if (qs) url += `?${qs}`;
    }
    return url;
  }

  async function request<TResponse>(method: string, path: string, opts: RequestOptions = {}): Promise<TResponse> {
    const doFetch = fetchImpl ?? fetch;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, opts.timeoutMs ?? timeoutMs);
    // Respect a caller-supplied signal too (e.g. component unmount).
    const onCallerAbort = () => controller.abort();
    opts.signal?.addEventListener("abort", onCallerAbort);

    const headers: Record<string, string> = { Accept: "application/json" };
    if (method !== "GET" && method !== "HEAD") { const t = csrfToken(); if (t) headers["X-CSRF-Token"] = t; }   // proves the write comes from our own page
    const hasBody = opts.body !== undefined;
    const isForm = typeof FormData !== "undefined" && opts.body instanceof FormData;
    if (hasBody && !isForm) headers["Content-Type"] = "application/json"; // a FormData body sets its own boundary

    let response: Response;
    try {
      response = await doFetch(buildUrl(path, opts.query), {
        method, headers, signal: controller.signal, credentials: "include",   // send the httpOnly auth cookies
        body: hasBody ? (isForm ? (opts.body as FormData) : JSON.stringify(opts.body)) : undefined,
      });
    } catch (err) {
      if (opts.signal?.aborted) throw err; // caller cancelled: let it propagate as AbortError
      throw new ApiError({
        kind: "network", code: timedOut ? "timeout" : "network_error",
        message: timedOut ? TIMEOUT_MESSAGE : NETWORK_MESSAGE,
      });
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onCallerAbort);
    }

    if (response.status === 401 && !SIGN_IN_CALLS.test(path.replace(/^\/+/, ""))) onUnauthorized?.();   // the server ended this session

    if (response.status === 204) return undefined as TResponse;

    const text = await response.text().catch(() => "");
    let data: unknown;
    if (text) {
      try { data = JSON.parse(text); } catch { data = undefined; }
    }

    if (!response.ok) throw errorFromResponse(response.status, data);
    if (data === undefined) {
      throw new ApiError({ kind: "parse", status: response.status, code: "invalid_response",
        message: "The server sent an unexpected response." });
    }
    return data as TResponse;
  }

  return {
    request,
    get: <T>(path: string, opts?: Omit<RequestOptions, "body">) => request<T>("GET", path, opts),
    post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, "body">) => request<T>("POST", path, { ...opts, body }),
    put: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, "body">) => request<T>("PUT", path, { ...opts, body }),
    patch: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, "body">) => request<T>("PATCH", path, { ...opts, body }),
    delete: <T = void>(path: string, opts?: Omit<RequestOptions, "body">) => request<T>("DELETE", path, opts),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
