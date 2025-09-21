import { cleanup, toggleSelectionMode } from "./utils/mouse-events";
import './utils/mouse-events';
window.addEventListener("beforeunload", cleanup);

document.addEventListener(
  "keydown",
  (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === "S") {
      e.preventDefault();
      e.stopPropagation();
      console.log("Capture element - Ctrl+Shift+S pressed");
      toggleSelectionMode();
    }
  },
  true
);
console.log("Content script loaded");
