"use client";

import { use } from "react";
import DesignSystemEditor from "@/components/design-system/DesignSystemEditor";
import type { Id } from "../../../../../../../../packages/backend/convex/_generated/dataModel";

export default function DesignSystemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <DesignSystemEditor sessionId={id as Id<"sessions">} />;
}
