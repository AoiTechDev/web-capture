// apps/web/src/app/dashboard/layout.tsx
import MaximizedImage from "@/components/MaximizedImage";
import MaximizedText from "@/components/MaximizedText";
import Sidebar from "@/components/Sidebar";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import React from "react";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in"); // Not authed → send to sign-in

  return (
    <div className="flex h-screen overflow-x-hidden bg-[var(--bg)] text-[var(--text)]">
      <Sidebar />
      {children}
      <MaximizedImage />
      <MaximizedText />
    </div>
  );
}