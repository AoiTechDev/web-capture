import { create } from "zustand";
import type { CaptureDetails } from "@/components/DesignDnaPanel";

/**
 * What the grid knew about the capture when it was opened. The detail view
 * reads the live document for anything editable; this fills in until it
 * arrives, and for what the document lacks (the session's name).
 */
export type DetailCapture = {
  id: string;
  kind?: string;
  title?: string | null;
  pageUrl?: string | null;
  aiDescription?: string | null;
  aiCategory?: string | null;
  aiTags?: string[] | null;
  tags?: string[];
  sessionId?: string | null;
  sessionName?: string | null;
};

export const useMaximizeImageStore = create<{
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  imageUrl: string;
  setImageUrl: (imageUrl: string) => void;
  /** DNA / palette of the open capture; null for captures without them. */
  details: CaptureDetails | null;
  setDetails: (details: CaptureDetails | null) => void;
  /** The open capture; null when opened without one. */
  capture: DetailCapture | null;
  setCapture: (capture: DetailCapture | null) => void;
}>((set) => ({
  isOpen: false,
  setIsOpen: (isOpen) => set({ isOpen }),
  imageUrl: "",
  setImageUrl: (imageUrl) => set({ imageUrl }),
  details: null,
  setDetails: (details) => set({ details }),
  capture: null,
  setCapture: (capture) => set({ capture }),
}));
