declare module "cloudflare:workers" {
  export const env: Record<string, unknown>;
  export class WorkerEntrypoint<Env = unknown> { protected env: Env; }
}
