import { renderSearchResults } from './search-results'

let searchOverlayEl: HTMLDivElement | null = null
let searchInputEl: HTMLInputElement | null = null
let searchResultsEl: HTMLDivElement | null = null
let isSearchOpen = false
let searchDebounce: number | null = null

export function toggleSearchOverlay() {
  if (isSearchOpen) {
    closeSearchOverlay()
  } else {
    openSearchOverlay()
  }
}

export function closeSearchOverlay() {
  if (!isSearchOpen) return
  isSearchOpen = false
  if (searchOverlayEl && searchOverlayEl.parentNode) {
    searchOverlayEl.parentNode.removeChild(searchOverlayEl)
  }
}

export function isSearchOverlayOpen(): boolean {
  return isSearchOpen
}

function openSearchOverlay() {
  if (isSearchOpen) return
  isSearchOpen = true
  if (!searchOverlayEl) {
    searchOverlayEl = document.createElement('div')
    searchOverlayEl.className = 'search-overlay'

    const input = document.createElement('input')
    input.type = 'text'
    input.placeholder = 'Search your captures... (Use l: for links only)'
    input.className = 'search-input'
    input.addEventListener('keydown', onSearchKeyDown, true)
    input.addEventListener('input', debounceSearch, true)
    searchOverlayEl.appendChild(input)
    searchInputEl = input

    const results = document.createElement('div')
    results.className = 'search-results'
    searchOverlayEl.appendChild(results)
    searchResultsEl = results
  }
  document.body.appendChild(searchOverlayEl!)
  setTimeout(() => searchInputEl?.focus(), 0)
}

function onSearchKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.stopPropagation()
    closeSearchOverlay()
  }
}

function debounceSearch() {
  if (searchDebounce) window.clearTimeout(searchDebounce)
  searchDebounce = window.setTimeout(runSearch, 180)
}

async function runSearch() {
  const rawQuery = (searchInputEl?.value ?? '').trim()
  if (!rawQuery) {
    renderSearchResults([], searchResultsEl, closeSearchOverlay)
    return
  }
  
  
  const isLinkSearch = rawQuery.toLowerCase().startsWith('l:')
  const q = isLinkSearch ? rawQuery.slice(2).trim() : rawQuery
  
  console.log('[search-overlay] Raw query:', rawQuery, 'isLinkSearch:', isLinkSearch, 'query:', q)
  
  if (!q) {
    renderSearchResults([], searchResultsEl, closeSearchOverlay)
    return
  }
  
  try {
    
    if (isLinkSearch) {
      console.log('[search-overlay] Sending SEARCH_LINKS message with query:', q)
      const linkResp = await new Promise<{ results: any[] }>((resolve) => {
        chrome.runtime.sendMessage({ type: 'SEARCH_LINKS', q, limit: 30 }, (r) => {
          console.log('[search-overlay] SEARCH_LINKS response:', r)
          resolve(r)
        })
      })
      console.log('[search-overlay] Rendering', linkResp?.results?.length || 0, 'link results')
      renderSearchResults(Array.isArray(linkResp?.results) ? linkResp.results : [], searchResultsEl, closeSearchOverlay)
      return
    }
    
    
    const resp = await new Promise<{ results: any[]; mode?: string }>((resolve) => {
      chrome.runtime.sendMessage({ type: 'SEARCH_SEMANTIC', q, limit: 30 }, (r) => resolve(r))
    })
    if (resp && Array.isArray(resp.results)) {
      renderSearchResults(resp.results, searchResultsEl, closeSearchOverlay)
      return
    }
    const fallback = await new Promise<{ results: any[] }>((resolve) => {
      chrome.runtime.sendMessage({ type: 'SEARCH_CAPTURES', q, limit: 30 }, (r) => resolve(r))
    })
    renderSearchResults(Array.isArray(fallback?.results) ? fallback.results : [], searchResultsEl, closeSearchOverlay)
  } catch (e) {
    renderSearchResults([], searchResultsEl, closeSearchOverlay)
  }
}

