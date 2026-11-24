import type { Catalogue, CatalogueCreate, CatalogueItem, CatalogueMedia } from "../types/catalogue";
import type { Exercise } from "../types/exercise";
import { api } from "./client";

export const catalogueService = {
  list: (signal?: AbortSignal) => api.get<Catalogue>("/exercise-catalogue", { signal }),
  /** Admin only: adds a shared exercise to the catalogue (pictures and videos are uploaded to it afterwards). */
  create: (input: CatalogueCreate) => api.post<CatalogueItem>("/exercise-catalogue", input),
  /** Attaches pictures / videos to one catalogue exercise; returns that exercise's full media list. */
  uploadMedia: (key: string, files: File[]) => {
    const form = new FormData();
    for (const f of files) form.append("files", f);
    return api.post<CatalogueMedia[]>(`/exercise-catalogue/${encodeURIComponent(key)}/media`, form, { timeoutMs: 600_000 });
  },
  deleteMedia: (id: number) => api.delete(`/exercise-catalogue/media/${id}`),
  /** Copies one catalogue exercise into the library. 409 `already_in_library` if it is already there. */
  add: (key: string) => api.post<Exercise>(`/exercise-catalogue/${encodeURIComponent(key)}/add`, {}),
};
