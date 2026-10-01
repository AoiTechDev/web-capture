"use client";

import Image from "next/image";
import { X } from "lucide-react";
import React, { useCallback, useEffect } from "react";
import { useQuery } from "convex/react";
import { usePathname, useRouter } from "next/navigation";
import { api } from "../../../../packages/backend/convex/_generated/api";
import type { Id } from "../../../../packages/backend/convex/_generated/dataModel";
import { useMaximizeImageStore } from "@/store/maximize-image-store";
import { withColorFilter } from "@/lib/capture-filters";
import DesignDnaPanel, { hasDetails } from "./DesignDnaPanel";
import CaptureInfoPanel, { type CaptureInfo } from "./CaptureInfoPanel";

/** The editable fields of the live capture document. */
type LiveCapture = {
  url?: string;
  tags?: string[];
  sessionId?: string;
  aiDescription?: string;
  aiCategory?: string;
  aiTags?: string[];
};

const MaximizedImage = () => {
  const { isOpen, setIsOpen, imageUrl, details, capture } = useMaximizeImageStore();
  const router = useRouter();
  const pathname = usePathname();

  // Live, so tag and session edits show as soon as they are saved.
  const live = useQuery(
    api.captures.getCaptureById,
    isOpen && capture ? { id: capture.id as Id<"captures"> } : "skip"
  ) as LiveCapture | null | undefined;

  const withDna = hasDetails(details);
  const withPanel = withDna || !!capture;

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

  // Deleted (here, in the grid or in another tab): nothing left to show.
  useEffect(() => {
    if (isOpen && live === null) setIsOpen(false);
  }, [isOpen, live, setIsOpen]);

  // A swatch filters the library by its colour: on the dashboard in place,
  // keeping the other filters; from anywhere else, on a fresh dashboard.
  const pickColor = useCallback(
    (hex: string) => {
      setIsOpen(false);
      if (pathname === "/dashboard") {
        window.history.replaceState(null, "", `/dashboard${withColorFilter(window.location.search, hex)}`);
      } else {
        router.push(`/dashboard${withColorFilter("", hex)}`);
      }
    },
    [pathname, router, setIsOpen]
  );

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) setIsOpen(false);
  };

  if (!isOpen) return null;

  const info: CaptureInfo | null = capture
    ? {
        id: capture.id,
        title: capture.title ?? null,
        pageUrl: live?.url ?? capture.pageUrl ?? null,
        aiDescription: live?.aiDescription ?? capture.aiDescription ?? null,
        aiCategory: live?.aiCategory ?? capture.aiCategory ?? null,
        aiTags: live?.aiTags ?? capture.aiTags ?? [],
        tags: live?.tags ?? capture.tags ?? [],
        sessionId: live ? (live.sessionId ?? null) : (capture.sessionId ?? null),
        sessionName: capture.sessionName ?? null,
      }
    : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(8,9,10,0.85)] backdrop-blur-sm"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label={info?.title || "Capture"}
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
          alt={info?.title || "Capture"}
          width={1600}
          height={1000}
          // With the side panel: beside the image from md up (leave its 320px),
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
        {withPanel && (
          <aside className="flex max-h-[40vh] w-full shrink-0 flex-col overflow-y-auto border-t border-[var(--border)] bg-[var(--surface)] md:max-h-[90vh] md:w-[320px] md:border-l md:border-t-0">
            {info && <CaptureInfoPanel key={info.id} info={info} onDeleted={() => setIsOpen(false)} />}
            {withDna && details && <DesignDnaPanel details={details} onPickColor={pickColor} />}
          </aside>
        )}
      </div>
    </div>
  );
};

export default MaximizedImage;
