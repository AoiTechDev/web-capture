import { useEffect } from "react";
import { googleFontsUrl } from "@/lib/design-system/fonts";

/**
 * Loads a Google Fonts family for the design system preview while the
 * component is mounted and `enabled` (the viewer's opt-in, see
 * useGoogleFontsOptIn; nothing is requested from Google without it). The name is checked strictly before any URL is built
 * (googleFontsUrl); an invalid, system or unknown family just isn't loaded and
 * the preview falls back to the stack's generic fonts.
 *
 * css2 rejects a whole request if the family lacks one of the weights, so a
 * failed load retries once without weights before giving up silently.
 */
export function useGoogleFont(family: string, weights: readonly number[], enabled: boolean) {
  const weightKey = weights.join(",");

  useEffect(() => {
    if (!enabled) return;
    const withWeights = googleFontsUrl(family, weightKey ? weightKey.split(",").map(Number) : []);
    if (!withWeights) return;
    const plain = googleFontsUrl(family);

    // Typing a name fires this per keystroke; wait for a pause before fetching.
    let link: HTMLLinkElement | null = null;
    const timer = window.setTimeout(() => {
      link = document.createElement("link");
      link.rel = "stylesheet";
      // Don't tell Google which dashboard page (and session id) asked.
      link.referrerPolicy = "no-referrer";
      link.href = withWeights;
      link.dataset.designSystemPreview = "";
      link.onerror = () => {
        if (!link) return;
        if (plain && link.href !== plain) {
          link.href = plain;
        } else {
          link.remove();
          link = null;
        }
      };
      document.head.appendChild(link);
    }, 400);

    return () => {
      window.clearTimeout(timer);
      link?.remove();
    };
  }, [family, weightKey, enabled]);
}
