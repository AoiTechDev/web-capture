"use client";

import Image from "next/image";
import { X } from "lucide-react";
import React, { useEffect } from "react";
import { useMaximizeImageStore } from "@/store/maximize-image-store";

const MaximizedImage = () => {
  const { isOpen, setIsOpen, imageUrl } = useMaximizeImageStore();

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

      <div className="relative max-h-[90vh] max-w-[90vw] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-2xl">
        <Image
          src={imageUrl || ""}
          alt="Capture"
          width={1600}
          height={1000}
          className="object-contain"
          unoptimized
          priority
          sizes="90vw"
          style={{
            maxWidth: "90vw",
            maxHeight: "80vh",
            width: "auto",
            height: "auto",
          }}
        />
      </div>
    </div>
  );
};

export default MaximizedImage;
