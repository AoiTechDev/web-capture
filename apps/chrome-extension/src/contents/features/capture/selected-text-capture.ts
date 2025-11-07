import { showCategoryOverlay } from "../category/category-overlay"
import { addRecentCategory, addRecentTags, getRecentCategories } from "../category/category-storage"

export async function captureSelectedText(promptForCategory?: boolean) {
  const selection = window.getSelection()
  const text = selection?.toString().trim() || ""
  if (!text) return false

  let category: string | undefined
  let tags: string[] | undefined

  if (promptForCategory) {
    const categories = await (async () => {
      try {
        const res = await chrome.runtime.sendMessage({ type: "GET_CATEGORIES" })
        const list: Array<{ _id: string; name: string }> = Array.isArray(res?.categories)
          ? res.categories
          : []
        if (list.length > 0) return list.map((c) => c.name)
      } catch {}
      return await getRecentCategories()
    })()

    const result = await showCategoryOverlay(
      async () => categories,
      async () => {
        try {
          const res = await chrome.runtime.sendMessage({ type: "GET_TAGS" })
          const list: Array<{ name: string }> = Array.isArray(res?.tags) ? res.tags : []
          if (list.length > 0) {
            return list.map((t) => t.name)
          }
        } catch {}
        try {
          const local = await chrome.storage.sync.get({ recentTags: [] as string[] })
          if (Array.isArray(local.recentTags)) return local.recentTags.slice(0, 12)
        } catch {}
        return [] as string[]
      }
    )

    if (result.kind === "cancel") return false
    category = result.category
    tags = Array.isArray(result.tags) ? result.tags : undefined
    if (category) await addRecentCategory(category)
    if (tags && tags.length > 0) await addRecentTags(tags)
  }

  try {
    await chrome.runtime.sendMessage({
      type: "SAVE_NON_IMAGE_CAPTURE",
      data: {
        kind: "text",
        content: text,
        url: window.location.href,
        timestamp: Date.now(),
        category,
        tags
      }
    })
    return true
  } catch (error) {
    console.error("❌ Failed to capture selected text:", error)
    return false
  }
}


