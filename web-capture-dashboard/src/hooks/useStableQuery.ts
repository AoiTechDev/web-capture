
import { useRef } from "react";
import { useQuery } from "convex/react";
import type { FunctionReference } from "convex/server"; // Adjust as needed

export function useStableQuery<T>(
  name: FunctionReference<"query", "public", any, T>,
  args: any,
  defaultValue: T
): T {
  // Map to store results for each key
  const cacheRef = useRef<Map<string, T>>(new Map());
  const key = JSON.stringify({ q: (name as any)?._path ?? (name as any)?._name, args });

  const result = useQuery(name as any, args as any) as T | undefined;

  // If we have a new result, update the cache
  if (result !== undefined) {
    cacheRef.current.set(key, result);
  }

  // Return cached result if available, otherwise default
  return cacheRef.current.get(key) ?? defaultValue;
}