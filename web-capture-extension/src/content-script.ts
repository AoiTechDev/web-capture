import { cleanup, toggleSelectionMode } from "./utils/mouse-events";
import './utils/mouse-events';
window.addEventListener("beforeunload", cleanup);

document.addEventListener(
  "keydown",
  (e) => {
    const key = e.key.toUpperCase();
    const hasCtrlOrMeta = e.ctrlKey || e.metaKey; // support Win/Linux Ctrl and macOS Cmd

    // Ctrl/Cmd+Shift+S => instant capture to Unsorted (no prompt)
    if (hasCtrlOrMeta && e.shiftKey && !e.altKey && key === "S") {
      e.preventDefault();
      e.stopPropagation();
      console.log("Capture element - Ctrl/Cmd+Shift+S pressed");
      toggleSelectionMode(false);
    }

    // Ctrl/Cmd+Shift+C => capture with category prompt (mac-friendly)
    // Also keep Ctrl+Shift+Alt+S as an additional Windows/Linux path
    if (
      (hasCtrlOrMeta && e.shiftKey && key === "C") ||
      (e.ctrlKey && e.shiftKey && e.altKey && key === "S")
    ) {
      e.preventDefault();
      e.stopPropagation();
      console.log(
        "Capture element with category - Ctrl/Cmd+Shift+C or Ctrl+Shift+Alt+S"
      );
      toggleSelectionMode(true);
    }
  },
  true
);
console.log("Content script loaded");
