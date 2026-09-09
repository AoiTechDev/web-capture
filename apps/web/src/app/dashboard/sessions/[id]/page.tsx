"use client";

import { use } from "react";
import Link from "next/link";
import { useCachedQuery } from "@/hooks/useStableQuery";
import { MasonrySkeleton } from "@/components/Skeletons";
import { ArrowLeft } from "lucide-react";
import MasonryLayout from "@/components/MansoryLayout";
import MaximizedImage from "@/components/MaximizedImage";
import { api } from "../../../../../../../packages/backend/convex/_generated/api";
import { Id } from "../../../../../../../packages/backend/convex/_generated/dataModel";
import { isUint16Array } from "util/types";
import LinkList from "@/components/LinkList";
import TextWrapLayout from "@/components/TextWrapLayout";

/** The query builds these rows dynamically, so name the shape explicitly here. */
type SessionItem = {
  _id: string;
  kind: string;
  url: string | null;
  pageUrl: string | null;
  width: number;
  height: number;
  alt: string;
  tags: string[];
  storageId: string | null;
  content: string | null;
  href: string | null;
  domain: string | null;
  timestamp: number;
};

export default function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: session, isLoading } = useCachedQuery<any>(api.sessions.getSession, {
    id: id as Id<"sessions">,
  });

  if (isLoading) {
    return (
      <main className="flex-1 overflow-y-auto">
        <div className="border-b border-[var(--border)] px-6 py-5">
          <div className="h-3 w-20 animate-pulse rounded bg-[var(--surface)]" />
          <div className="mt-3 h-6 w-64 animate-pulse rounded bg-[var(--surface)]" />
          <div className="mt-2 h-3 w-48 animate-pulse rounded bg-[var(--surface)]" />
        </div>
        <div className="p-6">
          <MasonrySkeleton count={9} />
        </div>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="flex-1 p-6">
        <Link href="/dashboard/sessions" className="text-[13px] text-[var(--blue-400)] hover:underline">
          ← Sessions
        </Link>
        <p className="mt-4 text-[13px] text-[var(--text-muted)]">This session doesn&apos;t exist.</p>
      </main>
    );
  }

  // MasonryLayout measures against concrete dimensions, so only items that have
  // a rendered image belong in it. Text and link captures need their own view.
  const items = session.items as SessionItem[];
  const visual = items.filter((i) => !!i.url);

  const links = items.filter((i) => i.kind === 'link')
  const text = items.filter((i) => i.kind === 'text')
  return (
    <main className="flex-1 flex flex-col w-full overflow-y-auto">
      <header className="border-b border-[var(--border)] px-6 py-5">
        <Link
          href="/dashboard/sessions"
          className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
        >
          <ArrowLeft size={14} /> Sessions
        </Link>

        <h1 className="text-[24px] font-semibold text-[var(--text)]">{session.displayName}</h1>

        <p className="mt-1.5 text-[13px] text-[var(--text-muted)]">
          {new Date(session.startedAt).toLocaleString()} · {session.itemCount} item
          {session.itemCount === 1 ? "" : "s"}
          {session.domains.length > 0 && ` · ${session.domains.slice(0, 3).join(", ")}`}
        </p>

        {session.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-3">
            {session.tags.map((tag: string) => (
              <span
                key={tag}
                className="chip"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </header>

      <div className="p-6">
        {items.length === 0 && (
          <p className="text-[13px] text-[var(--text-muted)]">Nothing in this session.</p>
        )}

        {visual.length > 0 && (
          <MasonryLayout
            items={visual.map((i) => ({
              _id: i._id,
              url: i.url ?? undefined,
              width: i.width,
              height: i.height,
              kind: i.kind,
              alt: i.alt,
              storageId: i.storageId ?? undefined,
              pageUrl: i.pageUrl ?? undefined,
              tags: i.tags,
            }))}
          />
        )}

        <div className="mt-8">
          <h2 className="mb-3 text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--text-subtle)]">
            Links
          </h2>
          <LinkList
            items={
              (links as unknown as Array<{
                _id: string;
                kind: "link";
                href: string;
                text?: string;
                url: string;
                title?: string;
                timestamp: number;
                category?: string;
                tags?: string[];
              }>)
            }
          />
        </div>

        <div className="mt-8">
          <h2 className="mb-3 text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--text-subtle)]">
            Text
          </h2>
          <TextWrapLayout
            items={
              text as unknown as Array<{
                _id: string;
                kind: "text";
                content: string;
                url: string;
                timestamp: number;
                category?: string;
              }>
            }
          />
        </div>

      </div>

    </main>
  );
}
