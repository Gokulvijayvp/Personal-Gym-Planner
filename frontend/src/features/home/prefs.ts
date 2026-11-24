import type { DateFormat, DistanceUnit, Settings, WeightUnit } from "../../types/settings";
import type { DateString } from "../../types/api";
import { formatWithPreference } from "../settings/settingsForm";

/** The few Settings values Home applies. Read from the Settings API on every visit, never copied or stored here. */
export interface DisplayPrefs {
  displayName: string | null;
  dateFormat: DateFormat;
  weightUnit: WeightUnit;
  distanceUnit: DistanceUnit;
  /** Suggested rest between sets (seconds); shown as a hint, never saved into a record. */
  restBetweenSetsSeconds: number;
}

/** Safe defaults used only if Settings cannot be loaded (same as the backend defaults). */
export const DEFAULT_PREFS: DisplayPrefs = { displayName: null, dateFormat: "DD MMM YYYY", weightUnit: "kg", distanceUnit: "km", restBetweenSetsSeconds: 90 };

export function prefsFrom(settings: Settings | null): DisplayPrefs {
  if (!settings) return DEFAULT_PREFS;
  return {
    displayName: settings.display_name, dateFormat: settings.date_format,
    weightUnit: settings.weight_unit, distanceUnit: settings.distance_unit, restBetweenSetsSeconds: settings.rest_between_sets_seconds,
  };
}

export type DateFormatter = (date: DateString) => string;

export function dateFormatter(prefs: DisplayPrefs): DateFormatter {
  return (d) => formatWithPreference(d, prefs.dateFormat);
}
