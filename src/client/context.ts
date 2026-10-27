/** Minimal host services used by the browser plugin. */
export interface ClientContext {
  sessions: {
    list: {
      getSnapshot(): {
        current?: string;
        /** Newer hosts publish selection ownership separately from the catalog. */
        byId?: Record<string, { id: string; retainedBy?: { mainView?: number } }>;
      };
      subscribe(callback: () => void): () => void;
    };
  };
  connection: {
    rpc: {
      call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<{
        ok: boolean;
        value?: unknown;
      }>;
    };
  };
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  effect(callback: () => () => void): unknown;
}
