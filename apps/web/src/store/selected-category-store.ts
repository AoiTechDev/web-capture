import { create } from "zustand";

interface SelectedCategoryState {
  selected: string | null;
  setSelected: (name: string | null) => void;
}

export const useSelectedCategoryStore = create<SelectedCategoryState>()((set) => ({
  selected: null,
  setSelected: (name) => set({ selected: name }),
}));

