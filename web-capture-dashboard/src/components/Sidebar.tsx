"use client";
import React from "react";
import { useQuery } from "convex/react";
import { api } from "@/convexApi";
import { useSelectedCategoryStore } from "@/store/selected-category-store";

const Sidebar = () => {
  const categories = useQuery(api.captures.listCategories);
  const { selected, setSelected } = useSelectedCategoryStore();
  return (
    <div className="w-52  p-2 bg-card border-r-[1px] border-border  ">
      <div className="mt-6">
        <div className="flex items-center gap-2">
          <div className="rounded-full bg-red-500 w-8 h-8 text-sm flex justify-center items-center">
            PB
          </div>
          <div>
            <p className="text-sm">Paweł Bornikowski</p>
          </div>
        </div>
        <p className="text-xs w-fit">pawel.bornikowksi@gmail.com</p>
      </div>

      <div className="mt-12 space-y-2">
        <button
          className={`w-full text-left px-2 py-1 rounded ${selected === null ? "bg-neutral-800" : "hover:bg-neutral-800"}`}
          onClick={() => setSelected(null)}
        >
          📥 Unsorted
        </button>
        {categories?.map((c: { _id: string; name: string }) => (
          <button
            key={c._id}
            className={`w-full text-left px-2 py-1 rounded ${selected === c.name ? "bg-neutral-800" : "hover:bg-neutral-800"}`}
            onClick={() => setSelected(c.name)}
          >
            {c.name}
          </button>
        ))}
      </div>
    </div>
  );
};

export default Sidebar;
