"use client";

import { useCallback, useSyncExternalStore } from "react";
import { storage } from "@/lib/storage/localStorageAdapter";
import {
  emitSyncOp,
  registerSyncableSlice,
  type SlicePayload,
  type SyncSlice,
} from "@/lib/sync/bus";
import type { Article } from "@/lib/types";

/**
 * Shared external-store implementations for localStorage-backed state,
 * built on `useSyncExternalStore` (React's documented mechanism for
 * synchronizing component state with an external system). This avoids the
 * "read localStorage in a mount effect, then setState" pattern: the
 * server/first-paint snapshot is the default value, and React automatically
 * re-renders with the real persisted value immediately after hydration —
 * no manual "hydrated" flag or effect-driven setState required.
 *
 * ## Relationship to the cloud (V2)
 *
 * localStorage remains the single synchronous source of truth that the UI
 * renders from, signed in or not. That is what keeps the read path free of
 * loading states and keeps the app fully functional offline and
 * signed out. A store that passes a `slice` additionally:
 *
 *   1. emits a `SyncOp` delta on every user-initiated mutation, which the
 *      sync engine pushes to Supabase when a session is active; and
 *   2. registers `snapshot`/`applyRemote`/`resetLocal` so the engine can seed
 *      the cloud from local state on first sign-in, overwrite local state
 *      with the cloud's on load, and clear it on sign-out.
 *
 * Writes arriving *from* the cloud never re-emit an op, so a pull can't echo
 * back as a push.
 */

type Listener = () => void;

export interface IdSetStore {
  useIdSet: () => {
    ids: Set<string>;
    has: (id: string) => boolean;
    add: (id: string) => void;
    remove: (id: string) => void;
    toggle: (id: string) => void;
    setAll: (ids: string[]) => void;
    clear: () => void;
  };
}

export function createPersistedIdSetStore(
  key: string,
  defaultIds: string[],
  slice?: SyncSlice,
): IdSetStore {
  let ids: Set<string> | null = null;
  const serverSnapshot = new Set(defaultIds);
  const listeners = new Set<Listener>();

  function ensureLoaded(): Set<string> {
    if (ids === null) {
      const stored = storage.get<string[] | null>(key, null);
      ids = new Set(stored ?? defaultIds);
    }
    return ids;
  }

  function emit() {
    listeners.forEach((listener) => listener());
  }

  function subscribe(listener: Listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function getSnapshot() {
    return ensureLoaded();
  }

  function getServerSnapshot() {
    return serverSnapshot;
  }

  /** Persist + notify. `op` is emitted only for local, user-initiated changes. */
  function replace(next: Set<string>, op?: Parameters<typeof emitSyncOp>[0]) {
    ids = next;
    storage.set(key, Array.from(next));
    emit();
    if (op) emitSyncOp(op);
  }

  if (slice) {
    registerSyncableSlice(slice, {
      snapshot: (): SlicePayload => ({ ids: Array.from(ensureLoaded()) }),
      applyRemote: (payload: SlicePayload) => {
        // A pull that changes nothing must not hand out a new Set. The
        // watchlist feeds `FeedPage`'s fetch effect via a memo keyed on this
        // identity, so a fresh-but-equal Set on every tab focus would
        // re-run the feed fetch for no reason.
        const current = ensureLoaded();
        const next = new Set(payload.ids);
        if (next.size === current.size && [...next].every((id) => current.has(id))) return;
        replace(next);
      },
      resetLocal: () => {
        // Drop the key entirely rather than writing the defaults, so the slice
        // returns to a genuine "never customized" state.
        ids = new Set(defaultIds);
        storage.remove(key);
        emit();
      },
    });
  }

  function useIdSet() {
    const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

    const has = useCallback((id: string) => value.has(id), [value]);

    const add = useCallback((id: string) => {
      const current = ensureLoaded();
      if (!current.has(id)) {
        replace(new Set(current).add(id), slice && { slice, kind: "add", ids: [id] });
      }
    }, []);

    const remove = useCallback((id: string) => {
      const current = ensureLoaded();
      if (current.has(id)) {
        const next = new Set(current);
        next.delete(id);
        replace(next, slice && { slice, kind: "remove", ids: [id] });
      }
    }, []);

    const toggle = useCallback((id: string) => {
      const current = ensureLoaded();
      const next = new Set(current);
      const wasPresent = next.has(id);
      if (wasPresent) next.delete(id);
      else next.add(id);
      replace(next, slice && { slice, kind: wasPresent ? "remove" : "add", ids: [id] });
    }, []);

    const setAll = useCallback((newIds: string[]) => {
      replace(new Set(newIds), slice && { slice, kind: "replace", ids: newIds });
    }, []);

    const clear = useCallback(() => {
      replace(new Set(), slice && { slice, kind: "replace", ids: [] });
    }, []);

    return { ids: value, has, add, remove, toggle, setAll, clear };
  }

  return { useIdSet };
}

export interface EntityStore<T> {
  useEntities: () => {
    entities: Map<string, T>;
    has: (id: string) => boolean;
    toggle: (item: T) => void;
    remove: (id: string) => void;
    clear: () => void;
  };
}

/**
 * Like `createPersistedIdSetStore`, but persists full objects (keyed by a
 * caller-supplied id) instead of bare ids. Use this when a saved item needs
 * to remain renderable independent of whatever live collection it came
 * from — e.g. a bookmarked article must stay viewable even if its journal is
 * later unfollowed and it drops out of the main feed fetch entirely.
 */
export function createPersistedEntityStore<T>(
  key: string,
  getId: (item: T) => string,
  slice?: SyncSlice,
): EntityStore<T> {
  let entities: Map<string, T> | null = null;
  const serverSnapshot = new Map<string, T>();
  const listeners = new Set<Listener>();

  function ensureLoaded(): Map<string, T> {
    if (entities === null) {
      const stored = storage.get<T[] | null>(key, null);
      entities = new Map((stored ?? []).map((item) => [getId(item), item]));
    }
    return entities;
  }

  function emit() {
    listeners.forEach((listener) => listener());
  }

  function subscribe(listener: Listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function getSnapshot() {
    return ensureLoaded();
  }

  function getServerSnapshot() {
    return serverSnapshot;
  }

  function replace(next: Map<string, T>, op?: Parameters<typeof emitSyncOp>[0]) {
    entities = next;
    storage.set(key, Array.from(next.values()));
    emit();
    if (op) emitSyncOp(op);
  }

  if (slice) {
    /**
     * The only entity store that syncs is saved articles, so the cloud payload
     * is typed as `Article` on the bus. This factory stays generic for local
     * use, which means the two casts below are the one place the generic `T`
     * meets that concrete contract.
     */
    registerSyncableSlice(slice, {
      snapshot: (): SlicePayload => {
        const current = ensureLoaded();
        return {
          ids: Array.from(current.keys()),
          items: Array.from(current.values()) as unknown as Article[],
        };
      },
      applyRemote: (payload: SlicePayload) => {
        const items = (payload.items ?? []) as unknown as T[];
        const next = new Map(items.map((item) => [getId(item), item]));
        // Same identity-stability reasoning as the id-set store above.
        const current = ensureLoaded();
        if (next.size === current.size && [...next.keys()].every((id) => current.has(id))) return;
        replace(next);
      },
      resetLocal: () => {
        entities = new Map();
        storage.remove(key);
        emit();
      },
    });
  }

  function useEntities() {
    const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

    const has = useCallback((id: string) => value.has(id), [value]);

    const toggle = useCallback((item: T) => {
      const current = ensureLoaded();
      const id = getId(item);
      const next = new Map(current);
      const wasPresent = next.has(id);
      if (wasPresent) next.delete(id);
      else next.set(id, item);
      replace(
        next,
        slice &&
          (wasPresent
            ? { slice, kind: "remove", ids: [id] }
            : { slice, kind: "add", ids: [id], items: [item as unknown as Article] }),
      );
    }, []);

    const remove = useCallback((id: string) => {
      const current = ensureLoaded();
      if (current.has(id)) {
        const next = new Map(current);
        next.delete(id);
        replace(next, slice && { slice, kind: "remove", ids: [id] });
      }
    }, []);

    const clear = useCallback(() => {
      replace(new Map(), slice && { slice, kind: "replace", ids: [], items: [] });
    }, []);

    return { entities: value, has, toggle, remove, clear };
  }

  return { useEntities };
}

export interface ValueStore<T> {
  useValue: () => [T, (next: T) => void];
}

export function createPersistedValueStore<T>(key: string, defaultValue: T): ValueStore<T> {
  let loaded = false;
  let value: T = defaultValue;
  const listeners = new Set<Listener>();

  function ensureLoaded(): T {
    if (!loaded) {
      value = storage.get<T>(key, defaultValue);
      loaded = true;
    }
    return value;
  }

  function emit() {
    listeners.forEach((listener) => listener());
  }

  function subscribe(listener: Listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function getSnapshot() {
    return ensureLoaded();
  }

  function getServerSnapshot() {
    return defaultValue;
  }

  function setValue(next: T) {
    value = next;
    loaded = true;
    storage.set(key, next);
    emit();
  }

  function useValue(): [T, (next: T) => void] {
    const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
    const set = useCallback((next: T) => setValue(next), []);
    return [current, set];
  }

  return { useValue };
}
