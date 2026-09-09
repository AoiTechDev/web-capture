"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { ArrowLeft } from "lucide-react";
import MasonryLayout from "@/components/MansoryLayout";
import MaximizedImage from "@/components/MaximizedImage";
import { api } from "../../../../../../../packages/backend/convex/_generated/api";
import { Id } from "../../../../../../../packages/backend/convex/_generated/dataModel";

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
  const session = useQuery(api.sessions.getSession, { id: id as Id<"sessions"> });

  if (session === undefined) {
    return (
      <main className="flex-1 p-6">
        <p className="text-gray-500 text-sm">Loading…</p>
      </main>
    );
  }

  if (session === null) {
    return (
      <main className="flex-1 p-6">
        <Link href="/dashboard/sessions" className="text-sm text-cyan-400 hover:underline">
          ← Sessions
        </Link>
        <p className="text-gray-400 mt-4">This session doesn&apos;t exist.</p>
      </main>
    );
  }

  // MasonryLayout measures against concrete dimensions, so only items that have
  // a rendered image belong in it. Text and link captures need their own view.
  const items = session.items as SessionItem[];
  const visual = items.filter((i) => !!i.url);
  const nonVisual = items.filter((i) => !i.url);

  return (
    <main className="flex-1 flex flex-col w-full overflow-y-auto">
      <header className="p-6 border-b border-gray-800">
        <Link
          href="/dashboard/sessions"
          className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-white mb-3"
        >
          <ArrowLeft size={14} /> Sessions
        </Link>

        <h1 className="text-xl font-semibold">{session.displayName}</h1>

        <p className="text-sm text-gray-500 mt-1">
          {new Date(session.startedAt).toLocaleString()} · {session.itemCount} item
          {session.itemCount === 1 ? "" : "s"}
          {session.domains.length > 0 && ` · ${session.domains.slice(0, 3).join(", ")}`}
        </p>

        {session.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-3">
            {session.tags.map((tag: string) => (
              <span
                key={tag}
                className="text-[10px] bg-gray-800 text-gray-300 rounded-full px-2 py-0.5"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </header>

      <div className="p-6">
        {items.length === 0 && (
          <p className="text-gray-500 text-sm">Nothing in this session.</p>
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

        {nonVisual.length > 0 && (
          <div className="mt-8">
            <h2 className="text-xs uppercase tracking-wider text-gray-500 mb-3">
              Text &amp; links
            </h2>
            <ul className="space-y-2">
              {nonVisual.map((item) => (
                <li
                  key={item._id}
                  className="glass-card border border-gray-800 rounded-lg p-3"
                >
                  <a
                    href={item.href ?? item.pageUrl ?? "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-cyan-400 hover:underline break-all"
                  >
                    {item.alt || item.href || item.pageUrl}
                  </a>
                  {item.content && (
                    <p className="text-xs text-gray-400 mt-1 line-clamp-3">
                      {item.content}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <MaximizedImage />
    </main>
  );
}
