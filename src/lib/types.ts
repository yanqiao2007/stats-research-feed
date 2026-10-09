/**
 * Normalized internal representation of a research article, independent of
 * whichever upstream metadata source (OpenAlex, demo fallback) produced it.
 * UI and persistence code should only ever see this shape.
 */
export interface Article {
  /** Stable identifier. OpenAlex work IDs (e.g. "W123..."), or "demo-..." for fallback data. */
  id: string;
  title: string;
  authors: string[];
  journalId: string;
  journalName: string;
  /** ISO 8601 date (YYYY-MM-DD), or null if OpenAlex did not report one. */
  publicationDate: string | null;
  /** null means "unknown", not "closed access". */
  isOpenAccess: boolean | null;
  /** Plain-text abstract, reconstructed from OpenAlex's inverted index. Null if unavailable. */
  abstract: string | null;
  doi: string | null;
  /** Best available link to the article itself (DOI resolver preferred). */
  articleUrl: string | null;
  source: "openalex" | "demo";
}

export interface JournalWithState {
  id: string;
  name: string;
  publisher?: string;
  followed: boolean;
  confidence: "verified" | "low";
}

export type FeedSeenFilter = "all" | "unseen" | "seen" | "saved";
export type FeedSortOrder = "newest" | "oldest";

export interface FeedFilterState {
  seen: FeedSeenFilter;
  search: string;
  openAccessOnly: boolean;
  sort: FeedSortOrder;
}

export type FeedDataStatus = "loading" | "live" | "demo" | "error";
