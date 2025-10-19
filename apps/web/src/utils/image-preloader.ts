
const loadedImageUrls = new Set<string>();

export function preloadImage(url?: string): Promise<void> {
  if (!url) return Promise.resolve();
  if (loadedImageUrls.has(url)) return Promise.resolve();

  return new Promise((resolve) => {
    if (typeof window === "undefined") {
      resolve();
      return;
    }

    type ImageWithFetchPriority = HTMLImageElement & {
      fetchPriority?: "high" | "low" | "auto";
    };

    const img = new window.Image() as ImageWithFetchPriority;
    img.decoding = "async";
    img.fetchPriority = "high";
    img.onload = () => {
      loadedImageUrls.add(url);
      resolve();
    };
    img.onerror = () => {
      resolve();
    };
    img.src = url;
  });
}

export function preloadImages(urls: Array<string | undefined>): Promise<void> {
  const uniqueUrls = Array.from(new Set(urls.filter(Boolean) as string[]));
  return Promise.all(uniqueUrls.map((u) => preloadImage(u))).then(() => undefined);
}


