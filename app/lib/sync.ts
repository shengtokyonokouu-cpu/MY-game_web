import { validateLibrary, type Library, type PersonalEntry } from "./catalog.ts";
export type Conflict = { id: string; local: PersonalEntry | null; remote: PersonalEntry | null };
export type CloudSnapshot = { entries: Library; version: number };

// The remote side of each unresolved conflict is the captured base. Persist the
// conflict IDs as well as edits so a reload cannot turn a conflict into an upload.
export function encodeAccountCache(base: CloudSnapshot, entries: Library, conflicts: Conflict[]) {
  return JSON.stringify({ version: 1, base, entries, conflictIds: conflicts.map(({ id }) => id) });
}
export function decodeAccountCache(raw: string) {
  const cached = JSON.parse(raw);
  if (!cached || (cached.version !== undefined && cached.version !== 1) || !Number.isSafeInteger(cached.base?.version) || cached.base.version < 0) throw new Error("无效的账号缓存版本");
  const entries = validateLibrary({ version: 2, entries: cached.entries });
  const base: CloudSnapshot = { entries: validateLibrary({ version: 2, entries: cached.base.entries }), version: cached.base.version };
  const ids: unknown = cached.conflictIds ?? [];
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || (!Object.hasOwn(entries, id) && !Object.hasOwn(base.entries, id)))) throw new Error("无效的冲突记录");
  const conflicts: Conflict[] = [...new Set<string>(ids)].map((id) => ({ id, local: entries[id] || null, remote: base.entries[id] || null }));
  return { base, entries, conflicts };
}
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
