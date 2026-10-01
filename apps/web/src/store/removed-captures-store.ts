import { create } from "zustand";

/**
 * Captures deleted in this tab. Browse pages drop them on their own (they
 * are reactive); search results are a one-off fetch, so they are filtered
 * through this until the next search.
 */
export const useRemovedCapturesStore = create<{
  removed: ReadonlySet<string>;
  markRemoved: (id: string) => void;
}>((set) => ({
  removed: new Set<string>(),
  markRemoved: (id) => set((s) => ({ removed: new Set(s.removed).add(id) })),
}));
