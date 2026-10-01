import { useCallback, useEffect, useMemo, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  parseFilterParams,
  serializeFilterParams,
  type CaptureFilters,
} from "@/lib/capture-filters";

/**
 * The dashboard's filters, kept in the URL so a refresh or a shared link
 * shows the same view. Updates go through `history.replaceState`, which Next
 * syncs into useSearchParams without a server round trip, and replace rather
 * than push so filter tweaks do not fill the back button.
 */
export function useFilterParams(): {
  filters: CaptureFilters;
  setFilters: (patch: Partial<CaptureFilters> | ((f: CaptureFilters) => CaptureFilters)) => void;
} {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const key = searchParams.toString();
  const filters = useMemo(() => parseFilterParams(new URLSearchParams(key)), [key]);

  // The URL updates after a render, so two quick changes in a row (a chip,
  // then another) must build on the last one requested, not on the URL.
  const latest = useRef(filters);
  useEffect(() => {
    latest.current = filters;
  }, [filters]);

  const setFilters = useCallback(
    (patch: Partial<CaptureFilters> | ((f: CaptureFilters) => CaptureFilters)) => {
      const next = typeof patch === "function" ? patch(latest.current) : { ...latest.current, ...patch };
      latest.current = next;
      const qs = serializeFilterParams(next);
      const url = `${pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
      if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
        window.history.replaceState(null, "", url);
      }
    },
    [pathname]
  );

  return { filters, setFilters };
}
