"use client";
import { useQuery } from "convex/react";
import { api } from "../../../../packages/backend/convex/_generated/api";
import { useSelectedCategoryStore } from "@/store/selected-category-store";
import {
  SignedIn,
  UserButton
} from "@clerk/nextjs";
import { useUser } from "@clerk/nextjs";
import Link from "next/link";

const Sidebar = () => {
  const categories = useQuery(api.captures.listCategories);
  const tags = useQuery(api.captures.listTags);
  const { selected, setSelected } = useSelectedCategoryStore();
  const { user } = useUser();
  return (
    <aside className="w-60 glass-card border-r border-gray-800 flex flex-col">
      <div className="p-6 border-b border-gray-800">
      <Link href="/" className="flex items-center space-x-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-400 to-purple-600 flex items-center justify-center">
            <svg
              className="w-6 h-6 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </div>
          <span className="text-xl font-bold gradient-text">Web Capture</span>
        </Link>
    

     <SignedIn>
              <div>
               <div className="flex items-center gap-2">
              <UserButton />
                
                 <div className="font-semibold text-white">{user?.fullName || user?.username || "Account"}</div>
                </div>
                <div className="text-sm text-gray-400">{user?.primaryEmailAddress?.emailAddress || user?.emailAddresses?.[0]?.emailAddress}</div>
              </div>
          </SignedIn>


      </div>

      <div className="flex-1 p-6 overflow-y-auto">
        <div className="mb-8">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Categories</h3>
          <div className="space-y-2">
            <button
              className={`w-full flex items-center justify-between p-3 rounded-lg transition-colors cursor-pointer ${
                selected === "unsorted"
                  ? "bg-gradient-to-r from-cyan-500/20 to-purple-600/20 border border-cyan-400/30"
                  : "hover:bg-gray-800/50"
              }`}
              onClick={() => setSelected("unsorted")}
            >
              <div className="flex items-center space-x-3">
                <span className="text-cyan-400">📥</span>
                <span className="text-white">All Captures</span>
              </div>
            </button>

            {categories?.map((c: { _id: string; name: string }) => (
              <button
                key={c._id}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg transition-colors cursor-pointer ${
                  selected === c.name
                    ? "bg-gradient-to-r from-cyan-500/20 to-purple-600/20 border border-cyan-400/30"
                    : "hover:bg-gray-800/50"
                }`}
                onClick={() => setSelected(c.name)}
              >
                <div className="flex items-center space-x-3">
                  <span className="text-purple-400">📂</span>
                  <span className={selected === c.name ? "text-white" : "text-gray-300"}>{c.name}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Tags</h3>
          <div className="flex flex-wrap gap-2">
            {tags?.map((t: { name: string }) => (
              <span
                key={t.name}
                className="px-3 py-1 bg-gray-800 text-gray-300 rounded-full text-sm cursor-pointer hover:bg-gray-700 transition-colors"
              >
                {t.name}
              </span>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
