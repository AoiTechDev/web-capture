"use client";

import { memo, useMemo } from "react";

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

  if (safeItems.length === 0) {
    return (
      <div className="text-center text-gray-500 py-8">No text captures</div>
    );
  }

  return (
    <div className="w-full">
      <div className="flex flex-wrap gap-3">
        {safeItems.map((item) => (
          <div key={item._id} className="block max-w-sm w-fit">
            <div className="bg-card rounded-xl shadow-sm border border-border px-3 py-2 text-sm whitespace-pre-wrap break-words">
              {item.content}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default memo(TextWrapLayout);