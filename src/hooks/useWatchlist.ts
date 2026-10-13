"use client";

import { useCallback, useMemo } from "react";
import { JOURNAL_CATALOG, DEFAULT_FOLLOWED_JOURNAL_IDS } from "@/lib/journals/catalog";
import { STORAGE_KEYS } from "@/lib/storage/keys";
import { createPersistedIdSetStore } from "./createPersistedStore";

const watchlistStore = createPersistedIdSetStore(
  STORAGE_KEYS.followedJournalIds,
  DEFAULT_FOLLOWED_JOURNAL_IDS,
  "watchlist",
);

/** The user's customizable, persistent journal watchlist. */
export function useWatchlist() {
  const { ids: followedJournalIds, toggle: toggleJournal, setAll, clear } = watchlistStore.useIdSet();

  const selectAll = useCallback(() => {
    setAll(JOURNAL_CATALOG.map((journal) => journal.id));
  }, [setAll]);

  const clearAll = useCallback(() => clear(), [clear]);

  const restoreDefaults = useCallback(() => {
    setAll(DEFAULT_FOLLOWED_JOURNAL_IDS);
  }, [setAll]);

  const followedJournals = useMemo(
    () => JOURNAL_CATALOG.filter((journal) => followedJournalIds.has(journal.id)),
    [followedJournalIds],
  );

  return {
    followedJournalIds,
    followedJournals,
    followedCount: followedJournalIds.size,
    toggleJournal,
    selectAll,
    clearAll,
    restoreDefaults,
  };
}
