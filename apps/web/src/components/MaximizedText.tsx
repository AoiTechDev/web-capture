import { X } from "lucide-react";
import React from "react";
import { useMaximizeTextStore } from "@/store/maximize-text-store";

const MaximizedText = () => {
  const { isOpen, setIsOpen, text } = useMaximizeTextStore();

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      setIsOpen(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center mx-auto"
      onClick={handleBackdropClick}
    >
      <button
        className="absolute top-5 right-5 z-60"
        onClick={() => setIsOpen(false)}
        aria-label="Close"
      >
        <X className="w-7 h-7 text-white" />
      </button>
      <div className="relative max-w-[90vw] max-h-[90vh] w-full md:w-[80vw]">
        <div className="bg-slate-900 rounded-2xl p-6 overflow-auto max-h-[90vh] text-gray-100 whitespace-pre-wrap break-words">
          {text}
        </div>
      </div>
    </div>
  );
};

export default MaximizedText;


