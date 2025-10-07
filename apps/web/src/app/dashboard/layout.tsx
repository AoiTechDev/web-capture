// apps/web/src/app/dashboard/layout.tsx
import Sidebar from "@/components/Sidebar";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import React from "react";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in"); // Not authed → send to sign-in

  return (
    <div className="flex h-screen gradient-bg text-white overflow-x-hidden">
      <Sidebar />
      {children}
    </div>
  );
}