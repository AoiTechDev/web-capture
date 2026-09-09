export function renderSearchResults(
  results: any[],
  searchResultsEl: HTMLDivElement | null,
  closeSearchOverlay: () => void
) {
  console.log('[search-results] renderSearchResults called with', results.length, 'results:', results)
  
  if (!searchResultsEl) {
    console.log('[search-results] No searchResultsEl!')
    return
  }
  searchResultsEl.innerHTML = ''
  
  if (!results.length) {
    console.log('[search-results] No results, showing empty state')
    const empty = document.createElement('div')
    empty.className = 'search-results-empty'
    empty.textContent = 'No results'
    searchResultsEl.appendChild(empty)
    return
  }
  
  console.log('[search-results] Rendering', results.length, 'results')
  
  async function copyImageToClipboard(url: string): Promise<boolean> {
    try {
      const resp = await fetch(url, { mode: 'cors', cache: 'no-cache' })
      if (!resp.ok) throw new Error('HTTP ' + resp.status)
      const blob = await resp.blob()
      const item = new ClipboardItem({ [blob.type || 'image/png']: blob })
      
      await navigator.clipboard.write([item])
      return true
    } catch (e) {
      try {
        
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
    console.log('item', item)
    
    if (item.kind === 'link') {
      row.addEventListener('click', (e) => {
        e.stopPropagation()
        window.open(item.url || item.href, '_blank')
        closeSearchOverlay()
      })
    } else {
      row.addEventListener('click', async (e) => {
        e.stopPropagation()
        if (item.imageUrl) {
          const ok = await copyImageToClipboard(item.imageUrl)
          showToast(ok ? 'Image copied to clipboard' : 'Copy failed')
        }
        closeSearchOverlay()
      })
    }

    const thumb = document.createElement('div')
    thumb.className = 'search-result-thumb'
    
    
    if (item.kind === 'link') {
     
      if (item.faviconUrl) {
        const favicon = document.createElement('img')
        favicon.src = item.faviconUrl
        favicon.style.width = '32px'
        favicon.style.height = '32px'
        favicon.style.objectFit = 'contain'
        thumb.appendChild(favicon)
      } else {
        const placeholder = document.createElement('div')
        placeholder.className = 'search-result-thumb-placeholder'
        placeholder.textContent = '🔗'
        thumb.appendChild(placeholder)
      }
    } else if (item.imageUrl) {
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

    const title = document.createElement('div')
    title.className = 'search-result-title'
    
    
    const host = (() => {
      try { return item.pageUrl ? new URL(item.pageUrl).host.replace(/^www\./, '') : '' } catch { return '' }
    })()

    if (item.kind === 'link') {
      title.textContent = item.title || item.domain || 'Untitled'
    } else {
      // Auto-tags describe what the capture actually is; the host is the same
      // string on every row from a given site and cannot tell them apart.
      const tags = Array.isArray(item.tags) ? item.tags.filter(Boolean) : []
      title.textContent = tags.length
        ? tags.slice(0, 3).join(' · ')
        : item.title || item.alt || host || 'Capture'
    }

    const sub = document.createElement('div')
    sub.className = 'search-result-subtitle'
    
    
    if (item.kind === 'link') {
      const domain = item.domain || ''
      const desc = item.description ? ` • ${item.description.slice(0, 60)}${item.description.length > 60 ? '...' : ''}` : ''
      sub.textContent = domain + desc
    } else {
      // Surfacing the match strength makes a bad ranking visible instead of
      // looking like an arbitrary result set.
      const pct = typeof item.score === 'number' ? `${Math.round(item.score * 100)}% match` : ''
      sub.textContent = [host, item.category, pct].filter(Boolean).join(' · ')
    }

    meta.appendChild(title)
    meta.appendChild(sub)

    row.appendChild(thumb)
    row.appendChild(meta)
    searchResultsEl.appendChild(row)
  }
}

