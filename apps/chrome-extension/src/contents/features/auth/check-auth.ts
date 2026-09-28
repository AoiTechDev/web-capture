export async function checkAuth(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'CHECK_AUTH' }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('[Content Script]: Error checking auth:', chrome.runtime.lastError)
          resolve(false)
          return
        }
        resolve(response?.signedIn === true)
      })
    } catch (e) {
      // The extension was reloaded or updated since this page loaded: this
      // script can no longer reach it. That is not a sign-in problem.
      const message = e instanceof Error ? e.message : String(e)
      if (message.includes('Extension context invalidated')) {
        alert('The extension was updated. Please refresh this page to capture again.')
      } else {
        console.error('[Content Script]: Error checking auth:', e)
      }
      resolve(false)
    }
  })
}
