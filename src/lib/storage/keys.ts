/** Central registry of every localStorage key the app uses, namespaced to avoid collisions. */
export const STORAGE_KEYS = {
  followedJournalIds: "stats-feed:followed-journal-ids",
  seenArticleIds: "stats-feed:seen-article-ids",
  /** Timestamp (ms) marking the end of the last distinct visit/session (the "previous visit" baseline). */
  previousVisitAt: "stats-feed:previous-visit-at",
  /** Timestamp (ms) of the most recent activity seen, used to detect when a new session has begun. */
  lastActivityAt: "stats-feed:last-activity-at",
  /** Where the user was last reading, for "continue where you left off". */
  continueReadingPosition: "stats-feed:continue-reading-position",
  firstRunNoticeDismissed: "stats-feed:first-run-dismissed",
  /**
   * Full Article snapshots (not just ids) so a saved article stays viewable
   * in the Saved tab even after its journal is unfollowed or it ages out of
   * the live feed window. Supersedes the old id-only "bookmarked-article-ids"
   * key from V1, which is no longer read or written.
   */
  bookmarkedArticles: "stats-feed:bookmarked-articles-v2",
  openAlexSourceCache: "stats-feed:openalex-source-cache",
  openAlexWorksCache: "stats-feed:openalex-works-cache",
} as const;
