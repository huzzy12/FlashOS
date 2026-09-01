/** Typed pub/sub event bus — the kernel's nervous system. */

export type ThemeName = 'flash' | 'light' | 'synthwave';

export interface FlashEventMap {
  'vfs:changed': string;
  'theme:changed': ThemeName;
  'window:opened': string;
  'window:focused': string;
  'window:closed': string;
  'window:minimized': string;
  'window:restored': string;
  'app:launched': string;
  'app:closed': string;
}

export type EventKey = keyof FlashEventMap;
export type Handler<K extends EventKey> = (payload: FlashEventMap[K]) => void;

export interface Bus {
  on<K extends EventKey>(event: K, handler: Handler<K>): () => void;
  off<K extends EventKey>(event: K, handler: Handler<K>): void;
  emit<K extends EventKey>(event: K, payload: FlashEventMap[K]): void;
}

export function createBus(): Bus {
  const listeners = new Map<EventKey, Set<Handler<EventKey>>>();

  return {
    on(event, handler) {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(handler as Handler<EventKey>);
      return () => {
        set?.delete(handler as Handler<EventKey>);
      };
    },
    off(event, handler) {
      listeners.get(event)?.delete(handler as Handler<EventKey>);
    },
    emit(event, payload) {
      const set = listeners.get(event);
      if (!set) return;
      for (const handler of [...set]) {
        try {
          (handler as Handler<typeof event>)(payload);
        } catch (err) {
          console.error(`[events] handler for "${String(event)}" threw`, err);
        }
      }
    }
  };
}
