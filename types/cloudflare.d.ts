declare module "cloudflare:workers" {
  export const env: Record<string, unknown>;
  export class WorkerEntrypoint<Env = unknown> { protected env: Env; }
  export class DurableObject<Env = unknown> {
    protected env: Env;
    protected ctx: {
      storage: {
        get<T>(key: string): Promise<T | undefined>;
        put(key: string, value: unknown): Promise<void>;
        getAlarm(): Promise<number | null>;
        setAlarm(at: number): Promise<void>;
        deleteAlarm(): Promise<void>;
      };
      blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
    };
  }
}
