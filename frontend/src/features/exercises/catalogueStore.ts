import { useEffect, useMemo, useSyncExternalStore } from "react";
import { getErrorMessage } from "../../services/apiError";
import { catalogueService } from "../../services/catalogueService";
import type { Catalogue, CatalogueItem, CatalogueMedia } from "../../types/catalogue";
import { onSignedInUserChange } from "../auth/session";

/**
 * One shared copy of the exercise catalogue (names, details and the pictures / videos you uploaded), so every screen
 * that shows an exercise sees the same thing. An upload or removal updates it at once; each screen that mounts also
 * re-reads it quietly, so what is on screen is never older than the last visit.
 */
interface State { data: Catalogue | null; error: string | null; loading: boolean }

let state: State = { data: null, error: null, loading: false };
const listeners = new Set<() => void>();
const set = (next: Partial<State>) => { state = { ...state, ...next }; listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function loadCatalogue(): void {
  if (state.loading) return;
  set({ loading: true });
  catalogueService.list()
    .then((data) => set({ data, error: null, loading: false }))
    .catch((e: unknown) => set({ error: getErrorMessage(e), loading: false }));
}

/** Call after pictures / videos were added or removed, so every screen updates without a reload. */
export function setCatalogueMedia(key: string, media: CatalogueMedia[]): void {
  if (!state.data) return;
  set({ data: { ...state.data, items: state.data.items.map((i) => (i.key === key ? { ...i, media } : i)) } });
}

/** A new exercise was added: show it everywhere at once (the next visit re-reads the real list anyway). */
export function addCatalogueItem(item: CatalogueItem): void {
  if (!state.data) return;
  const groups = state.data.muscle_groups.includes(item.muscle_group) ? state.data.muscle_groups : [...state.data.muscle_groups, item.muscle_group];
  set({ data: { ...state.data, items: [...state.data.items, item], muscle_groups: groups } });
}

/** For tests: forget everything. */
export function resetCatalogueStore(): void {
  state = { data: null, error: null, loading: false };
  listeners.forEach((l) => l());
}

export interface CatalogueLookup {
  catalogue: Catalogue | null;
  error: string | null;
  byKey: (key: string) => CatalogueItem | undefined;
  /** Library exercises were created from the catalogue, so their names match (ignoring case). */
  byName: (name: string) => CatalogueItem | undefined;
}

export function useCatalogue(): CatalogueLookup {
  const s = useSyncExternalStore(subscribe, () => state);
  useEffect(() => { loadCatalogue(); }, []);
  return useMemo(() => {
    const keys = new Map<string, CatalogueItem>();
    const names = new Map<string, CatalogueItem>();
    for (const i of s.data?.items ?? []) { keys.set(i.key, i); names.set(i.name.toLowerCase(), i); }
    return { catalogue: s.data, error: s.error, byKey: (k: string) => keys.get(k), byName: (n: string) => names.get(n.toLowerCase()) };
  }, [s.data, s.error]);
}

// "In library" marks belong to one person, so another user signing in on this browser must not see the previous user's.
onSignedInUserChange(resetCatalogueStore);
