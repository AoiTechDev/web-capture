import { useEffect, useState } from "react";

interface ElementType {
  type: string;
  content?: string;
  src?: string;
  alt?: string;
  href?: string;
  text?: string;
}

interface CapturedElement {
  id: string;
  kind: ElementType;
  content: string;
  url: string;
  timestamp: number;
}

function App() {
  const [captures, setCaptures] = useState<CapturedElement[]>([]);
  const [latestCapture, setLatestCapture] = useState<CapturedElement | null>(
    null
  );

  useEffect(() => {
    console.log("App mounted");

    // Load existing captures from storage
    loadCaptures();

    // Listen for new captures from background script
    const handleMessage = (message: {
      type: string;
      data: CapturedElement;
    }) => {
      if (message.type === "ELEMENT_CAPTURED") {
        console.log("New element captured:", message.data);
        setLatestCapture(message.data);

        // Add to captures list
        setCaptures((prev) => [message.data, ...prev]);
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);

    // Cleanup listener on unmount
    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, []);

  const loadCaptures = async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "GET_CAPTURES",
      });
      if (response && response.captures) {
        setCaptures(response.captures);
      }
    } catch (error) {
      console.error("Failed to load captures:", error);
    }
  };

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  const getElementTypeIcon = (type: ElementType) => {
    if (typeof type === "object" && type.type) {
      switch (type.type) {
        case "image":
          return "🖼️";
        case "text":
          return "📝";
        case "link":
          return "🔗";
        case "code":
          return "💻";
        default:
          return "📄";
      }
    }
    return "📄";
  };

  return (
    <div className="w-[700px] h-[400px] p-4 bg-gray-50">
      <h1 className="text-xl font-bold mb-4 text-gray-800">Web Capture</h1>

      {latestCapture && (
        <div className="mb-4 p-3 bg-green-100 border border-green-300 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">
              {getElementTypeIcon(latestCapture.kind)}
            </span>
            <span className="font-semibold text-green-800">Latest Capture</span>
          </div>
          <p className="text-sm text-green-700 truncate">
            {latestCapture.content}
          </p>
          <p className="text-xs text-green-600">
            {formatTimestamp(latestCapture.timestamp)}
          </p>
        </div>
      )}

      <div className="space-y-2 max-h-80 overflow-y-auto">
        {captures.length === 0 ? (
          <p className="text-gray-500 text-center py-8">
            No captures yet. Press Ctrl+Shift+S on any webpage to start
            capturing!
          </p>
        ) : (
          captures.map((capture) => (
            <div
              key={capture.id}
              className="p-3 bg-white border border-gray-200 rounded-lg shadow-sm"
            >
              {capture.kind.type === "image" && (
                <img
                  src={capture.kind.src}
                  alt={capture.kind.alt}
                  className="w-10 h-10 object-cover"
                />
              )}
              <div className="flex items-start gap-3">
                <span className="text-lg">
                  {getElementTypeIcon(capture.kind)}
                </span>
                <div className="flex-1 min-w-0">
                 
                  <p className="text-xs text-gray-500 truncate">
                    {capture.url}
                  </p>
                  <p className="text-xs text-gray-400">
                    {formatTimestamp(capture.timestamp)}
                  </p>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default App;
