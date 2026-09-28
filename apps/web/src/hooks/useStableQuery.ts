import { useQuery } from "convex/react";
import { getFunctionName } from "convex/server";
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from "convex/server";

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

/**
 * Cache key for a query, or null when the query cannot be identified.
 *
 * `api` is Convex's anyApi proxy: every property access returns another proxy,
 * so probing for `_path` yields an object rather than undefined and
 * stringifying it throws. getFunctionName is the supported accessor.
 *
 * Returns null rather than a shared placeholder on failure - two unidentifiable
 * queries sharing one key would serve each other's results, which is far worse
 * than not caching.
 */
function cacheKey(
  name: FunctionReference<"query">,
  args: unknown
): string | null {
  try {
    return `${getFunctionName(name)}:${JSON.stringify(args ?? {})}`;
  } catch {
    return null;
  }
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
export function useCachedQuery<Query extends FunctionReference<"query">>(
  name: Query,
  args: FunctionArgs<Query>
): CachedQueryResult<FunctionReturnType<Query>> {
  type Result = FunctionReturnType<Query>;

  const key = cacheKey(name, args);
  const live = useQuery(name, args) as Result | undefined;

  if (key !== null && live !== undefined) remember(key, live);

  const cached = key !== null ? (cache.get(key) as Result | undefined) : undefined;
  const data = live !== undefined ? live : cached;

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
export function useStableQuery<Query extends FunctionReference<"query">>(
  name: Query,
  args: FunctionArgs<Query>,
  defaultValue: FunctionReturnType<Query>
): FunctionReturnType<Query> {
  const { data } = useCachedQuery(name, args);
  return data ?? defaultValue;
}
