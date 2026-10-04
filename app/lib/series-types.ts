import type { CatalogGame } from "./catalog.ts";
import type { Franchise } from "./franchises.ts";
export type CharacterProfile = { id: string; name: string; ja?: string; en?: string; description: string; image?: string; sourceUrl: string; imageSourceUrl?: string; credit: string; role: "main" | "cast" };
export type SeriesWork = CatalogGame & { entityId?: string; ipIds?: string[]; year?: number; editionKind?: "original" | "remake" | "collection"; characterIds?: string[]; subseriesIds?: string[] };
export type SeriesIndex = { version: 1; updatedAt: string; items: Franchise[]; stats: { channels: number; works: number; characters: number; withDates: number }; coverage: string; sources: { name: string; url: string }[] };
export type SeriesChannel = { id: string; updatedAt: string; games: SeriesWork[]; characters: Record<string, CharacterProfile>; coverage: string };
