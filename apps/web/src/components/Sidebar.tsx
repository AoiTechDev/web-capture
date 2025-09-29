"use client";
import React from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../packages/backend/convex/_generated/api";
import { useSelectedCategoryStore } from "@/store/selected-category-store";
import {
  SignedOut,
  SignInButton,
  SignUpButton,
  SignedIn,
  UserButton,
} from "@clerk/nextjs";

const Sidebar = () => {
  const categories = useQuery(api.captures.listCategories);
  const { selected, setSelected } = useSelectedCategoryStore();
  return (
    <div className="w-52  p-2 bg-card border-r-[1px] border-border  ">
      <SignedOut>
        <SignInButton />
        <SignUpButton>
          <button className="bg-[#6c47ff] text-white rounded-full font-medium text-sm sm:text-base h-10 sm:h-12 px-4 sm:px-5 cursor-pointer">
            Sign Up
          </button>
        </SignUpButton>
      </SignedOut>
      <SignedIn>
        <UserButton />
      </SignedIn>

      <div className="mt-12 space-y-2">
        <button
          className={`w-full text-left px-2 py-1 rounded ${selected === "unsorted" ? "bg-neutral-800" : "hover:bg-neutral-800"}`}
          onClick={() => setSelected("unsorted")}
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
