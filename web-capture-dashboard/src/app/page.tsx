"use client";

import { api } from "@/convexApi";
import { useQuery } from "convex/react";
import MasonryLayout from "@/components/MasonryLayout";
import MaximizedImage from "@/components/MaximizedImage";
import { useState } from "react";

export default function Home() {
  const images = useQuery(api.captures.imageUrls);

  if (images === undefined)
    return (
      <div className="flex justify-center items-center min-h-screen">
        Loading…
      </div>
    );

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4">
        <MasonryLayout items={images} />
      </div>

      <MaximizedImage />
    </div>
  );
}
