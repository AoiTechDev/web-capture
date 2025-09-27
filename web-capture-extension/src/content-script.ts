import { cleanup, toggleSelectionMode, startScreenshotMode } from "./utils/mouse-events";
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
      console.log("Capture screenshot - Ctrl/Cmd+Shift+S pressed");
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
        "Capture screenshot with category - Ctrl/Cmd+Shift+C or Ctrl+Shift+Alt+S"
      );
      toggleSelectionMode(true);
    }

    // Ctrl/Cmd+Shift+E => screenshot selected element (no prompt, saves as image to 'element' category)
    if (hasCtrlOrMeta && e.shiftKey && key === "E") {
      e.preventDefault();
      e.stopPropagation();
      console.log("Screenshot mode - Ctrl/Cmd+Shift+E pressed");
      startScreenshotMode();
    }
  },
  true
);
console.log("Content script loaded");

// Respond to background command to start screenshot mode
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "START_SCREENSHOT_MODE") {
    console.log("Screenshot mode - command invoked");
    startScreenshotMode();
  }
  if (message?.type === "CROP_AND_UPLOAD") {
    void (async () => {
      try {
        const { dataUrl, rect } = message as { dataUrl: string; rect: { x: number; y: number; width: number; height: number; dpr: number; url: string } };
        const base = await fetch(dataUrl).then((r) => r.blob());
        const bmp = await createImageBitmap(base);
        const dpr = rect.dpr || window.devicePixelRatio || 1;
        const sx = Math.round(rect.x * dpr);
        const sy = Math.round(rect.y * dpr);
        const sw = Math.round(rect.width * dpr);
        const sh = Math.round(rect.height * dpr);
        const canvas = document.createElement("canvas");
        canvas.width = sw;
        canvas.height = sh;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
        const croppedDataUrl = canvas.toDataURL("image/png");
        await chrome.runtime.sendMessage({
          type: "UPLOAD_CROPPED_DATAURL",
          dataUrl: croppedDataUrl,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          url: rect.url,
        });
      } catch (e) {
        console.error("❌ Failed to crop/upload screenshot:", e);
      }
    })();
  }
});
