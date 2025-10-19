export async function getRecentCategories(): Promise<string[]> {
  try {
    const res = await chrome.storage.sync.get({
      recentCategories: [] as string[],
    })
    const arr = Array.isArray(res.recentCategories) ? res.recentCategories : []
    return arr.slice(0, 8)
  } catch {
    return []
  }
}

export async function addRecentCategory(name: string) {
  try {
    const res = await chrome.storage.sync.get({
      recentCategories: [] as string[],
    })
    const arr: string[] = Array.isArray(res.recentCategories)
      ? res.recentCategories
      : []
    const next = [name, ...arr.filter((c) => c !== name)].slice(0, 12)
    await chrome.storage.sync.set({ recentCategories: next })
  } catch {
    // ignore
  }
}

export async function addRecentTags(tags: string[]) {
  try {
    const res = await chrome.storage.sync.get({ recentTags: [] as string[] })
    const existing: string[] = Array.isArray(res.recentTags) ? res.recentTags : []
    const merged = Array.from(new Set([...
      tags.map((t) => t.trim().toLowerCase()).filter(Boolean),
      ...existing
    ])).slice(0, 24)
    await chrome.storage.sync.set({ recentTags: merged })
  } catch {
    // ignore
  }
}

