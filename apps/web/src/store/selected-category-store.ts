import { create } from "zustand";

interface SelectedCategoryState {
  selected: string | null;
  setSelected: (name: string | null) => void;
}

export const useSelectedCategoryStore = create<SelectedCategoryState>()((set) => ({
  selected: "unsorted",
  setSelected: (name) => set({ selected: name }),
}));

