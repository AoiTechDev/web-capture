import { create } from "zustand";

export const useMaximizeImageStore = create<{
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  imageUrl: string;
  setImageUrl: (imageUrl: string) => void;
}>((set) => ({
  isOpen: false,
  setIsOpen: (isOpen) => set({ isOpen }),
  imageUrl: "",
  setImageUrl: (imageUrl) => set({ imageUrl }),
}));