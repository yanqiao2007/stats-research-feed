"use client";

import { STORAGE_KEYS } from "@/lib/storage/keys";
import { createPersistedIdSetStore } from "./createPersistedStore";

const seenStore = createPersistedIdSetStore(STORAGE_KEYS.seenArticleIds, [], "seen");

/** Persistent seen/unseen tracking for articles. */
export function useSeenState() {
  const { ids: seenArticleIds, has: isSeen, add: markSeen, remove: markUnseen, toggle: toggleSeen } =
    seenStore.useIdSet();

  return { seenArticleIds, isSeen, markSeen, markUnseen, toggleSeen };
}
