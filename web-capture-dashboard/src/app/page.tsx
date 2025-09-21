"use client";

import { api } from "@/convexApi";
import { useQuery } from "convex/react";

export default function Home() {
  const images = useQuery(api.captures.imageUrls);
  if (images === undefined) return <div>Loading…</div>;
  return (
    <div className="flex">
      {images.map((img) => (
        <img key={img._id} src={img.url!} alt="" />
      ))}
    </div>
  );
}
