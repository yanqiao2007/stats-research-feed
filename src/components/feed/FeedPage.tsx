"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bookmark, Info } from "lucide-react";
import type { Article, FeedDataStatus, FeedFilterState } from "@/lib/types";
import { JOURNAL_CATALOG } from "@/lib/journals/catalog";
import { getFeedArticles } from "@/lib/openalex/feed";
import { getContinueState } from "@/lib/feed/continueTarget";
import { parseDateMs, recencyBucket, RECENCY_BUCKET_LABELS, type RecencyBucket } from "@/lib/utils/date";
import { useWatchlist } from "@/hooks/useWatchlist";
import { useSeenState } from "@/hooks/useSeenState";
import { useBookmarks } from "@/hooks/useBookmarks";
import { useVisitTracking } from "@/hooks/useVisitTracking";
import { useFirstRunNotice } from "@/hooks/useFirstRunNotice";
import { useHasMounted } from "@/hooks/useHasMounted";

import { FirstRunNotice } from "./FirstRunNotice";
import { DemoModeBanner } from "./DemoModeBanner";
import { ContinueBanner } from "./ContinueBanner";
import { FeedStatusBar } from "./FeedStatusBar";
import { FeedControls } from "./FeedControls";
import { ArticleCard } from "./ArticleCard";
import { DateGroupHeader } from "./DateGroupHeader";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { LoadingState } from "./LoadingState";
import { JournalManager } from "@/components/journals/JournalManager";
import { InfoDialog } from "@/components/info/InfoDialog";
import { AccountButton } from "@/components/auth/AccountButton";
import { Button } from "@/components/ui/button";

const DEFAULT_FILTERS: FeedFilterState = {
  seen: "all",
  search: "",
  openAccessOnly: false,
  sort: "newest",
};

const BUCKET_ORDER_NEWEST_FIRST: RecencyBucket[] = ["thisWeek", "earlierThisMonth", "older", "undated"];
const BUCKET_ORDER_OLDEST_FIRST: RecencyBucket[] = ["older", "earlierThisMonth", "thisWeek", "undated"];

export function FeedPage() {
  const watchlist = useWatchlist();
  const seenState = useSeenState();
  const bookmarks = useBookmarks();
  const visit = useVisitTracking();
  const firstRun = useFirstRunNotice();

  const hasMounted = useHasMounted();
  const allReady = hasMounted && visit.hydrated;

  const [feedStatus, setFeedStatus] = useState<FeedDataStatus>("loading");
  const [articles, setArticles] = useState<Article[]>([]);
  const [unresolvedJournalIds, setUnresolvedJournalIds] = useState<string[]>([]);
  const [reloadToken, setReloadToken] = useState(0);

  const [journalManagerOpen, setJournalManagerOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [filters, setFilters] = useState<FeedFilterState>(DEFAULT_FILTERS);
  const [journalFilter, setJournalFilter] = useState<string>("all");
  const [highlightedArticleId, setHighlightedArticleId] = useState<string | null>(null);
  const [pendingScrollId, setPendingScrollId] = useState<string | null>(null);

  useEffect(() => {
    if (!allReady) return;
    let cancelled = false;
    // Kicking off an async fetch and reflecting its lifecycle (loading /
    // result / error) in state is exactly what this effect exists to do.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFeedStatus("loading");

    getFeedArticles(watchlist.followedJournals)
      .then((result) => {
        if (cancelled) return;
        setArticles(result.articles);
        setUnresolvedJournalIds(result.unresolvedJournalIds);
        setFeedStatus(result.status);
      })
      .catch(() => {
        if (cancelled) return;
        setFeedStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [allReady, watchlist.followedJournals, reloadToken]);

  // In Saved mode, the journal dropdown should also offer journals behind a
  // bookmark that's no longer followed — otherwise there'd be no way to
  // filter Saved down to that article's journal.
  const journalOptions = useMemo(() => {
    if (filters.seen !== "saved") return watchlist.followedJournals;
    const followedIds = new Set(watchlist.followedJournals.map((j) => j.id));
    const savedJournalIds = new Set(bookmarks.bookmarkedArticles.map((a) => a.journalId));
    const extraJournals = JOURNAL_CATALOG.filter(
      (journal) => savedJournalIds.has(journal.id) && !followedIds.has(journal.id),
    );
    return [...watchlist.followedJournals, ...extraJournals].sort((a, b) => a.name.localeCompare(b.name));
  }, [filters.seen, watchlist.followedJournals, bookmarks.bookmarkedArticles]);

  // If the journal currently selected in the per-journal display filter is no
  // longer a valid option (its dropdown entry disappeared — e.g. unfollowed
  // and not covered by a Saved-mode exception above), reset to "all" rather
  // than silently filtering everything out via a now-orphaned id.
  useEffect(() => {
    if (journalFilter === "all") return;
    const validIds = new Set(journalOptions.map((j) => j.id));
    if (!validIds.has(journalFilter)) {
      // Resetting a now-orphaned filter selection back to "all" in response to
      // an external change (the watchlist) — same pattern as the fetch effect above.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setJournalFilter("all");
    }
  }, [journalFilter, journalOptions]);

  const isNewArticle = useCallback(
    (article: Article) => {
      if (visit.previousVisitAt === null) return false;
      const ms = parseDateMs(article.publicationDate);
      return ms !== null && ms > visit.previousVisitAt;
    },
    [visit.previousVisitAt],
  );

  const unseenCount = useMemo(
    () => articles.filter((a) => !seenState.seenArticleIds.has(a.id)).length,
    [articles, seenState.seenArticleIds],
  );

  const newSinceLastVisit = useMemo(
    () => (visit.previousVisitAt === null ? null : articles.filter(isNewArticle).length),
    [articles, visit.previousVisitAt, isNewArticle],
  );

  const filteredSorted = useMemo(() => {
    let list: Article[] = filters.seen === "saved" ? bookmarks.bookmarkedArticles : articles;

    if (filters.seen === "unseen") list = list.filter((a) => !seenState.seenArticleIds.has(a.id));
    else if (filters.seen === "seen") list = list.filter((a) => seenState.seenArticleIds.has(a.id));

    if (journalFilter !== "all") list = list.filter((a) => a.journalId === journalFilter);
    if (filters.openAccessOnly) list = list.filter((a) => a.isOpenAccess === true);

    const q = filters.search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          a.journalName.toLowerCase().includes(q) ||
          a.authors.some((name) => name.toLowerCase().includes(q)) ||
          (a.abstract?.toLowerCase().includes(q) ?? false),
      );
    }

    return [...list].sort((a, b) => {
      const aMs = parseDateMs(a.publicationDate) ?? -Infinity;
      const bMs = parseDateMs(b.publicationDate) ?? -Infinity;
      return filters.sort === "newest" ? bMs - aMs : aMs - bMs;
    });
  }, [articles, bookmarks.bookmarkedArticles, journalFilter, filters, seenState.seenArticleIds]);

  const groupedEntries = useMemo(() => {
    const buckets: Record<RecencyBucket, Article[]> = {
      thisWeek: [],
      earlierThisMonth: [],
      older: [],
      undated: [],
    };
    for (const article of filteredSorted) {
      buckets[recencyBucket(article.publicationDate)].push(article);
    }
    const bucketOrder = filters.sort === "oldest" ? BUCKET_ORDER_OLDEST_FIRST : BUCKET_ORDER_NEWEST_FIRST;
    return bucketOrder.map((bucket) => [bucket, buckets[bucket]] as const).filter(
      ([, items]) => items.length > 0,
    );
  }, [filteredSorted, filters.sort]);

  const hasActiveFilters =
    filters.search !== "" ||
    filters.seen !== "all" ||
    filters.openAccessOnly ||
    filters.sort !== "newest" ||
    journalFilter !== "all";

  const clearFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    setJournalFilter("all");
  }, []);

  // Derived, not persisted — see Issue 3 in the Zhou remediation. Recomputes
  // from the full (unfiltered) article set for the current watchlist plus
  // the manually-maintained seen set, so it can never go stale and never
  // depends on scroll position, hover, or viewport.
  const continueState = useMemo(
    () => getContinueState(articles, seenState.seenArticleIds),
    [articles, seenState.seenArticleIds],
  );

  // Retries once `groupedEntries` changes (e.g. after clearFilters() re-renders
  // the list), since the target element may not exist in the DOM yet on the
  // same render that requested the scroll.
  useEffect(() => {
    if (!pendingScrollId) return;
    const id = pendingScrollId;
    const el = document.getElementById(`article-${id}`);
    if (!el) return;

    // Imperative DOM scroll plus the highlight state that accompanies it —
    // an external-system sync, not state derived from props/state.
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPendingScrollId(null);
    setHighlightedArticleId(id);
    const timer = setTimeout(
      () => setHighlightedArticleId((current) => (current === id ? null : current)),
      2500,
    );
    return () => clearTimeout(timer);
  }, [pendingScrollId, groupedEntries]);

  const handleContinue = useCallback(() => {
    if (continueState.kind !== "target") return;
    // The target may be hidden by an active search/seen-filter/OA/journal
    // filter — clear them first so it's guaranteed to be in the DOM to
    // scroll to.
    clearFilters();
    setPendingScrollId(continueState.article.id);
  }, [continueState, clearFilters]);

  const showLoading = !allReady || feedStatus === "loading";

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-start justify-between gap-4 px-4 py-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground">STATS Research Feed</h1>
            <p className="text-sm text-muted-foreground">Your personalized research inbox.</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <AccountButton />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setInfoOpen(true)}
              className="shrink-0 gap-1.5 text-muted-foreground"
            >
              <Info className="h-3.5 w-3.5" />
              About
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-4 py-6">
        {allReady && !firstRun.dismissed && <FirstRunNotice onDismiss={firstRun.dismiss} />}

        {feedStatus === "demo" && <DemoModeBanner unresolvedJournalCount={unresolvedJournalIds.length} />}

        {continueState.kind !== "hidden" && <ContinueBanner state={continueState} onContinue={handleContinue} />}

        <FeedStatusBar
          totalShown={filteredSorted.length}
          unseenCount={unseenCount}
          newSinceLastVisit={newSinceLastVisit}
          journalsFollowed={watchlist.followedCount}
        />

        <FeedControls
          filters={filters}
          onFiltersChange={setFilters}
          journalFilter={journalFilter}
          onJournalFilterChange={setJournalFilter}
          journalOptions={journalOptions}
          onOpenJournalManager={() => setJournalManagerOpen(true)}
          onClearFilters={clearFilters}
          hasActiveFilters={hasActiveFilters}
        />

        {showLoading ? (
          <LoadingState />
        ) : feedStatus === "error" && filters.seen !== "saved" ? (
          <ErrorState onRetry={() => setReloadToken((t) => t + 1)} />
        ) : filters.seen !== "saved" && watchlist.followedCount === 0 ? (
          <EmptyState
            title="No journals followed"
            description="Your watchlist is empty. Add journals to start seeing research in your feed."
            action={{ label: "Manage journals", onClick: () => setJournalManagerOpen(true) }}
          />
        ) : filters.seen === "saved" && bookmarks.bookmarkedArticles.length === 0 ? (
          <EmptyState
            title="No saved articles yet"
            description="Use the bookmark button on any article to save it here — even if you later unfollow its journal."
            icon={<Bookmark className="h-6 w-6" aria-hidden="true" />}
          />
        ) : groupedEntries.length === 0 ? (
          <EmptyState
            title="No articles match your filters"
            description="Try adjusting your search, seen status, or Open Access filter."
            action={{ label: "Clear filters", onClick: clearFilters }}
          />
        ) : (
          <div className="space-y-4">
            {groupedEntries.map(([bucket, items]) => (
              <section key={bucket} aria-label={RECENCY_BUCKET_LABELS[bucket]}>
                <DateGroupHeader label={RECENCY_BUCKET_LABELS[bucket]} count={items.length} />
                <div className="space-y-3">
                  {items.map((article) => (
                    <ArticleCard
                      key={article.id}
                      article={article}
                      isSeen={seenState.seenArticleIds.has(article.id)}
                      isNew={isNewArticle(article)}
                      isBookmarked={bookmarks.isBookmarked(article.id)}
                      onToggleSeen={() => seenState.toggleSeen(article.id)}
                      onToggleBookmark={() => bookmarks.toggleBookmark(article)}
                      isContinueTarget={highlightedArticleId === article.id}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>

      <JournalManager
        open={journalManagerOpen}
        onOpenChange={setJournalManagerOpen}
        journals={JOURNAL_CATALOG}
        followedJournalIds={watchlist.followedJournalIds}
        onToggleJournal={watchlist.toggleJournal}
        onSelectAll={watchlist.selectAll}
        onClearAll={watchlist.clearAll}
        onRestoreDefaults={watchlist.restoreDefaults}
        unresolvedJournalIds={unresolvedJournalIds}
      />

      <InfoDialog open={infoOpen} onOpenChange={setInfoOpen} />
    </div>
  );
}
