"use client";

import { api } from "@/convexApi";
import { useQuery } from "convex/react";
import MasonryLayout from "@/components/MasonryLayout";
import MaximizedImage from "@/components/MaximizedImage";
import { useSelectedCategoryStore } from "@/store/selected-category-store";

export default function DashboardPage() {
  const { selected } = useSelectedCategoryStore();
  const images = useQuery(api.captures.imageUrls, {
    category: selected ?? undefined,
  });

  if (images === undefined)
    return (
      <div className="flex justify-center items-center min-h-screen">
        Loading…
      </div>
    );

  return (
    <div className="min-h-screen bg-gray-50 py-8 w-full">
      <div className="max-w-7xl mx-auto px-4">
        <MasonryLayout items={images} />
      </div>

      <MaximizedImage />
    </div>
  );
}
