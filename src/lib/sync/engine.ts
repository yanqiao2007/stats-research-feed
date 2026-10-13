/**
 * Local-first sync engine.
 *
 * The model, stated plainly:
 *
 *   * localStorage is always what the UI renders from. Signed out, that is the
 *     whole story and nothing here runs.
 *   * On sign-in, one of two things happens. If the account has never synced
 *     (no `user_settings` row), local state is *seeded upward* into the cloud,
 *     so a researcher who spent months curating a watchlist anonymously keeps
 *     it when they make an account. Otherwise the cloud is authoritative and
 *     overwrites local state.
 *   * While signed in, each mutation is pushed as a delta, and the cloud is
 *     re-pulled on load and when the tab regains focus.
 *
 * Cloud-wins-on-load is a deliberate choice over merge-on-load. A union would
 * resurrect journals the user had deliberately unfollowed and articles they
 * had deliberately marked unseen, because "absent" and "deleted" are
 * indistinguishable in a union. The cost is that a mutation made while
 * genuinely offline is lost if the tab reloads before reconnecting; that is
 * recorded in the README's limitations rather than papered over.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { storage } from "@/lib/storage/localStorageAdapter";
import { STORAGE_KEYS } from "@/lib/storage/keys";
import type { Article } from "@/lib/types";
import {
  getSyncableSlice,
  setSyncOpHandler,
  SYNC_SLICES,
  type SlicePayload,
  type SyncOp,
  type SyncSlice,
} from "./bus";
import { pullRemoteState, pushOp, seedRemoteState } from "./remote";

export type SyncStatus = "off" | "syncing" | "synced" | "error";

export interface SyncState {
  status: SyncStatus;
  /** Epoch ms of the last successful pull, or null. */
  lastSyncedAt: number | null;
  /** User-facing message for the most recent failure, or null. */
  error: string | null;
  /** Local mutations not yet confirmed by the server. */
  pendingWrites: number;
}

const INITIAL_STATE: SyncState = {
  status: "off",
  lastSyncedAt: null,
  error: null,
  pendingWrites: 0,
};

let state: SyncState = INITIAL_STATE;
const listeners = new Set<() => void>();

function setState(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

export function subscribeToSyncState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSyncState(): SyncState {
  return state;
}

/** Stable reference for `useSyncExternalStore`'s server snapshot. */
export function getInitialSyncState(): SyncState {
  return INITIAL_STATE;
}

const UNREACHABLE = "Could not reach the server, so your changes are not synced yet.";

/** Same reasoning as `AuthProvider`'s: a bare "Failed to fetch" helps nobody. */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return "Something went wrong talking to the server.";
  if (/failed to fetch|networkerror|load failed/i.test(error.message)) return UNREACHABLE;
  return error.message;
}

// ---------------------------------------------------------------------------
// Local slice helpers
// ---------------------------------------------------------------------------

function snapshotSlice(slice: SyncSlice): SlicePayload {
  return getSyncableSlice(slice)?.snapshot() ?? { ids: [] };
}

function snapshotAll(): Record<SyncSlice, SlicePayload> {
  return {
    watchlist: snapshotSlice("watchlist"),
    seen: snapshotSlice("seen"),
    saved: snapshotSlice("saved"),
  };
}

/**
 * Pure computation of what a slice looks like after an op, used to replay
 * mutations that landed while the opening pull was still in flight.
 */
function applyOpToPayload(payload: SlicePayload, op: SyncOp): SlicePayload {
  if (op.kind === "replace") {
    return { ids: op.ids, items: op.items };
  }

  const removing = op.kind === "remove";
  const target = new Set(op.ids);

  if (payload.items) {
    const byId = new Map<string, Article>(payload.items.map((item) => [item.id, item]));
    if (removing) target.forEach((id) => byId.delete(id));
    else (op.items ?? []).forEach((item) => byId.set(item.id, item));
    return { ids: Array.from(byId.keys()), items: Array.from(byId.values()) };
  }

  const ids = new Set(payload.ids);
  if (removing) target.forEach((id) => ids.delete(id));
  else target.forEach((id) => ids.add(id));
  return { ids: Array.from(ids) };
}

// ---------------------------------------------------------------------------
// Sync-owner bookkeeping
// ---------------------------------------------------------------------------

/**
 * Which account the state currently in this browser belongs to, or null if it
 * is anonymous.
 *
 * This exists to stop one person's local state leaking into another person's
 * fresh account on a shared machine — a real risk on a lab computer. Local
 * state is only ever seeded upward into an account that is either anonymous or
 * already the same user's.
 */
function readSyncOwner(): string | null {
  return storage.get<string | null>(STORAGE_KEYS.syncOwner, null);
}

function writeSyncOwner(userId: string | null): void {
  if (userId === null) storage.remove(STORAGE_KEYS.syncOwner);
  else storage.set(STORAGE_KEYS.syncOwner, userId);
}

// ---------------------------------------------------------------------------
// Write queue
// ---------------------------------------------------------------------------

/**
 * Ops are pushed strictly in order, one request at a time. Two writes to the
 * same row racing each other would otherwise be able to land out of order and
 * leave the cloud disagreeing with the browser that produced them.
 */
let queue: SyncOp[] = [];
let draining = false;

/** Buffer for ops emitted while a pull is still running. */
let bufferedDuringPull: SyncOp[] | null = null;

/** The in-flight pull, so overlapping callers join it instead of racing it. */
let pullInFlight: Promise<void> | null = null;

/**
 * Bumped by every `stopSync`. A pull that was already in flight when the user
 * signed out captures the old value and must then discard its result —
 * otherwise the response lands *after* local state was cleared and silently
 * restores the account's data into a signed-out browser.
 */
let generation = 0;

let activeClient: SupabaseClient | null = null;
let activeUserId: string | null = null;

function enqueue(op: SyncOp): void {
  if (bufferedDuringPull !== null) {
    bufferedDuringPull.push(op);
    return;
  }
  queue.push(normalizeOp(op));
  setState({ pendingWrites: queue.length });
  void drain();
}

/**
 * The watchlist is stored as one array column, so every watchlist op becomes a
 * whole-value write taken from current local state. That makes it idempotent
 * and collapses a flurry of toggles in "Manage journals" into writes that
 * cannot disagree with what the user sees.
 */
function normalizeOp(op: SyncOp): SyncOp {
  if (op.slice !== "watchlist") return op;
  return { slice: "watchlist", kind: "replace", ids: snapshotSlice("watchlist").ids };
}

async function drain(): Promise<void> {
  if (draining) return;
  const client = activeClient;
  const userId = activeUserId;
  if (!client || !userId) return;

  draining = true;
  try {
    while (queue.length > 0) {
      const op = queue[0];
      try {
        await pushOp(client, userId, op);
        queue.shift();
        setState({ pendingWrites: queue.length, error: null });
      } catch (error) {
        // Drop the op rather than retrying forever: the next pull reconciles
        // this browser with the cloud anyway, and an endlessly retried bad op
        // would block every write behind it.
        queue.shift();
        setState({
          pendingWrites: queue.length,
          status: "error",
          error: describeError(error),
        });
      }
    }
  } finally {
    draining = false;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Brings this browser into sync with `userId`'s account and starts pushing
 * subsequent local changes. Safe to call repeatedly for the same user — later
 * calls act as a plain refresh.
 */
export async function startSync(client: SupabaseClient, userId: string): Promise<void> {
  // Focus events can fire while the opening pull is still running. Without
  // this guard the second call would replace the first's op buffer and the
  // clicks collected in it would vanish.
  if (pullInFlight) return pullInFlight;

  activeClient = client;
  activeUserId = userId;

  // Install the handler *before* awaiting anything, so a click during the
  // pull is captured rather than silently lost — on a refresh as much as on
  // a first sign-in, since both end by overwriting local state.
  bufferedDuringPull = [];
  setSyncOpHandler(enqueue);
  setState({ status: "syncing", error: null });

  pullInFlight = runPull(client, userId).finally(() => {
    pullInFlight = null;
  });
  return pullInFlight;
}

async function runPull(client: SupabaseClient, userId: string): Promise<void> {
  const startedAt = generation;
  const isStale = () => generation !== startedAt;

  try {
    const remote = await pullRemoteState(client, userId);
    if (isStale()) return;

    const ownerBefore = readSyncOwner();

    if (remote.watchlist === null) {
      // A brand-new account. Seed it from local state, but only if that state
      // is this user's or nobody's.
      const localBelongsToSomeoneElse = ownerBefore !== null && ownerBefore !== userId;
      if (localBelongsToSomeoneElse) {
        SYNC_SLICES.forEach((slice) => getSyncableSlice(slice)?.resetLocal());
      }
      await seedRemoteState(client, userId, snapshotAll());
    } else {
      // An established account: the cloud is authoritative.
      getSyncableSlice("watchlist")?.applyRemote({ ids: remote.watchlist });
      getSyncableSlice("seen")?.applyRemote({ ids: remote.seen });
      getSyncableSlice("saved")?.applyRemote({
        ids: remote.saved.map((article) => article.id),
        items: remote.saved,
      });
    }

    writeSyncOwner(userId);
    setState({ status: "synced", lastSyncedAt: Date.now(), error: null });
  } catch (error) {
    if (!isStale()) setState({ status: "error", error: describeError(error) });
  } finally {
    // Replay anything the user did while the pull was in flight, so their
    // click survives the state that just landed on top of it. After a
    // sign-out there is nothing left to replay onto.
    const buffered = bufferedDuringPull ?? [];
    bufferedDuringPull = null;
    if (!isStale()) {
      for (const op of buffered) {
        const slice = getSyncableSlice(op.slice);
        if (slice) slice.applyRemote(applyOpToPayload(slice.snapshot(), op));
        enqueue(op);
      }
    }
  }
}

/** Re-pulls the cloud's state. Used by "Sync now" and on tab focus. */
export async function refreshSync(): Promise<void> {
  if (!activeClient || !activeUserId) return;
  await startSync(activeClient, activeUserId);
}

/**
 * Stops syncing.
 *
 * `clearLocal` is true for an explicit sign-out: the synced slices are wiped
 * from this browser so the next person to open the app on a shared machine
 * does not inherit the previous user's watchlist and reading history. The data
 * itself is untouched in the account. It is false when a session merely
 * expires, where silently deleting someone's visible state would be alarming.
 */
export function stopSync(options: { clearLocal: boolean }): void {
  generation += 1;
  setSyncOpHandler(null);
  queue = [];
  bufferedDuringPull = null;
  pullInFlight = null;
  activeClient = null;
  activeUserId = null;

  if (options.clearLocal) {
    SYNC_SLICES.forEach((slice) => getSyncableSlice(slice)?.resetLocal());
    writeSyncOwner(null);
  }

  state = INITIAL_STATE;
  listeners.forEach((listener) => listener());
}
