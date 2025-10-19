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
  
  for (const item of results) {
    const row = document.createElement('div')
    row.className = 'search-result-item'
    row.addEventListener('click', (e) => {
      e.stopPropagation()
      if (item.pageUrl) window.open(item.pageUrl, '_blank')
      else if (item.imageUrl) window.open(item.imageUrl, '_blank')
      else if (item.id) window.open(item.pageUrl || 'about:blank', '_blank')
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
    const title = document.createElement('div')
    title.className = 'search-result-title'
    title.textContent = item.title || item.alt || (new URL(item.pageUrl || 'about:blank').host || 'Capture')
    const sub = document.createElement('div')
    sub.className = 'search-result-subtitle'
    const host = (() => { try { return item.pageUrl ? new URL(item.pageUrl).host : '' } catch { return '' } })()
    const tagText = Array.isArray(item.tags) && item.tags.length ? ` #${item.tags.slice(0,3).join(' #')}` : ''
    sub.textContent = [host, item.category].filter(Boolean).join(' • ') + tagText

    meta.appendChild(title)
    meta.appendChild(sub)

    row.appendChild(thumb)
    row.appendChild(meta)
    searchResultsEl.appendChild(row)
  }
}

