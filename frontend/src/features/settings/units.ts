import type { DistanceUnit, WeightUnit } from "../../types/settings";

/**
 * Plans and logs are always stored in kg and km. The user's unit preference only changes how a stored
 * value is *shown*: it is converted, never just relabelled (80 kg is "176.4 lbs", not "80 lbs").
 */
const LBS_PER_KG = 2.2046226218;
const MILES_PER_KM = 0.6213711922;

function trim(value: number, decimals = 1): string {
  const text = value.toFixed(decimals);
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}

export function formatWeight(kg: number, unit: WeightUnit): string {
  return unit === "lbs" ? `${trim(kg * LBS_PER_KG)} lbs` : `${trim(kg)} kg`;
}

export function formatDistance(km: number, unit: DistanceUnit): string {
  return unit === "miles" ? `${trim(km * MILES_PER_KM)} miles` : `${trim(km)} km`;
}
