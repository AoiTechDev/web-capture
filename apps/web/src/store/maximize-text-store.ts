import { create } from "zustand";

export const useMaximizeTextStore = create<{
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  text: string;
  setText: (text: string) => void;
}>((set) => ({
  isOpen: false,
  setIsOpen: (isOpen) => set({ isOpen }),
  text: "",
  setText: (text) => set({ text }),
}));


