import { create } from "zustand";
import type { CaptureDetails } from "@/components/DesignDnaPanel";

export const useMaximizeImageStore = create<{
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  imageUrl: string;
  setImageUrl: (imageUrl: string) => void;
  /** DNA / palette of the open capture; null for captures without them. */
  details: CaptureDetails | null;
  setDetails: (details: CaptureDetails | null) => void;
}>((set) => ({
  isOpen: false,
  setIsOpen: (isOpen) => set({ isOpen }),
  imageUrl: "",
  setImageUrl: (imageUrl) => set({ imageUrl }),
  details: null,
  setDetails: (details) => set({ details }),
}));
