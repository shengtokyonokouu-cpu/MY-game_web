import type { AppEnv } from "./auth";

// Bindings are resolved per request by Cloudflare; no client-supplied owner or identity headers are trusted.
export async function environment(): Promise<AppEnv> { const { env } = await import("cloudflare:workers"); return env as unknown as AppEnv; }
