import type { Library, PersonalEntry } from "./catalog.ts";
export type Conflict = { id: string; local: PersonalEntry | null; remote: PersonalEntry | null };
export function sameEntry(a?: PersonalEntry | null, b?: PersonalEntry | null) { return JSON.stringify(a ?? null) === JSON.stringify(b ?? null); }
export function changedIds(before: Library, after: Library) { return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((id) => !sameEntry(before[id], after[id])); }
export function mergeThreeWay(base: Library, local: Library, remote: Library): { entries: Library; conflicts: Conflict[] } {
  const entries = { ...remote }; const conflicts: Conflict[] = [];
  for (const id of changedIds(base, local)) {
    if (!sameEntry(base[id], remote[id]) && !sameEntry(local[id], remote[id])) conflicts.push({ id, local: local[id] || null, remote: remote[id] || null });
    if (local[id]) entries[id] = local[id]; else delete entries[id];
  }
  return { entries, conflicts };
}
