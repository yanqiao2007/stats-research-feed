"use client";

import { Search, X, Settings2 } from "lucide-react";
import type { FeedFilterState, FeedSeenFilter } from "@/lib/types";
import type { JournalDefinition } from "@/lib/journals/catalog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils/cn";

interface FeedControlsProps {
  filters: FeedFilterState;
  onFiltersChange: (next: FeedFilterState) => void;
  journalFilter: string;
  onJournalFilterChange: (id: string) => void;
  journalOptions: JournalDefinition[];
  onOpenJournalManager: () => void;
  onClearFilters: () => void;
  hasActiveFilters: boolean;
}

const SEEN_OPTIONS: { value: FeedSeenFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unseen", label: "Unseen" },
  { value: "seen", label: "Seen" },
  { value: "saved", label: "Saved" },
];

export function FeedControls({
  filters,
  onFiltersChange,
  journalFilter,
  onJournalFilterChange,
  journalOptions,
  onOpenJournalManager,
  onClearFilters,
  hasActiveFilters,
}: FeedControlsProps) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search titles, authors, abstracts…"
            value={filters.search}
            onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
            className="pl-8"
            aria-label="Search articles"
          />
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onOpenJournalManager} className="gap-1.5">
            <Settings2 className="h-3.5 w-3.5" />
            Manage journals
          </Button>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={onClearFilters} className="gap-1.5 text-muted-foreground">
              <X className="h-3.5 w-3.5" />
              Clear filters
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div
          role="group"
          aria-label="Filter by seen status"
          className="inline-flex overflow-hidden rounded-md border border-input"
        >
          {SEEN_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={filters.seen === option.value}
              onClick={() => onFiltersChange({ ...filters, seen: option.value })}
              className={cn(
                "px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:z-10",
                filters.seen === option.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <select
            value={journalFilter}
            onChange={(e) => onJournalFilterChange(e.target.value)}
            className="h-8 rounded-md border border-input bg-card px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Filter by journal"
          >
            <option value="all">All journals</option>
            {journalOptions.map((journal) => (
              <option key={journal.id} value={journal.id}>
                {journal.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <select
            value={filters.sort}
            onChange={(e) => onFiltersChange({ ...filters, sort: e.target.value as FeedFilterState["sort"] })}
            className="h-8 rounded-md border border-input bg-card px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Sort order"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </label>

        <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Switch
            checked={filters.openAccessOnly}
            onCheckedChange={(checked) => onFiltersChange({ ...filters, openAccessOnly: checked })}
            aria-label="Show only open access articles"
          />
          Open Access only
        </label>
      </div>
    </div>
  );
}
