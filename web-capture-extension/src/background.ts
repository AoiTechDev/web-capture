// Background script (service worker) for Web Capture extension
// Handles messaging between content script and popup

// Listen for messages from content script
import { ConvexClient } from "convex/browser";
import { api } from "../convex/_generated/api";
const client = new ConvexClient(import.meta.env.VITE_CONVEX_URL);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
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
        // 1) Get short-lived upload URL from Convex
        const postUrl = await client.mutation(api.upload.generateUploadUrl, {});

        // 2) Turn the page image URL into a Blob (or if you already have a File/Blob, skip fetch)
        const imageResp = await fetch(msg.data.src);
        if (!imageResp.ok) throw new Error("Failed to download image");
        const blob = await imageResp.blob();

        // 3) POST the blob to the upload URL
        const result = await fetch(postUrl, {
          method: "POST",
          headers: { "Content-Type": blob.type || "application/octet-stream" },
          body: blob,
        });
        if (!result.ok) throw new Error("Upload failed");
        const { storageId } = await result.json();

        // 4) Save the capture with storageId in Convex
        await client.mutation(api.upload.saveImageCapture, {
          storageId,
          src: msg.data.src, // keep original page src if you like
          alt: msg.data.alt ?? undefined,
          url: msg.data.url || "unknown", // page URL
          timestamp: Date.now(),
        });

        sendResponse({ statusCode: 200, message: "Image capture saved" });
      }
    } catch (err) {
      console.error("❌ Convex background error:", err);
      sendResponse({ statusCode: 500, message: "Failed to save capture" });
    }
  })();

  return true;
});

// Handle extension installation
// if (message.type === "SAVE_ELEMENT") {
//   const elementData: Capture = message.data;

//   void saveCapture(elementData);
//   chrome.storage.local
//     .set({
//       [`capture_${uuidv4()}`]: elementData,
//     })
//     .then(() => {

//       sendResponse({
//         statusCode: 200,
//         message: "Element saved successfully",
//       });

//       chrome.runtime
//         .sendMessage({
//           type: "ELEMENT_CAPTURED",
//           data: elementData,
//         })
//         .catch(() => {
//           // Popup might not be open, that's okay
//           console.log("Popup not open, element saved to storage");
//         });
//     })
//     .catch((error) => {
//       console.error("Failed to save element:", error);
//       sendResponse({ statusCode: 500, message: "Failed to save element" });
//     });

//   return true;
// }

//THIS IS FOR LOCAL SYNC
// chrome.storage.local
//   .set({
//     [`capture_${uuidv4()}`]: elementData,
//   })
//   .then(() => {
//     sendResponse({
//       statusCode: 200,
//       message: "Element saved successfully",
//     });

//     chrome.runtime
//       .sendMessage({
//         type: "ELEMENT_CAPTURED",
//         data: elementData,
//       })
//       .catch(() => {
//         // Popup might not be open, that's okay
//         console.log("Popup not open, element saved to storage");
//       });
//   })
//   .catch((error) => {
//     console.error("Failed to save element:", error);
//     sendResponse({ statusCode: 500, message: "Failed to save element" });
//   });

//  // Handle popup requests for stored captures
// if (message.type === "GET_CAPTURES") {
//   chrome.storage.local
//     .get(null)
//     .then((items) => {
//       const captures = Object.keys(items)
//         .filter((key) => key.startsWith("capture_"))
//         .map((key) => items[key])
//         .sort((a, b) => b.timestamp - a.timestamp); // Sort by newest first

//       sendResponse({ captures });
//     })
//     .catch((error) => {
//       console.error("Failed to get captures:", error);
//       sendResponse({ captures: [] });
//     });

//   return true;
// }
