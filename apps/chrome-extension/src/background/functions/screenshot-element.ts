/**
 * Capture the visible tab and hand it back to the requesting tab to crop.
 *
 * `msg.meta` (kind, tagName, clipped, category, tags) rides along untouched so
 * the crop step can save the result as the right kind of capture. Resolves
 * once the crop request is sent; the crop-and-upload step reports its own
 * outcome to the user.
 */
export const screenshotElement = async ({
    msg, sender
}: {
    msg: any;
    sender: chrome.runtime.MessageSender;
}): Promise<void> => {
    const tabId = sender?.tab?.id;
    if (!tabId) throw new Error('No tab to capture');

    const dataUrl = await new Promise<string>((resolve, reject) => {
        try {
          chrome.tabs.captureVisibleTab(
            { format: 'png', quality: 100 },
            (url) => {
              if (chrome.runtime.lastError || !url) {
                reject(new Error(chrome.runtime.lastError?.message ?? 'Could not capture the tab'));
              } else resolve(url);
            }
          );
        } catch (e) {
          reject(e);
        }
      });
    // Not awaited: the content script's listener does not answer this one.
    chrome.tabs
      .sendMessage(tabId, {
        type: 'CROP_AND_UPLOAD',
        dataUrl,
        rect: msg.rect,
        meta: msg.meta ?? undefined,
      })
      .catch(() => {});
}
