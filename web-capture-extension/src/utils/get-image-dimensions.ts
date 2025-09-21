export function getImageDimensions(blob: Blob) {
  return new Promise((resolve, reject) => {
    // Create an ImageBitmap for service worker context
    createImageBitmap(blob)
      .then((imageBitmap) => {
        resolve({ width: imageBitmap.width, height: imageBitmap.height });
        imageBitmap.close(); // Clean up the ImageBitmap
      })
      .catch(reject);
  });
}
