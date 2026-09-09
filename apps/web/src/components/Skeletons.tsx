"use client";

/**
 * Loading placeholders.
 *
 * These mirror the shape of the content that replaces them, so the first paint
 * and the loaded state occupy the same space. A spinner or a line of text would
 * still shift the layout on arrival, which reads as a flash even when the wait
 * is short.
 */

/** Deterministic pseudo-random heights: a real masonry grid is never uniform,
 *  and Math.random() would give the server and client different markup. */
const HEIGHTS = [280, 200, 340, 240, 300, 180, 320, 260, 220, 360, 200, 290];

export const MasonrySkeleton = ({ count = 12 }: { count?: number }) => (
  <div
    className="grid gap-4"
    style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}
    aria-hidden="true"
  >
    {Array.from({ length: count }).map((_, i) => (
      <div
        key={i}
        className="animate-pulse rounded-lg border border-[var(--border)] bg-[var(--surface)]"
        style={{ height: HEIGHTS[i % HEIGHTS.length] }}
      />
    ))}
  </div>
);

export const SessionCardSkeleton = ({ count = 6 }: { count?: number }) => (
  <div
    className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
    aria-hidden="true"
  >
    {Array.from({ length: count }).map((_, i) => (
      <div
        key={i}
        className="animate-pulse overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]"
      >
        <div className="h-28 bg-[var(--bg)]" />
        <div className="space-y-2 p-4">
          <div className="h-3.5 w-1/2 rounded bg-[var(--surface-hover)]" />
          <div className="h-3 w-3/4 rounded bg-[var(--surface-hover)]" />
          <div className="flex gap-1 pt-1">
            <div className="h-4 w-12 rounded bg-[var(--surface-hover)]" />
            <div className="h-4 w-16 rounded bg-[var(--surface-hover)]" />
          </div>
        </div>
      </div>
    ))}
  </div>
);

export const ListSkeleton = ({ count = 6 }: { count?: number }) => (
  <div className="space-y-2" aria-hidden="true">
    {Array.from({ length: count }).map((_, i) => (
      <div
        key={i}
        className="h-16 animate-pulse rounded-lg border border-[var(--border)] bg-[var(--surface)]"
      />
    ))}
  </div>
);
