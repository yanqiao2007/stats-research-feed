"use client";

import { useMemo } from "react";
import type { Article } from "@/lib/types";
import { STORAGE_KEYS } from "@/lib/storage/keys";
import { createPersistedEntityStore } from "./createPersistedStore";

const bookmarksStore = createPersistedEntityStore<Article>(
  STORAGE_KEYS.bookmarkedArticles,
  (article) => article.id,
);

/**
 * Persistent bookmarking. Stores a full snapshot of each saved article (not
 * just its id), so the Saved view can render it independent of the live
 * feed — a bookmark survives unfollowing its journal or the article aging
 * out of the 90-day retrieval window.
 */
export function useBookmarks() {
  const { entities, has: isBookmarked, toggle: toggleBookmark, remove: removeBookmark } =
    bookmarksStore.useEntities();

  const bookmarkedArticles = useMemo(() => Array.from(entities.values()), [entities]);

  return { bookmarkedArticles, isBookmarked, toggleBookmark, removeBookmark };
}
