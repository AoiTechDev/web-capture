import { useQuery } from "convex/react";
import { getFunctionName } from "convex/server";
import type { FunctionReference } from "convex/server";

/**
 * Query results cached across component lifetimes.
 *
 * Deliberately module-level rather than a ref: a ref dies with the component,
 * so navigating away and back re-mounted into an empty state and flashed a
 * placeholder before the socket answered. Keeping results here means returning
 * to a route paints last-known data on the first frame and quietly updates it.
 *
 * This is a render cache, not a source of truth - Convex remains authoritative
 * and overwrites each entry as soon as it responds.
 */
const cache = new Map<string, unknown>();

/** Bound on retained entries; evicts oldest-inserted first. */
const MAX_ENTRIES = 200;

function cacheKey(name: any, args: unknown): string {
  // `api` is Convex's anyApi proxy: every property access returns another
  // proxy, so probing for `_path` yields an object rather than undefined and
  // stringifying it throws. getFunctionName is the supported accessor.
  let path: string;
  try {
    path = getFunctionName(name);
  } catch {
    path = "unknown";
  }
  return `${path}:${JSON.stringify(args ?? {})}`;
}

function remember(key: string, value: unknown) {
  // Re-insert so the key moves to the end and survives the next eviction.
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

export type CachedQueryResult<T> = {
  /** Live data, or the last known value while a refetch is in flight. */
  data: T | undefined;
  /** True only when there is nothing at all to show yet. */
  isLoading: boolean;
  /** True when showing a cached value while fresh data is on its way. */
  isStale: boolean;
};

/**
 * `useQuery` that keeps the previous result visible instead of collapsing to
 * `undefined` whenever the arguments change.
 *
 * Callers must branch on `isLoading` rather than on an empty array: those two
 * states look identical but mean opposite things, and conflating them is what
 * makes an empty state flash before content arrives.
 */
export function useCachedQuery<T>(
  name: FunctionReference<"query", "public", any, T>,
  args: any
): CachedQueryResult<T> {
  const key = cacheKey(name, args);
  const live = useQuery(name as any, args as any) as T | undefined;

  if (live !== undefined) remember(key, live);

  const data = live !== undefined ? live : (cache.get(key) as T | undefined);

  return {
    data,
    isLoading: data === undefined,
    isStale: live === undefined && data !== undefined,
  };
}

/**
 * @deprecated Returns `defaultValue` while loading, which callers cannot tell
 * apart from a genuinely empty result. Use `useCachedQuery` and branch on
 * `isLoading`.
 */
export function useStableQuery<T>(
  name: FunctionReference<"query", "public", any, T>,
  args: any,
  defaultValue: T
): T {
  const { data } = useCachedQuery<T>(name, args);
  return data ?? defaultValue;
}
