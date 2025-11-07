"use client";

import { memo, useMemo } from "react";
import { useMaximizeTextStore } from "@/store/maximize-text-store";

type TextItem = {
  _id: string;
  kind: "text";
  content: string;
  url: string;
  timestamp: number;
  category?: string;
};

interface TextWrapLayoutProps {
  items: TextItem[];
}

function TextWrapLayout({ items }: TextWrapLayoutProps) {
  const safeItems = useMemo(() => items ?? [], [items]);
  const getHostname = (rawUrl?: string) => {
    try {
      if (!rawUrl) return null;
      return new URL(rawUrl).hostname;
    } catch {
      return rawUrl || null;
    }
  };
  const { setIsOpen: setTextModalOpen, setText } = useMaximizeTextStore();

  if (safeItems.length === 0) {
    return (
      <div className="text-center text-gray-500 py-8">No text captures</div>
    );
  }

  return (
    <div className="w-full">
      <div className="flex flex-wrap gap-4">
        {safeItems.map((item) => (
          <div
            key={item._id}
            className="w-[162px] sm:w-[192px] lg:w-[280px]"
          >
            <div className="rounded-2xl shadow-lg overflow-hidden group duration-100 relative flex flex-col bg-slate-900/60 border border-gray-800">
              <div className="p-4">
                <div
                  className="text-sm text-gray-100 whitespace-pre-wrap break-words"
                  style={{
                    display: "-webkit-box",
                    WebkitLineClamp: 10,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {item.content}
                </div>
                <button
                  type="button"
                  className="mt-3 text-xs font-bold text-cyan-400 hover:text-cyan-300"
                  onClick={() => {
                    setText(item.content);
                    setTextModalOpen(true);
                  }}
                >
                  Show more
                </button>
              </div>
              {item.url ? (
                <div className="bg-gradient-to-br from-slate-800 to-slate-900 px-4 py-3">
                  <div className="text-gray-300 text-xs font-medium truncate">
                    {getHostname(item.url)}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default memo(TextWrapLayout);