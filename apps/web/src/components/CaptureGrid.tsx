"use client";

import { useEffect, useMemo, useState, type ReactNode, type RefObject } from "react";
import MasonryLayout, { type MasonryItem } from "@/components/MansoryLayout";
import TextWrapLayout from "@/components/TextWrapLayout";
import LinkList from "@/components/LinkList";
import { MasonrySkeleton, ListSkeleton } from "@/components/Skeletons";
import type { CaptureDetails } from "@/components/DesignDnaPanel";
import { partitionByLayout, type CaptureRow } from "@/lib/capture-feed";
import type { CaptureFeed } from "@/hooks/useCaptureFeed";

type TextItem = { _id: string; kind: "text"; content: string; url: string; timestamp: number; category?: string };
type LinkItem = {
  _id: string;
  kind: "link";
  href: string;
  text?: string;
  url: string;
  title?: string;
  timestamp: number;
  category?: string;
  tags?: string[];
};

function toMasonryItem(r: CaptureRow): MasonryItem {
  return {
    _id: r.id,
    kind: r.kind,
    url: r.imageUrl ?? undefined,
    thumbUrl: r.thumbUrl ?? null,
    designDna: (r.designDna as CaptureDetails["designDna"]) ?? null,
    palette: (r.palette as CaptureDetails["palette"]) ?? null,
    clipped: r.clipped ?? null,
    pageUrl: r.pageUrl ?? undefined,
    width: r.width || 600,
    height: r.height || 400,
    alt: r.alt || r.title || "",
    title: r.title,
    tags: r.tags || [],
    storageId: r.storageId ?? undefined,
    status: r.status,
    error: r.error,
    aiCategory: r.aiCategory,
    aiTags: r.aiTags,
    aiDescription: r.aiDescription,
    sessionId: r.sessionId,
    sessionName: r.sessionName,
  };
}

const toTextItem = (r: CaptureRow): TextItem => ({
  _id: r.id,
  kind: "text",
  content: r.content ?? "",
  url: r.pageUrl ?? "",
  timestamp: r.timestamp,
  category: r.category ?? undefined,
});

const toLinkItem = (r: CaptureRow): LinkItem => ({
  _id: r.id,
  kind: "link",
  href: r.href ?? "",
  text: r.text ?? undefined,
  url: r.pageUrl ?? "",
  title: r.title ?? undefined,
  timestamp: r.timestamp,
  category: r.category ?? undefined,
  tags: r.tags,
});

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-3 text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--text-subtle)]">{children}</h2>
  );
}

/**
 * Asks for the next page while the end of the grid is near. It stays
 * subscribed after each page, so a short or empty page (a filter that matched
 * little of what one page examined) is followed straight away while the grid
 * is still shorter than a screenful.
 */
function useNearEnd(root: RefObject<HTMLElement | null>, target: HTMLElement | null): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (!target) return;
    const observer = new IntersectionObserver(([entry]) => setNear(!!entry?.isIntersecting), {
      root: root.current,
      rootMargin: "0px 0px 800px 0px",
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [root, target]);
  return near;
}

/**
 * The grid: images and screenshots in the masonry, then text and links in
 * their own layouts (titled when more than one kind is showing), then the
 * paging controls.
 */
export default function CaptureGrid({
  feed,
  listSkeleton,
  emptyState,
  scrollRoot,
  onPickColor,
}: {
  feed: CaptureFeed;
  /** Show list placeholders rather than masonry ones while loading. */
  listSkeleton: boolean;
  /** Shown once every page is in and nothing matched. */
  emptyState: ReactNode;
  scrollRoot: RefObject<HTMLElement | null>;
  onPickColor: (hex: string) => void;
}) {
  const { rows, stale, isDone, loadingMore, canLoadMore, failed, loadMore } = feed;
  const groups = useMemo(() => partitionByLayout(rows ?? []), [rows]);
  const visual = useMemo(() => groups.visual.map(toMasonryItem), [groups]);
  const text = useMemo(() => groups.text.map(toTextItem), [groups]);
  const links = useMemo(() => groups.link.map(toLinkItem), [groups]);

  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);
  const near = useNearEnd(scrollRoot, sentinel);
  const total = visual.length + text.length + links.length;

  // Re-checked whenever a page lands (`total`, `canLoadMore`), so a page that
  // added little still leads to the next while the sentinel is in view.
  useEffect(() => {
    if (near && canLoadMore && !stale) loadMore();
  }, [near, canLoadMore, stale, loadMore, total]);

  if (rows === null) return listSkeleton ? <ListSkeleton /> : <MasonrySkeleton />;

  if (total === 0 && isDone && !stale) return <>{emptyState}</>;

  const sections = [visual.length, text.length, links.length].filter((n) => n > 0).length;

  return (
    <div className={stale ? "opacity-60 transition-opacity" : "transition-opacity"} aria-busy={stale || loadingMore}>
      {visual.length > 0 && <MasonryLayout items={visual} onPickColor={onPickColor} />}
      {text.length > 0 && (
        <div className={visual.length > 0 ? "mt-8" : undefined}>
          {sections > 1 && <SectionTitle>Text</SectionTitle>}
          <TextWrapLayout items={text} />
        </div>
      )}
      {links.length > 0 && (
        <div className={visual.length + text.length > 0 ? "mt-8" : undefined}>
          {sections > 1 && <SectionTitle>Links</SectionTitle>}
          <LinkList items={links} />
        </div>
      )}

      <div ref={setSentinel} aria-hidden="true" className="h-px" />
      {!isDone && (
        <div className="flex flex-col items-center gap-2 py-6">
          {total === 0 && (
            <p className="text-[12px] text-[var(--text-muted)]">Looking through older captures…</p>
          )}
          {failed ? (
            <button type="button" className="btn-secondary" onClick={loadMore}>
              Couldn&apos;t load more. Retry
            </button>
          ) : (
            <button type="button" className="btn-secondary" disabled={!canLoadMore} onClick={loadMore}>
              {loadingMore || !canLoadMore ? "Loading…" : "Load more"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
