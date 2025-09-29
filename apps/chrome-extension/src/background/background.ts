import { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { getImageDimensions } from "./utils/get-image-dimensions";
const client = new ConvexClient(import.meta.env.VITE_CONVEX_URL!);

// Keep latest auth token
let convexToken: string | null = null;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "SYNC_AUTH") {
    convexToken = message.token ?? null;
    client.setAuth(async () => convexToken);
    sendResponse({ ok: true });
    return true;
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      // Ensure client has auth before any Convex call
      client.setAuth(async () => convexToken);
      if (msg.type === "GET_CATEGORIES") {
        const categories = await client.query(api.captures.listCategories, {});
        sendResponse({ categories });
        return;
      }

      if (msg.type === "CREATE_CATEGORY") {
        const id = await client.mutation(api.upload.createCategory, {
          name: String(msg.name ?? "").trim(),
        });
        sendResponse({ id });
        return;
      }

      if (msg.type === "SAVE_NON_IMAGE_CAPTURE") {
        const captureData = {
          kind: msg.data.kind,
          ...msg.data,
          url: msg.data.url || "unknown",
          timestamp: Date.now(),
        };
        await client.mutation(api.upload.uploadCapture, {
          capture: captureData,
        });

        sendResponse({ statusCode: 200, message: "Non-image capture saved" });
      }

      if (msg.type === "SAVE_IMAGE_CAPTURE") {
        const postUrl = await client.mutation(api.upload.generateUploadUrl, {});

        const imageResp = await fetch(msg.data.src);
        if (!imageResp.ok) throw new Error("Failed to download image");
        const blob = await imageResp.blob();

        const result = await fetch(postUrl, {
          method: "POST",
          headers: { "Content-Type": blob.type || "application/octet-stream" },
          body: blob,
        });
        if (!result.ok) throw new Error("Upload failed");

        const { storageId } = await result.json();
        const { width, height } = (await getImageDimensions(blob)) as {
          width: number;
          height: number;
        };
        await client.mutation(api.upload.saveImageCapture, {
          storageId,
          src: msg.data.src,
          alt: msg.data.alt ?? undefined,
          url: msg.data.url || "unknown",
          timestamp: Date.now(),
          width,
          height,
          category: msg.data.category ?? undefined,
        });

        sendResponse({ statusCode: 200, message: "Image capture saved" });
      }

      if (msg.type === "SCREENSHOT_ELEMENT") {
        const dataUrl: string = await new Promise((resolve, reject) => {
          try {
            chrome.tabs.captureVisibleTab(
              { format: "png", quality: 100 },
              (url) => {
                if (chrome.runtime.lastError || !url)
                  reject(chrome.runtime.lastError);
                else resolve(url);
              }
            );
          } catch (e) {
            reject(e);
          }
        });
        if (sender?.tab?.id) {
          chrome.tabs.sendMessage(sender.tab.id, {
            type: "CROP_AND_UPLOAD",
            dataUrl,
            rect: msg.rect,
          });
        }
        sendResponse({ statusCode: 200, message: "Screenshot captured" });
      }

      if (msg.type === "UPLOAD_CROPPED_IMAGE") {
        const bytes = new Uint8Array(msg.bytes as ArrayBuffer);
        const blob = new Blob([bytes], { type: "image/png" });
        const postUrl = await client.mutation(api.upload.generateUploadUrl, {});
        const uploadRes = await fetch(postUrl, {
          method: "POST",
          headers: { "Content-Type": "image/png" },
          body: blob,
        });
        if (!uploadRes.ok) throw new Error("Upload failed");
        const { storageId } = await uploadRes.json();

        await client.mutation(api.upload.saveImageCapture, {
          storageId,
          src: undefined,
          alt: "screenshot",
          url: msg.url || "unknown",
          timestamp: Date.now(),
          width: msg.width,
          height: msg.height,
        });

        sendResponse({ statusCode: 200, message: "Screenshot saved" });
      }

      if (msg.type === "UPLOAD_CROPPED_DATAURL") {
        // Convert dataURL to Blob reliably
        const res = await fetch(msg.dataUrl as string);
        const blob = await res.blob();
        const postUrl = await client.mutation(api.upload.generateUploadUrl, {});
        const uploadRes = await fetch(postUrl, {
          method: "POST",
          headers: { "Content-Type": "image/png" },
          body: blob,
        });
        if (!uploadRes.ok) throw new Error("Upload failed");
        const { storageId } = await uploadRes.json();

        await client.mutation(api.upload.saveImageCapture, {
          storageId,
          src: undefined,
          alt: "screenshot",
          url: msg.url || "unknown",
          timestamp: Date.now(),
          width: msg.width,
          height: msg.height,
        });

        sendResponse({ statusCode: 200, message: "Screenshot saved" });
      }
    } catch (err) {
      console.error("❌ Convex background error:", err);
      sendResponse({ statusCode: 500, message: "Failed to save capture" });
    }
  })();

  return true;
});
