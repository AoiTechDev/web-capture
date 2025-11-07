export async function cropAndUpload(message: {
  dataUrl: string
  rect: { x: number; y: number; width: number; height: number; dpr: number; url: string }
}) {
  try {
    const { dataUrl, rect } = message
    const base = await fetch(dataUrl).then((r) => r.blob())
    const bmp = await createImageBitmap(base)
    const dpr = rect.dpr || window.devicePixelRatio || 1
    const sx = Math.round(rect.x * dpr)
    const sy = Math.round(rect.y * dpr)
    const sw = Math.round(rect.width * dpr)
    const sh = Math.round(rect.height * dpr)
    const canvas = document.createElement("canvas")
    canvas.width = sw
    canvas.height = sh
    const ctx = canvas.getContext("2d")!
    ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh)
    const croppedDataUrl = canvas.toDataURL("image/png")
    await chrome.runtime.sendMessage({
      type: "UPLOAD_CROPPED_DATAURL",
      dataUrl: croppedDataUrl,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      url: rect.url,
      kind: 'screenshot',
    })
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    if (errorMessage.includes("Extension context invalidated")) {
      alert("Extension was reloaded. Please refresh this page to use the capture features.")
    } else {
      console.error("Failed to crop/upload screenshot:", e)
    }
  }
}

