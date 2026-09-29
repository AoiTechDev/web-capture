"use client";

import Image from "next/image";
import { X } from "lucide-react";
import React, { useEffect } from "react";
import { useMaximizeImageStore } from "@/store/maximize-image-store";
import DesignDnaPanel, { hasDetails } from "./DesignDnaPanel";

const MaximizedImage = () => {
  const { isOpen, setIsOpen, imageUrl, details } = useMaximizeImageStore();
  const withPanel = hasDetails(details);

  // Escape closes. An overlay that traps you until you find the X is the most
  // common complaint about lightboxes.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, setIsOpen]);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) setIsOpen(false);
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(8,9,10,0.85)] backdrop-blur-sm"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
    >
      <button
        className="absolute right-5 top-5 flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
        onClick={() => setIsOpen(false)}
        aria-label="Close"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="relative flex max-h-[90vh] max-w-[90vw] flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-2xl md:flex-row">
        <Image
          src={imageUrl || ""}
          alt="Capture"
          width={1600}
          height={1000}
          // With the DNA panel: beside the image from md up (leave its 320px),
          // stacked under it on narrow screens (leave it half the height).
          className={
            withPanel
              ? "min-w-0 object-contain max-h-[50vh] max-w-[90vw] md:max-h-[80vh] md:max-w-[calc(90vw-320px)]"
              : "object-contain"
          }
          unoptimized
          priority
          sizes="90vw"
          style={
            withPanel
              ? { width: "auto", height: "auto" }
              : { maxWidth: "90vw", maxHeight: "80vh", width: "auto", height: "auto" }
          }
        />
        {withPanel && details && <DesignDnaPanel details={details} />}
      </div>
    </div>
  );
};

export default MaximizedImage;
