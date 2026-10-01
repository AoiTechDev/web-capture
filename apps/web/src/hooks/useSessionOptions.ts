import { usePaginatedQuery } from "convex/react";
import { api } from "../../../../packages/backend/convex/_generated/api";

/** Sessions fetched per page by the session pickers. */
const SESSION_PAGE = 50;

/**
 * The user's sessions for a picker, newest first, a page at a time
 * (`sessions.listSessionOptions`), so older sessions are reachable with
 * `loadMore`. `sessions` is undefined until the first page is in, and while
 * `enabled` is false (nothing is fetched then).
 */
export function useSessionOptions(enabled = true) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.sessions.listSessionOptions,
    enabled ? {} : "skip",
    { initialNumItems: SESSION_PAGE }
  );
  return {
    sessions: enabled && status !== "LoadingFirstPage" ? results : undefined,
    canLoadMore: status === "CanLoadMore",
    loadingMore: status === "LoadingMore",
    loadMore: () => loadMore(SESSION_PAGE),
  };
}

export type SessionOptions = ReturnType<typeof useSessionOptions>;
