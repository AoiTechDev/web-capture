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
    input.placeholder = 'Search your captures...'
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
  const q = (searchInputEl?.value ?? '').trim()
  if (!q) {
    renderSearchResults([], searchResultsEl, closeSearchOverlay)
    return
  }
  try {
    // Prefer semantic search; fallback to metadata search if model not available
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

