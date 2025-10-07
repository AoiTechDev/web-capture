"use client";
import { api } from "../../../../../packages/backend/convex/_generated/api";
import MasonryLayout from "@/components/MansoryLayout";
import MaximizedImage from "@/components/MaximizedImage";
import TextWrapLayout from "@/components/TextWrapLayout";
import { useSelectedCategoryStore } from "@/store/selected-category-store";
import { useStableQuery } from "@/hooks/useStableQuery";
import { useMemo, useState } from "react";
import { Search, Plus, Images, Camera, Link, FileText, Code } from "lucide-react";

type Kind = "image" | "text" | "link" | "code" | "screenshot";
export default function DashboardPage() {
  const { selected } = useSelectedCategoryStore();
  const [selectedKind, setSelectedKind] = useState<Kind>("image");
  // Use stable cached query results; default to [] to make return typed and non-undefined
  const captures = useStableQuery(
    api.captures.byCategoryAndKind,
    { category: selected || "unsorted", kind: selectedKind },
    []
  );
  const tabs = useMemo(
    () => [
      { key: "image" as const, label: "Images", Icon: Images },
      { key: "screenshot" as const, label: "Screenshots", Icon: Camera },
      { key: "link" as const, label: "Links", Icon: Link },
      { key: "text" as const, label: "Text", Icon: FileText },
      { key: "code" as const, label: "Code", Icon: Code },
    ],
    []
  );

  // Pass the selected category to the query

  return (
    <main id="main-content" className="flex-1 flex flex-col w-full">
      <header id="dashboard-header" className="p-6 border-b border-gray-800">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold text-white">Dashboard</h1>
          <div className="flex items-center space-x-4">
            <div className="relative">
              <input
                type="text"
                placeholder="Search captures..."
                className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 pl-10 text-white placeholder-gray-400 focus:border-cyan-400 focus:outline-none w-80"
              />
              <Search className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
            </div>
           
          </div>
        </div>

        <div id="tabs" className="flex space-x-2">
          {tabs.map(({ key, label, Icon }) => {
            const active = selectedKind === key;
            return (
              <button
                key={key}
                onClick={() => setSelectedKind(key)}
                className={`px-6 py-2 rounded-lg font-semibold transition-all duration-300 inline-flex items-center gap-2 ${
                  active
                    ? "bg-gradient-to-r from-cyan-500 to-purple-600 text-white"
                    : "bg-white/10 text-gray-400 hover:bg-white/15"
                }`}
                aria-selected={active}
                role="tab"
              >
                <Icon className="w-4 h-4" /> {label}
              </button>
            );
          })}
        </div>
      </header>

      <div id="content-area" className="flex-1 p-6 overflow-y-auto">
        {selectedKind === "image" && <MasonryLayout items={captures as any} />}
        {selectedKind === "text" && <TextWrapLayout items={captures as any} />}
        {/* TODO: implement other kinds rendering when data is available */}
      </div>

      <MaximizedImage />
    </main>
  );
}