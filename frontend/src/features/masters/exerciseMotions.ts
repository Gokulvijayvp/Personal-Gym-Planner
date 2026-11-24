/**
 * Figures for the exercise icons. Each motion is a small stick figure drawn in a 100 x 100 box.
 * A coordinate is a number (fixed) or [start, peak]: it moves start -> peak -> start, in a loop.
 * So a point such as [[38, 36], [44, 22]] has x going 38 -> 36 and y going 44 -> 22.
 */
export type N = number | [number, number];
export type Pt = [N, N];

export type Shape =
  | { t: "line"; a: Pt; b: Pt; w?: number; faint?: boolean }
  | { t: "dot"; c: Pt; r: number; solid?: boolean };

export interface Motion {
  label: string;
  seconds: number;     // length of one repetition
  shapes: Shape[];
}

/** A chain of joints, e.g. limb(shoulder, elbow, hand) = two connected segments. */
const limb = (...pts: Pt[]): Shape[] => pts.slice(1).map((b, i): Shape => ({ t: "line", a: pts[i], b }));
const dot = (c: Pt, r: number, solid = false): Shape => ({ t: "dot", c, r, solid });
const head = (c: Pt): Shape => dot(c, 7);
const ground = (y = 92): Shape => ({ t: "line", a: [14, y], b: [86, y], faint: true });
const barbell = (cx: number, y: N, half: number): Shape[] => [
  { t: "line", a: [cx - half, y], b: [cx + half, y], w: 3 },
  dot([cx - half, y], 4, true), dot([cx + half, y], 4, true),
];
/** Upright body used by several standing exercises. */
const standing = (): Shape[] => [
  head([50, 20]), ...limb([50, 28], [50, 58]), ...limb([50, 58], [43, 88]), ...limb([50, 58], [57, 88]),
];

export const MOTION_FIGURES: Record<string, Motion> = {
  press: {
    label: "Press", seconds: 1.8,
    shapes: [
      ground(), ...standing(),
      ...limb([50, 32], [[38, 36], [44, 22]], [34, [34, 10]]),
      ...limb([50, 32], [[62, 64], [44, 22]], [66, [34, 10]]),
      ...barbell(50, [34, 10], 34),
    ],
  },
  curl: {
    label: "Curl", seconds: 1.8,
    shapes: [
      ground(), ...standing(),
      ...limb([50, 32], [40, 52], [38, [72, 38]]),
      ...limb([50, 32], [60, 52], [62, [72, 38]]),
      dot([38, [72, 38]], 4, true), dot([62, [72, 38]], 4, true),
    ],
  },
  squat: {
    label: "Squat", seconds: 2,
    shapes: [
      ground(),
      head([50, [20, 38]]), ...limb([50, [28, 46]], [50, [58, 70]]),
      ...limb([50, [58, 70]], [[44, 32], [74, 78]], [44, 90]),
      ...limb([50, [58, 70]], [[56, 68], [74, 78]], [56, 90]),
      ...limb([50, [32, 50]], [34, [44, 58]], [36, [32, 50]]),
      ...limb([50, [32, 50]], [66, [44, 58]], [64, [32, 50]]),
      ...barbell(50, [32, 50], 30),
    ],
  },
  lunge: {
    label: "Lunge", seconds: 2,
    shapes: [
      ground(),
      head([50, [20, 30]]), ...limb([50, [28, 38]], [50, [58, 66]]),
      ...limb([50, [58, 66]], [[60, 70], [68, 72]], [[62, 70], 90]),
      ...limb([50, [58, 66]], [[42, 36], [80, 84]], [[34, 26], 90]),
      ...limb([50, [32, 42]], [44, [56, 66]]), ...limb([50, [32, 42]], [56, [56, 66]]),
      dot([44, [56, 66]], 4, true), dot([56, [56, 66]], 4, true),
    ],
  },
  row: {
    label: "Row", seconds: 1.8,
    shapes: [
      ground(),
      head([26, 32]), ...limb([32, 36], [62, 56]), ...limb([62, 56], [58, 74], [56, 90]),
      ...limb([32, 36], [[34, 46], [52, 46]], [[36, 46], [68, 54]]),
      dot([[36, 46], [68, 54]], 4, true),
    ],
  },
  pullup: {
    label: "Pull-up", seconds: 2.2,
    shapes: [
      { t: "line", a: [16, 8], b: [84, 8], w: 4 },
      head([50, [28, 16]]), ...limb([50, [36, 24]], [50, [62, 50]]),
      ...limb([50, [62, 50]], [46, [76, 64]], [48, [90, 78]]),
      ...limb([50, [62, 50]], [54, [76, 64]], [52, [90, 78]]),
      ...limb([50, [36, 24]], [[42, 34], 22], [34, 8]),
      ...limb([50, [36, 24]], [[58, 66], 22], [66, 8]),
    ],
  },
  raise: {
    label: "Raise", seconds: 2,
    shapes: [
      ground(), ...standing(),
      ...limb([50, 32], [[38, 14], [60, 34]]), ...limb([50, 32], [[62, 86], [60, 34]]),
      dot([[38, 14], [60, 34]], 4, true), dot([[62, 86], [60, 34]], 4, true),
    ],
  },
  deadlift: {
    label: "Hinge", seconds: 2.2,
    shapes: [
      ground(),
      head([[29, 50], [38, 18]]), ...limb([[36, 50], [46, 28]], [54, 58]),
      ...limb([54, 58], [[60, 56], 74], [56, 90]),
      ...limb([[36, 50], [46, 28]], [[42, 54], [76, 64]]),
      dot([[42, 54], [76, 64]], 5, true),
    ],
  },
  crunch: {
    label: "Crunch", seconds: 1.8,
    shapes: [
      { t: "line", a: [14, 86], b: [86, 86], faint: true },
      head([[26, 38], [74, 50]]), ...limb([[34, 46], [78, 56]], [68, 78]),
      ...limb([68, 78], [80, 58], [72, 78]),
      ...limb([[34, 46], [78, 56]], [[30, 42], [68, 44]]),
    ],
  },
  plank: {
    label: "Plank", seconds: 2.6,
    shapes: [
      { t: "line", a: [14, 90], b: [86, 90], faint: true },
      head([22, 50]), ...limb([30, 56], [70, [60, 56]], [88, 82]),
      ...limb([30, 56], [30, 82], [40, 84]),
    ],
  },
  cardio: {
    label: "Cardio", seconds: 0.9,
    shapes: [
      ground(),
      head([50, [20, 17]]), ...limb([50, [28, 25]], [52, [58, 55]]),
      ...limb([52, [58, 55]], [[64, 44], [68, 72]], [[70, 36], 90]),
      ...limb([52, [58, 55]], [[44, 64], [72, 68]], [[36, 70], 90]),
      ...limb([50, [32, 29]], [[60, 40], 40], [[68, 34], [30, 50]]),
      ...limb([50, [32, 29]], [[40, 60], 40], [[34, 50], [30, 68]]),
    ],
  },
  benchpress: {
    label: "Flat bench press", seconds: 1.8,
    shapes: [
      ground(), { t: "line", a: [18, 72], b: [80, 72], w: 4 }, { t: "line", a: [28, 72], b: [28, 90], faint: true }, { t: "line", a: [70, 72], b: [70, 90], faint: true },
      head([72, 62]), ...limb([62, 62], [30, 62]), ...limb([30, 62], [20, 50], [18, 86]),
      ...limb([62, 62], [[68, 62], [52, 38]], [62, [44, 22]]),
      dot([62, [44, 22]], 5, true),
    ],
  },
  incline: {
    label: "Incline press", seconds: 1.8,
    shapes: [
      ground(), { t: "line", a: [34, 74], b: [68, 38], w: 4 },
      head([66, 30]), ...limb([58, 42], [40, 68]), ...limb([40, 68], [24, 64], [22, 90]),
      ...limb([58, 42], [[66, 62], [60, 32]], [60, [24, 8]]),
      dot([60, [24, 8]], 5, true),
    ],
  },
  decline: {
    label: "Decline press", seconds: 1.8,
    shapes: [
      ground(), { t: "line", a: [22, 42], b: [70, 66], w: 4 },
      head([72, 70]), ...limb([60, 62], [34, 48]), ...limb([34, 48], [22, 58], [16, 74]),
      ...limb([60, 62], [[68, 60], [52, 52]], [60, [44, 26]]),
      dot([60, [44, 26]], 5, true),
    ],
  },
  fly: {
    label: "Fly / crossover", seconds: 2,
    shapes: [
      ground(), ...standing(),
      ...limb([50, 32], [[30, 44], 38], [[18, 46], 42]),
      ...limb([50, 32], [[70, 56], 38], [[82, 54], 42]),
      dot([[18, 46], 42], 4, true), dot([[82, 54], 42], 4, true),
    ],
  },
  pushup: {
    label: "Push-up", seconds: 1.8,
    shapes: [
      { t: "line", a: [14, 84], b: [90, 84], faint: true },
      head([[22, 22], [44, 62]]), ...limb([[30, 30], [52, 66]], [88, 82]),
      ...limb([[30, 30], [52, 66]], [[30, 38], [76, 76]], [30, 82]),
    ],
  },
  dip: {
    label: "Dip", seconds: 1.8,
    shapes: [
      { t: "line", a: [18, 56], b: [42, 56], w: 4 }, { t: "line", a: [58, 56], b: [82, 56], w: 4 },
      head([50, [20, 36]]), ...limb([50, [28, 44]], [50, [54, 70]]),
      ...limb([50, [54, 70]], [46, [70, 84]], [52, [88, 94]]), ...limb([50, [54, 70]], [54, [70, 84]], [58, [88, 94]]),
      ...limb([50, [32, 48]], [[32, 26], [42, 54]], [30, 56]), ...limb([50, [32, 48]], [[68, 74], [58, 54]], [70, 56]),
    ],
  },
  pushdown: {
    label: "Pushdown", seconds: 1.6,
    shapes: [
      ground(), ...standing(),
      { t: "line", a: [50, 4], b: [50, [36, 56]], faint: true },
      ...limb([50, 32], [40, 48], [42, [38, 58]]), ...limb([50, 32], [60, 48], [58, [38, 58]]),
      { t: "line", a: [38, [38, 58]], b: [62, [38, 58]], w: 3 },
    ],
  },
  extension: {
    label: "Triceps extension", seconds: 1.8,
    shapes: [
      ground(), ...standing(),
      ...limb([50, 32], [42, 16], [50, [4, 26]]), ...limb([50, 32], [58, 16], [50, [4, 26]]),
      dot([50, [4, 26]], 5, true),
    ],
  },
  shrug: {
    label: "Shrug", seconds: 1.4,
    shapes: [
      ground(),
      head([50, [20, 15]]), ...limb([50, [28, 23]], [50, 58]), ...limb([50, 58], [43, 88]), ...limb([50, 58], [57, 88]),
      { t: "line", a: [38, [31, 25]], b: [62, [31, 25]] },
      ...limb([38, [31, 25]], [36, [48, 42]], [36, [66, 60]]), ...limb([62, [31, 25]], [64, [48, 42]], [64, [66, 60]]),
      dot([36, [66, 60]], 5, true), dot([64, [66, 60]], 5, true),
    ],
  },
  legext: {
    label: "Leg extension", seconds: 1.8,
    shapes: [
      ground(), { t: "line", a: [30, 26], b: [30, 68], faint: true }, { t: "line", a: [30, 68], b: [60, 68], faint: true },
      head([38, 20]), ...limb([38, 28], [40, 62]), ...limb([40, 62], [64, 62]), ...limb([64, 62], [[66, 88], [88, 62]]),
      ...limb([38, 32], [48, 52]),
    ],
  },
  legcurl: {
    label: "Leg curl", seconds: 1.8,
    shapes: [
      ground(), { t: "line", a: [14, 74], b: [80, 74], w: 4 },
      head([16, 62]), ...limb([24, 66], [54, 66]), ...limb([54, 66], [72, 66]), ...limb([72, 66], [[90, 68], [72, 44]]),
      ...limb([26, 66], [34, 56]),
    ],
  },
  bridge: {
    label: "Hip thrust / bridge", seconds: 2,
    shapes: [
      ground(), head([12, 80]), ...limb([22, 82], [[54, 56], [54, 80]]),
      ...limb([[54, 56], [54, 80]], [74, 66], [74, 88]),
      ...limb([22, 82], [34, 84]),
    ],
  },
  calfraise: {
    label: "Calf raise", seconds: 1.4,
    shapes: [
      ground(),
      head([50, [20, 12]]), ...limb([50, [28, 20]], [50, [58, 50]]),
      ...limb([50, [58, 50]], [44, [74, 66]], [44, [88, 80]]), ...limb([50, [58, 50]], [56, [74, 66]], [56, [88, 80]]),
      ...limb([50, [32, 24]], [40, [48, 40]], [38, [62, 54]]), ...limb([50, [32, 24]], [60, [48, 40]], [62, [62, 54]]),
      dot([38, [62, 54]], 4, true), dot([62, [62, 54]], 4, true),
    ],
  },
  legraise: {
    label: "Leg raise", seconds: 2,
    shapes: [
      { t: "line", a: [16, 8], b: [84, 8], w: 4 },
      head([50, 20]), ...limb([50, 28], [50, 54]),
      ...limb([50, 30], [40, 20], [36, 8]), ...limb([50, 30], [60, 20], [64, 8]),
      ...limb([50, 54], [[50, 80], [90, 58]]), ...limb([54, 54], [[54, 84], [92, 60]]),
    ],
  },
  twist: {
    label: "Twist", seconds: 1.6,
    shapes: [
      ground(), head([36, 40]), ...limb([42, 50], [52, 74]),
      ...limb([52, 74], [68, 62], [82, 74]),
      ...limb([42, 52], [[34, 56], 60], [[24, 60], 66]), dot([[24, 60], 66], 5, true),
    ],
  },
  carry: {
    label: "Carry / walk", seconds: 1.2,
    shapes: [
      ground(),
      head([50, [20, 18]]), ...limb([50, [28, 26]], [50, [58, 56]]),
      ...limb([50, [58, 56]], [[44, 56], 60], [[42, 58], 90]), ...limb([50, [58, 56]], [[56, 44], 60], [[58, 42], 90]),
      ...limb([50, [32, 30]], [38, 48], [37, 64]), ...limb([50, [32, 30]], [62, 48], [63, 64]),
      dot([37, 64], 5, true), dot([63, 64], 5, true),
    ],
  },
  generic: {
    label: "Weight", seconds: 1.6,
    shapes: [
      ground(),
      { t: "line", a: [26, [56, 34]], b: [74, [56, 34]], w: 4 },
      { t: "line", a: [24, [46, 24]], b: [24, [66, 44]], w: 7 },
      { t: "line", a: [76, [46, 24]], b: [76, [66, 44]], w: 7 },
    ],
  },
};

export const FALLBACK_MOTION = "generic";
export function motionFor(key: string | null | undefined): Motion {
  return MOTION_FIGURES[key ?? ""] ?? MOTION_FIGURES[FALLBACK_MOTION];
}
