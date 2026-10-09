"use client";

import { useCallback, useSyncExternalStore } from "react";
import { storage } from "@/lib/storage/localStorageAdapter";

/**
 * Shared external-store implementations for localStorage-backed state,
 * built on `useSyncExternalStore` (React's documented mechanism for
 * synchronizing component state with an external system). This avoids the
 * "read localStorage in a mount effect, then setState" pattern: the
 * server/first-paint snapshot is the default value, and React automatically
 * re-renders with the real persisted value immediately after hydration —
 * no manual "hydrated" flag or effect-driven setState required.
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

export function createPersistedIdSetStore(key: string, defaultIds: string[]): IdSetStore {
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

  function replace(next: Set<string>) {
    ids = next;
    storage.set(key, Array.from(next));
    emit();
  }

  function useIdSet() {
    const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

    const has = useCallback((id: string) => value.has(id), [value]);

    const add = useCallback((id: string) => {
      const current = ensureLoaded();
      if (!current.has(id)) replace(new Set(current).add(id));
    }, []);

    const remove = useCallback((id: string) => {
      const current = ensureLoaded();
      if (current.has(id)) {
        const next = new Set(current);
        next.delete(id);
        replace(next);
      }
    }, []);

    const toggle = useCallback((id: string) => {
      const current = ensureLoaded();
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      replace(next);
    }, []);

    const setAll = useCallback((newIds: string[]) => replace(new Set(newIds)), []);
    const clear = useCallback(() => replace(new Set()), []);

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
export function createPersistedEntityStore<T>(key: string, getId: (item: T) => string): EntityStore<T> {
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

  function replace(next: Map<string, T>) {
    entities = next;
    storage.set(key, Array.from(next.values()));
    emit();
  }

  function useEntities() {
    const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

    const has = useCallback((id: string) => value.has(id), [value]);

    const toggle = useCallback((item: T) => {
      const current = ensureLoaded();
      const id = getId(item);
      const next = new Map(current);
      if (next.has(id)) next.delete(id);
      else next.set(id, item);
      replace(next);
    }, []);

    const remove = useCallback((id: string) => {
      const current = ensureLoaded();
      if (current.has(id)) {
        const next = new Map(current);
        next.delete(id);
        replace(next);
      }
    }, []);

    const clear = useCallback(() => replace(new Map()), []);

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
