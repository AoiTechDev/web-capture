export async function checkAuth(): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'CHECK_AUTH' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[Content Script]: Error checking auth:', chrome.runtime.lastError)
        resolve(false)
        return
      }
      resolve(response?.isAuthenticated ?? false)
    })
  })
}

