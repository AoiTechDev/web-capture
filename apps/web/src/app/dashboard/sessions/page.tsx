"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useMutation } from "convex/react";
import { useCachedQuery } from "@/hooks/useStableQuery";
import { SessionCardSkeleton } from "@/components/Skeletons";
import { Pencil, Check, X } from "lucide-react";
import { api } from "../../../../../../packages/backend/convex/_generated/api";
import { Id } from "../../../../../../packages/backend/convex/_generated/dataModel";

type SessionCard = {
  id: string;
  name: string | null;
  autoName: string | null;
  displayName: string;
  startedAt: number;
  lastCaptureAt: number;
  itemCount: number;
  domains: string[];
  tags: string[];
  endedAt: number | null;
  running: boolean;
  thumbnails: string[];
};

/** "Today"/"Yesterday" carry more meaning than a date for recent sessions. */
function formatDay(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (sameDay(d, today)) return "Today";
  if (sameDay(d, yesterday)) return "Yesterday";

  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

function formatDuration(startedAt: number, lastCaptureAt: number): string {
  const mins = Math.round((lastCaptureAt - startedAt) / 60000);
  if (mins < 1) return "under a minute";
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

const SessionTitle = ({ session }: { session: SessionCard }) => {
  const rename = useMutation(api.sessions.renameSession);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const commit = async () => {
    setEditing(false);
    await rename({ id: session.id as Id<"sessions">, name: draft.trim() });
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void commit();
            if (e.key === "Escape") setEditing(false);
          }}
          placeholder={session.autoName ?? "Name this session"}
          className="min-w-0 flex-1 border-b border-[var(--blue-500)] bg-transparent pb-0.5 text-[14px] text-[var(--text)] outline-none"
        />
        <button onClick={() => void commit()} className="p-1 text-[var(--blue-400)] transition-colors hover:text-[var(--blue-300)]">
          <Check size={14} />
        </button>
        <button onClick={() => setEditing(false)} className="p-1 text-[var(--text-subtle)] transition-colors hover:text-[var(--text)]">
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 group/title">
      <h3 className="truncate text-[14px] font-medium text-[var(--text)]">{session.displayName}</h3>
      <button
        onClick={(e) => {
          e.preventDefault();
          // Seed with the user's own name, never the generated one - prefilling
          // a derived string just gets it accepted verbatim.
          setDraft(session.name ?? "");
          setEditing(true);
        }}
        className="shrink-0 text-[var(--text-subtle)] opacity-0 transition-opacity hover:text-[var(--text)] group-hover/title:opacity-100"
        title="Rename session"
      >
        <Pencil size={12} />
      </button>
    </div>
  );
};

export default function SessionsPage() {
  // `listSessions` returns `as const`, so its inferred type is readonly; the
  // rows are re-typed as SessionCard below.
  const { data, isLoading } = useCachedQuery<any>(api.sessions.listSessions, {
    limit: 50,
    thumbsPerSession: 5,
  });
  const sessions = (data?.sessions ?? []) as SessionCard[];

  return (
    <main className="flex-1 flex flex-col w-full overflow-y-auto">
      <header className="border-b border-[var(--border)] px-6 py-5">
        <h1 className="text-[20px] font-semibold text-[var(--text)]">Sessions</h1>
        <p className="mt-1 text-[13px] text-[var(--text-muted)]">
          Start a session from the extension to group what you capture. Anything
          saved outside one lands in All Captures.
        </p>
      </header>

      <div className="p-6">
        {isLoading && <SessionCardSkeleton />}

        {!isLoading && sessions.length === 0 && (
          <div className="text-center py-20">
            <p className="mb-2 text-[15px] font-medium text-[var(--text)]">No sessions yet</p>
            <p className="mx-auto max-w-md text-[13px] leading-relaxed text-[var(--text-muted)]">
              Open the extension popup and hit <strong>Start a session</strong>.
              Everything you capture until you finish it is grouped here.
            </p>
          </div>
        )}

        {!isLoading && (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {sessions.map((session) => (
            <div
              key={session.id}
              className="surface-card-interactive group overflow-hidden"
            >
              <Link href={`/dashboard/sessions/${session.id}`} className="block">
                <div className="flex h-28 gap-px bg-[var(--bg)]">
                  {session.thumbnails.length === 0 ? (
                    <div className="flex flex-1 items-center justify-center text-[12px] text-[var(--text-subtle)]">
                      No previews
                    </div>
                  ) : (
                    session.thumbnails.map((src, i) => (
                      <div key={i} className="relative flex-1 min-w-0">
                        <Image
                          src={src}
                          alt=""
                          fill
                          sizes="120px"
                          className="object-cover"
                          unoptimized
                        />
                      </div>
                    ))
                  )}
                </div>
              </Link>

              <div className="p-4">
                <div className="flex items-center gap-2">
                  {session.running && (
                    <span
                      title="Recording"
                      className="recording-dot"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <SessionTitle session={session} />
                  </div>
                </div>

                <p className="mt-1.5 text-[12px] text-[var(--text-muted)]">
                  {formatDay(session.startedAt)} · {session.itemCount} item
                  {session.itemCount === 1 ? "" : "s"} ·{" "}
                  {formatDuration(session.startedAt, session.lastCaptureAt)}
                </p>

                {session.domains.length > 0 && (
                  <p className="mono mt-1 truncate text-[11px] text-[var(--text-subtle)]">
                    {session.domains.slice(0, 3).join(", ")}
                  </p>
                )}

                {session.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-3">
                    {session.tags.slice(0, 5).map((tag) => (
                      <span
                        key={tag}
                        className="chip"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        )}
      </div>
    </main>
  );
}
