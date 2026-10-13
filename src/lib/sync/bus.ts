/**
 * The seam between persisted local state and the cloud.
 *
 * Deliberately dependency-free (no React, no Supabase, no storage adapter) so
 * that `hooks/createPersistedStore.ts` can import it without creating a cycle:
 * the stores *emit* mutations here, and `sync/engine.ts` — which does know
 * about Supabase — subscribes. When nobody is subscribed (signed out, or no
 * Supabase configured) every emit is a no-op and the stores behave exactly as
 * they did in V1.
 */

import type { Article } from "@/lib/types";

/** The three pieces of state an account syncs. Caches and visit timestamps stay local. */
export type SyncSlice = "watchlist" | "seen" | "saved";

export const SYNC_SLICES: readonly SyncSlice[] = ["watchlist", "seen", "saved"] as const;

/**
 * A local mutation, expressed as a delta so the engine can push one row
 * instead of rewriting a user's entire history on every click.
 *
 * `items` is only populated by entity stores (saved articles), which persist
 * whole objects rather than bare ids.
 */
export interface SyncOp {
  slice: SyncSlice;
  kind: "add" | "remove" | "replace";
  ids: string[];
  items?: Article[];
}

/** A point-in-time serialization of one slice, used for seeding and for full replaces. */
export interface SlicePayload {
  ids: string[];
  items?: Article[];
}

/**
 * How the engine reads and writes a slice's local state from outside React.
 * Implemented by the store factories in `hooks/createPersistedStore.ts`.
 */
export interface SyncableSlice {
  /** Current local value. */
  snapshot(): SlicePayload;
  /** Overwrite local value with the cloud's. Must NOT re-emit a `SyncOp`. */
  applyRemote(payload: SlicePayload): void;
  /** Reset to the built-in default (used on sign-out). Must NOT re-emit a `SyncOp`. */
  resetLocal(): void;
}

const slices = new Map<SyncSlice, SyncableSlice>();

/** Called at module-init time by each persisted store that participates in sync. */
export function registerSyncableSlice(slice: SyncSlice, impl: SyncableSlice): void {
  slices.set(slice, impl);
}

export function getSyncableSlice(slice: SyncSlice): SyncableSlice | undefined {
  return slices.get(slice);
}

type OpHandler = (op: SyncOp) => void;

let handler: OpHandler | null = null;

/** Installed by the sync engine while a signed-in session is active. */
export function setSyncOpHandler(next: OpHandler | null): void {
  handler = next;
}

/** Called by stores on every user-initiated mutation. No-op when nothing is listening. */
export function emitSyncOp(op: SyncOp): void {
  handler?.(op);
}
