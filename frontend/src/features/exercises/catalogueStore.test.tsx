// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { resetCatalogueStore, useCatalogue } from "./catalogueStore";
import { clearSession, resetSession, setSession } from "../auth/session";
import { catalogueService } from "../../services/catalogueService";
import type { Catalogue } from "../../types/catalogue";

vi.mock("../../services/catalogueService", () => ({ catalogueService: { list: vi.fn() } }));

const mine = (flag: boolean): Catalogue => ({
  items: [{ key: "bench", name: "Bench", muscle_group: "Chest", target_area: null, equipment: "Barbell", icon_motion: "press", in_library: flag, exercise_id: flag ? 9 : null }],
  muscle_groups: ["Chest"], motions: {},
});

beforeEach(() => { resetCatalogueStore(); resetSession(); });
afterEach(() => { cleanup(); vi.clearAllMocks(); resetCatalogueStore(); resetSession(); });

describe("the shared catalogue copy belongs to one signed-in person", () => {
  it("drops the previous user's 'In library' marks on logout and when someone else signs in", async () => {
    vi.mocked(catalogueService.list).mockResolvedValueOnce(mine(true));              // user A has Bench in their library
    setSession({ id: 1, email: "a@example.com", role: "user" });
    const { result } = renderHook(() => useCatalogue());
    await waitFor(() => expect(result.current.byKey("bench")?.in_library).toBe(true));

    vi.mocked(catalogueService.list).mockResolvedValue(mine(false));                 // user B does not
    act(() => setSession({ id: 2, email: "b@example.com", role: "user" }));          // B signs in on the same browser tab
    expect(result.current.catalogue).toBeNull();                                      // A's copy is gone at once, not shown for a moment
  });

  it("is also cleared by a plain logout", async () => {
    vi.mocked(catalogueService.list).mockResolvedValue(mine(true));
    setSession({ id: 1, email: "a@example.com", role: "user" });
    const { result } = renderHook(() => useCatalogue());
    await waitFor(() => expect(result.current.catalogue).not.toBeNull());
    act(() => clearSession());
    expect(result.current.catalogue).toBeNull();
  });

  it("keeps it when the same person is set again (for example a page refresh answered by /auth/me)", async () => {
    vi.mocked(catalogueService.list).mockResolvedValue(mine(true));
    setSession({ id: 1, email: "a@example.com", role: "user" });
    const { result } = renderHook(() => useCatalogue());
    await waitFor(() => expect(result.current.catalogue).not.toBeNull());
    act(() => setSession({ id: 1, email: "a@example.com", role: "user" }));
    expect(result.current.catalogue).not.toBeNull();
  });
});
