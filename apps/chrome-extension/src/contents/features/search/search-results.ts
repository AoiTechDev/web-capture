export function renderSearchResults(
  results: any[],
  searchResultsEl: HTMLDivElement | null,
  closeSearchOverlay: () => void
) {
  if (!searchResultsEl) return
  searchResultsEl.innerHTML = ''
  
  if (!results.length) {
    const empty = document.createElement('div')
    empty.className = 'search-results-empty'
    empty.textContent = 'No results'
    searchResultsEl.appendChild(empty)
    return
  }
  
  async function copyImageToClipboard(url: string): Promise<boolean> {
    try {
      const resp = await fetch(url, { mode: 'cors', cache: 'no-cache' })
      if (!resp.ok) throw new Error('HTTP ' + resp.status)
      const blob = await resp.blob()
      const item = new ClipboardItem({ [blob.type || 'image/png']: blob })
      // @ts-ignore - navigator.clipboard.write supports ClipboardItem in Chromium
      await navigator.clipboard.write([item])
      return true
    } catch (e) {
      try {
        // Fallback via canvas to ensure proper MIME
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const i = new Image()
          i.crossOrigin = 'anonymous'
          i.onload = () => resolve(i)
          i.onerror = reject
          i.src = url
        })
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('No 2D context')
        ctx.drawImage(img, 0, 0)
        const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
        if (!blob) throw new Error('Canvas toBlob failed')
        const item = new ClipboardItem({ 'image/png': blob })
        // @ts-ignore
        await navigator.clipboard.write([item])
        return true
      } catch {
        return false
      }
    }
  }

  function showToast(message: string) {
    const overlay = searchResultsEl?.parentElement
    if (!overlay) return
    const toast = document.createElement('div')
    toast.className = 'search-toast'
    toast.textContent = message
    overlay.appendChild(toast)
    setTimeout(() => {
      toast.classList.add('hide')
      setTimeout(() => toast.remove(), 220)
    }, 1200)
  }

  for (const item of results) {
    const row = document.createElement('div')
    row.className = 'search-result-item'
    row.addEventListener('click', async (e) => {
      e.stopPropagation()
      if (item.imageUrl) {
        const ok = await copyImageToClipboard(item.imageUrl)
        showToast(ok ? 'Image copied to clipboard' : 'Copy failed')
      }
      closeSearchOverlay()
    })

    const thumb = document.createElement('div')
    thumb.className = 'search-result-thumb'
    if (item.imageUrl) {
      const img = document.createElement('img')
      img.src = item.imageUrl
      thumb.appendChild(img)
    } else {
      const placeholder = document.createElement('div')
      placeholder.className = 'search-result-thumb-placeholder'
      placeholder.textContent = item.kind?.toUpperCase?.() || 'CAP'
      thumb.appendChild(placeholder)
    }

    const meta = document.createElement('div')
    meta.className = 'search-result-meta'

    // Website (host) only
    const title = document.createElement('div')
    title.className = 'search-result-title'
    const host = (() => { try { return item.pageUrl ? new URL(item.pageUrl).host : '' } catch { return '' } })()
    title.textContent = host || 'Website'

    // Category only
    const sub = document.createElement('div')
    sub.className = 'search-result-subtitle'
    sub.textContent = item.category || ''

    meta.appendChild(title)
    meta.appendChild(sub)

    row.appendChild(thumb)
    row.appendChild(meta)
    searchResultsEl.appendChild(row)
  }
}

