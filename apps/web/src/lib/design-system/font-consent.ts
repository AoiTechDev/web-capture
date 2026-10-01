/**
 * The viewer's opt-in to loading preview fonts from Google Fonts (off by
 * default: a request to Google sends the visitor's IP, which needs consent
 * under EU rules). Stored per browser; every storage access is guarded, since
 * storage can be blocked, full or missing.
 */

export const GOOGLE_FONTS_OPT_IN_KEY = "design-system:preview-google-fonts";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** False unless the viewer opted in, and whenever storage can't be read. */
export function readGoogleFontsOptIn(store: StorageLike | null = storage()): boolean {
  try {
    return store?.getItem(GOOGLE_FONTS_OPT_IN_KEY) === "1";
  } catch {
    return false;
  }
}

/** Remembers the choice; returns false when it couldn't be stored. */
export function writeGoogleFontsOptIn(on: boolean, store: StorageLike | null = storage()): boolean {
  try {
    if (!store) return false;
    if (on) store.setItem(GOOGLE_FONTS_OPT_IN_KEY, "1");
    else store.removeItem(GOOGLE_FONTS_OPT_IN_KEY);
    return true;
  } catch {
    return false;
  }
}
