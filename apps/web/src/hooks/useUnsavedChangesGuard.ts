import { useEffect } from "react";

export const UNSAVED_MESSAGE = "You have unsaved changes to this design system. Leave without saving?";

/**
 * Warns before leaving a page with unsaved edits: the browser's own prompt on
 * reload/close, and a confirm() on in-app link clicks (the App Router has no
 * navigation-blocking API, so links are intercepted in the capture phase,
 * before next/link's handler runs). Browser back/forward is not intercepted.
 */
export function useUnsavedChangesGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Older browsers need returnValue set to show the prompt.
      e.returnValue = "";
    };

    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return; // beforeunload covers full navigations
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (!window.confirm(UNSAVED_MESSAGE)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);
}
