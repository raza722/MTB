/**
 * The mock server's database: small stores that start from the fixtures and persist in sessionStorage,
 * so a demo survives a page reload but every new tab starts fresh. Each feature owns its own stores.
 */
const PREFIX = "mtb.demo.";

export interface Store<T> {
  get(): T;
  set(next: T | ((prev: T) => T)): void;
  reset(): void;
}

const resets = new Map<string, () => void>();

export function createStore<T>(name: string, initial: () => T): Store<T> {
  const key = PREFIX + name;
  let value: T | undefined;

  const load = (): T => {
    if (value !== undefined) return value;
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        value = JSON.parse(raw) as T;
        return value;
      }
    } catch {
      /* storage blocked: memory only */
    }
    value = initial();
    return value;
  };

  const store: Store<T> = {
    get: load,
    set(next) {
      value = typeof next === "function" ? (next as (prev: T) => T)(load()) : next;
      try {
        sessionStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* memory only */
      }
    },
    reset() {
      value = undefined;
      try {
        sessionStorage.removeItem(key);
      } catch {
        /* nothing stored */
      }
    },
  };
  resets.set(name, store.reset);
  return store;
}

/** Puts every store back to its fixtures (Demo controls → Reset demo data). */
export function resetDemoData() {
  for (const reset of resets.values()) reset();
}
