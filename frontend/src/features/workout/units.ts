import type { DistanceUnit, WeightUnit } from "../../types/settings";

/**
 * Logged values are stored in kilograms / kilometres (fixed-point, 3 decimals). The user's preferred unit only
 * changes what is *typed and shown*. Conversion happens at exactly two places, `…ToCanonical` on the way in and
 * `…ToInput` on the way out, and a value is only sent to the server when the user actually edited it, so
 * merely viewing or tabbing through a field can never rewrite what is stored.
 */
const KG_PER_LB = 0.45359237;
const KM_PER_MILE = 1.609344;

export type Parsed = { ok: true; value: number | null } | { ok: false; message: string };

function trimDecimals(value: number, places: number): string {
  const text = value.toFixed(places);
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}

/** Accepts "22.5", "22,5" and ".5"; rejects anything else. Empty means "no value". */
export function parseDecimal(text: string): Parsed & { raw?: number } {
  const t = text.trim().replace(",", ".");
  if (t === "") return { ok: true, value: null };
  if (!/^\d*\.?\d+$|^\d+\.$/.test(t)) return { ok: false, message: "Enter a number, e.g. 22.5." };
  return { ok: true, value: Number(t) };
}

export function parseWholeNumber(text: string, max: number): Parsed {
  const t = text.trim();
  if (t === "") return { ok: true, value: null };
  if (!/^\d+$/.test(t)) return { ok: false, message: "Use a whole number." };
  const n = Number(t);
  return n > max ? { ok: false, message: `Must be ${max} or less.` } : { ok: true, value: n };
}

const round = (value: number, places: number) => Number(value.toFixed(places));

// ---- weight --------------------------------------------------------------------------------------
export function weightToInput(kg: number | null, unit: WeightUnit): string {
  if (kg === null) return "";
  return unit === "lbs" ? trimDecimals(kg / KG_PER_LB, 2) : trimDecimals(kg, 3);
}

export function weightToCanonical(text: string, unit: WeightUnit): Parsed {
  const p = parseDecimal(text);
  if (!p.ok || p.value === null) return p;
  const decimals = text.trim().replace(",", ".").split(".")[1]?.length ?? 0;
  if (decimals > (unit === "lbs" ? 2 : 3)) return { ok: false, message: unit === "lbs" ? "Use at most 2 decimals." : "Use at most 3 decimals." };
  const kg = round(unit === "lbs" ? p.value * KG_PER_LB : p.value, 3);
  return kg > 1000 ? { ok: false, message: `Must be ${unit === "lbs" ? "2204" : "1000"} ${unit} or less.` } : { ok: true, value: kg };
}

export function weightLabel(kg: number | null, unit: WeightUnit): string {
  return kg === null ? "" : `${weightToInput(kg, unit)} ${unit}`;
}

// ---- distance ------------------------------------------------------------------------------------
export function distanceToInput(km: number | null, unit: DistanceUnit): string {
  if (km === null) return "";
  return unit === "miles" ? trimDecimals(km / KM_PER_MILE, 2) : trimDecimals(km, 3);
}

export function distanceToCanonical(text: string, unit: DistanceUnit): Parsed {
  const p = parseDecimal(text);
  if (!p.ok || p.value === null) return p;
  const decimals = text.trim().replace(",", ".").split(".")[1]?.length ?? 0;
  if (decimals > (unit === "miles" ? 2 : 3)) return { ok: false, message: unit === "miles" ? "Use at most 2 decimals." : "Use at most 3 decimals." };
  const km = round(unit === "miles" ? p.value * KM_PER_MILE : p.value, 3);
  return km > 1000 ? { ok: false, message: "That distance is too large." } : { ok: true, value: km };
}

export function distanceLabel(km: number | null, unit: DistanceUnit): string {
  return km === null ? "" : `${distanceToInput(km, unit)} ${unit}`;
}

// ---- speed (follows the distance unit: km/h or mph) -------------------------------------------------
export const speedUnit = (unit: DistanceUnit) => (unit === "miles" ? "mph" : "km/h");

export function speedToInput(kmh: number | null, unit: DistanceUnit): string {
  if (kmh === null) return "";
  return unit === "miles" ? trimDecimals(kmh / KM_PER_MILE, 2) : trimDecimals(kmh, 2);
}

export function speedToCanonical(text: string, unit: DistanceUnit): Parsed {
  const p = parseDecimal(text);
  if (!p.ok || p.value === null) return p;
  const decimals = text.trim().replace(",", ".").split(".")[1]?.length ?? 0;
  if (decimals > 2) return { ok: false, message: "Use at most 2 decimals." };
  const kmh = round(unit === "miles" ? p.value * KM_PER_MILE : p.value, 2);
  return kmh > 200 ? { ok: false, message: "That speed is too high." } : { ok: true, value: kmh };
}

// ---- time ----------------------------------------------------------------------------------------
/** 3725 -> "1:02:05"; 125 -> "2:05". */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}

/** 3725 -> "1 h 2 min"; 125 -> "2 min"; 40 -> "< 1 min". */
export function formatDurationShort(totalSeconds: number): string {
  const minutes = Math.floor(Math.max(0, totalSeconds) / 60);
  if (minutes < 1) return "< 1 min";
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return h > 0 ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}
