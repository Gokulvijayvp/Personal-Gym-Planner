// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./apiClient";
import { ApiError, NETWORK_MESSAGE, SERVER_MESSAGE, TIMEOUT_MESSAGE, getErrorMessage } from "./apiError";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function clientWith(impl: (url: string, init: RequestInit) => Promise<Response>, baseUrl = "/api/v1/") {
  const fetchImpl = vi.fn(impl) as unknown as typeof fetch;
  return { api: createApiClient({ baseUrl, fetchImpl, timeoutMs: 50 }), fetchImpl: fetchImpl as unknown as ReturnType<typeof vi.fn> };
}

async function failure(p: Promise<unknown>): Promise<ApiError> {
  try { await p; } catch (e) { return e as ApiError; }
  throw new Error("expected promise to reject");
}

describe("success paths", () => {
  it("GET parses typed JSON and joins base URL cleanly", async () => {
    const { api, fetchImpl } = clientWith(async () => json(200, { status: "healthy" }));
    const res = await api.get<{ status: string }>("/health");
    expect(res.status).toBe("healthy");
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/v1/health"); // no double slashes
  });

  it("builds query strings and skips empty values", async () => {
    const { api, fetchImpl } = clientWith(async () => json(200, []));
    await api.get("/exercises", { query: { q: "bench press", muscle: 3, active: true, none: undefined, empty: "", nul: null } });
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/v1/exercises?q=bench+press&muscle=3&active=true");
  });

  it("POST sends JSON body with content-type", async () => {
    const { api, fetchImpl } = clientWith(async () => json(201, { id: 1 }));
    await api.post("/things", { name: "x" });
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"name":"x"}');
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("204 resolves to undefined", async () => {
    const { api } = clientWith(async () => new Response(null, { status: 204 }));
    await expect(api.delete("/things/1")).resolves.toBeUndefined();
  });
});

describe("error handling", () => {
  it("network failure -> kind=network with friendly message", async () => {
    const { api } = clientWith(async () => { throw new TypeError("Failed to fetch"); });
    const err = await failure(api.get("/health"));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.kind).toBe("network");
    expect(err.message).toBe(NETWORK_MESSAGE);
    expect(err.message).not.toContain("Failed to fetch");
  });

  it("timeout -> kind=network, code=timeout", async () => {
    const { api } = clientWith((_u, init) => new Promise((_res, rej) => {
      init.signal!.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
    }));
    const err = await failure(api.get("/slow"));
    expect(err.kind).toBe("network");
    expect(err.code).toBe("timeout");
    expect(err.message).toBe(TIMEOUT_MESSAGE);
  });

  it("caller abort propagates as AbortError (not an ApiError)", async () => {
    const ctrl = new AbortController();
    const { api } = clientWith((_u, init) => new Promise((_res, rej) => {
      init.signal!.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
    }));
    const p = api.get("/slow", { signal: ctrl.signal, timeoutMs: 5000 });
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });

  it("422 -> kind=validation with field errors", async () => {
    const { api } = clientWith(async () => json(422, { error: {
      code: "validation_error", message: "Some of the submitted values are invalid.",
      details: [
        { field: "name", message: "Field required", type: "missing" },
        { field: "name", message: "second message ignored" },
        { field: "total_weeks", message: "Input should be greater than 0" },
      ],
    } }));
    const err = await failure(api.post("/cycles", {}));
    expect(err.kind).toBe("validation");
    expect(err.status).toBe(422);
    expect(err.fieldErrors).toEqual({ name: "Field required", total_weeks: "Input should be greater than 0" });
  });

  it("404/409 -> kind=client using server code and message", async () => {
    const { api } = clientWith(async () => json(409, { error: { code: "duplicate_name", message: "Already exists." } }));
    const err = await failure(api.post("/exercises", {}));
    expect(err).toMatchObject({ kind: "client", status: 409, code: "duplicate_name", message: "Already exists." });
  });

  it("500 envelope -> kind=server with reference", async () => {
    const { api } = clientWith(async () => json(500, { error: { code: "internal_error", message: SERVER_MESSAGE, reference: "ab12cd34" } }));
    const err = await failure(api.get("/x"));
    expect(err).toMatchObject({ kind: "server", status: 500, reference: "ab12cd34" });
  });

  it("5xx with non-JSON body (proxy error page) -> generic server message, no HTML leaked", async () => {
    const { api } = clientWith(async () => new Response("<html>Bad gateway</html>", { status: 502 }));
    const err = await failure(api.get("/x"));
    expect(err.kind).toBe("server");
    expect(err.message).toBe(SERVER_MESSAGE);
  });

  it("200 with invalid JSON -> kind=parse", async () => {
    const { api } = clientWith(async () => new Response("not json", { status: 200 }));
    expect((await failure(api.get("/x"))).kind).toBe("parse");
  });

  it("getErrorMessage handles ApiError, Error and unknown", () => {
    expect(getErrorMessage(new ApiError({ kind: "client", message: "nope" }))).toBe("nope");
    expect(getErrorMessage(new Error("plain"))).toBe("plain");
    expect(getErrorMessage(42)).toBe("An unexpected error occurred.");
  });
});

describe("cookie session and CSRF", () => {
  it("sends cookies with every request", async () => {
    const { api, fetchImpl } = clientWith(async () => json(200, { ok: true }));
    await api.get("/things");
    expect((fetchImpl.mock.calls[0][1] as RequestInit).credentials).toBe("include");
  });

  it("adds the CSRF header to writes (from the readable cookie) but not to reads", async () => {
    document.cookie = "a=1"; document.cookie = "gp_csrf=tok%20en"; document.cookie = "b=2";
    try {
      const { api, fetchImpl } = clientWith(async () => json(200, { ok: true }));
      await api.get("/things");
      await api.post("/things", { a: 1 });
      await api.delete("/things/1").catch(() => undefined);
      const h = (i: number) => (fetchImpl.mock.calls[i][1] as RequestInit).headers as Record<string, string>;
      expect(h(0)["X-CSRF-Token"]).toBeUndefined();
      expect(h(1)["X-CSRF-Token"]).toBe("tok en");
      expect(h(2)["X-CSRF-Token"]).toBe("tok en");
    } finally {
      document.cookie = "gp_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    }
  });

  it("a 401 on a private call reports the sign-out once", async () => {
    const onUnauthorized = vi.fn();
    const fetchImpl = vi.fn(async () => json(401, { error: { message: "Please sign in." } })) as unknown as typeof fetch;
    const api = createApiClient({ baseUrl: "/api/v1", fetchImpl, onUnauthorized });
    expect((await failure(api.get("/things"))).status).toBe(401);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);                     // no silent retry loop
  });

  it("a wrong sign-in code (401 on the auth endpoints) does not sign the user out", async () => {
    const onUnauthorized = vi.fn();
    const fetchImpl = vi.fn(async () => json(401, { error: { message: "nope" } })) as unknown as typeof fetch;
    const api = createApiClient({ baseUrl: "/api/v1", fetchImpl, onUnauthorized });
    await failure(api.post("/auth/verify-otp", { email: "a@b.co", code: "123456" }));
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});
