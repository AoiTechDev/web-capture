export const screenshotElement = async ({
    msg, sender, sendResponse
}: {
    msg: any;
    sender: any;
    sendResponse: (response: { statusCode: number; message: string }) => void;
}) => {
    const dataUrl = await new Promise<string>((resolve, reject) => {
        try {
          chrome.tabs.captureVisibleTab(
            { format: 'png', quality: 100 },
            (url) => {
              if (chrome.runtime.lastError || !url) reject(chrome.runtime.lastError);
              else resolve(url);
            }
          );
        } catch (e) {
          reject(e);
        }
      });
      if (sender?.tab?.id) {
        chrome.tabs.sendMessage(sender.tab.id, {
          type: 'CROP_AND_UPLOAD',
          dataUrl,
          rect: msg.rect,
        });
      }
      sendResponse({ statusCode: 200, message: 'Screenshot captured' });
      return;
}