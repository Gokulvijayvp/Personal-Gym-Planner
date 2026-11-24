/** Mirrors backend `app.schemas.exercise_catalogue`. */
export interface CatalogueMedia { id: number; kind: "image" | "video"; content_type: string; url: string }

export interface CatalogueItem {
  key: string;
  name: string;
  muscle_group: string;
  target_area: string | null;
  equipment: string;
  icon_motion: string;
  /** Free-text movement description (exercises the admin added). */
  movement?: string | null;
  /** Added by the admin rather than built in. */
  custom?: boolean;
  in_library: boolean;
  exercise_id: number | null;
  /** Uploaded pictures first, the video last. */
  media?: CatalogueMedia[];
}

export interface Catalogue {
  items: CatalogueItem[];
  /** Muscle groups in display order. */
  muscle_groups: string[];
  motions: Record<string, string>;
}

/** What the admin fills in to add a catalogue exercise. */
export interface CatalogueCreate {
  name: string;
  muscle_group: string;
  target_area: string | null;
  equipment: string;
  movement: string | null;
}
