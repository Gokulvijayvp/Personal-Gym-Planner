const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * The automatic name for a new set: "Chest A", then "Chest B" and so on. It takes the first letter that is not
 * used yet (ignoring case), so deleting "Chest A" frees it up again. After Z it carries on with "Chest 27".
 */
export function nextSetName(muscle: string, existing: string[]): string {
  const used = new Set(existing.map((n) => n.trim().toLowerCase()));
  for (const letter of LETTERS) {
    const name = `${muscle} ${letter}`;
    if (!used.has(name.toLowerCase())) return name;
  }
  for (let n = LETTERS.length + 1; ; n++) {
    const name = `${muscle} ${n}`;
    if (!used.has(name.toLowerCase())) return name;
  }
}
