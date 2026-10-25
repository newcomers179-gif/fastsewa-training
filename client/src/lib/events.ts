/** A tiny typed event emitter, so the API client can tell the auth layer what happened without importing React. */
export function createEmitter<Events extends Record<string, unknown>>() {
  const listeners = new Map<keyof Events, Set<(payload: never) => void>>();
  return {
    on<K extends keyof Events>(event: K, listener: (payload: Events[K]) => void): () => void {
      const set = listeners.get(event) ?? new Set();
      set.add(listener as (payload: never) => void);
      listeners.set(event, set);
      return () => {
        set.delete(listener as (payload: never) => void);
      };
    },
    emit<K extends keyof Events>(event: K, payload: Events[K]): void {
      for (const listener of [...(listeners.get(event) ?? [])]) (listener as (p: Events[K]) => void)(payload);
    },
  };
}
