import { useCallback, useEffect, useState } from "react";
import { readGoogleFontsOptIn, writeGoogleFontsOptIn } from "@/lib/design-system/font-consent";

/**
 * Whether the design system preview may load fonts from Google Fonts. Off by
 * default and remembered per browser (font-consent.ts); if storage is blocked
 * the toggle still applies to this page, it just isn't remembered.
 */
export function useGoogleFontsOptIn(): [boolean, (on: boolean) => void] {
  // Starts false on the server and the first client render; the stored choice
  // is read after mount so hydration matches.
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(readGoogleFontsOptIn());
  }, []);

  const set = useCallback((on: boolean) => {
    setEnabled(on);
    writeGoogleFontsOptIn(on);
  }, []);

  return [enabled, set];
}
