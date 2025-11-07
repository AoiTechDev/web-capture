
import { useRef } from "react";
import { useQuery } from "convex/react";
import type { FunctionReference } from "convex/server"; // Adjust as needed

export function useStableQuery<T>(
  name: FunctionReference<"query", "public", any, T>,
  args: any,
  defaultValue: T
): T {
  const cacheRef = useRef<Map<string, T>>(new Map());
  const key = JSON.stringify({ q: (name as any)?._path ?? (name as any)?._name, args });

  const result = useQuery(name as any, args as any) as T | undefined;

  console.log(result);
  if (result !== undefined) {
    cacheRef.current.set(key, result);
  }

  return cacheRef.current.get(key) ?? defaultValue;
}