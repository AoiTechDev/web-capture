"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useMutation, useQuery } from "convex/react";
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
          className="flex-1 min-w-0 bg-transparent border-b border-cyan-400/50 text-white text-sm outline-none pb-0.5"
        />
        <button onClick={() => void commit()} className="p-1 text-cyan-400 hover:text-cyan-300">
          <Check size={14} />
        </button>
        <button onClick={() => setEditing(false)} className="p-1 text-gray-500 hover:text-gray-300">
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 group/title">
      <h3 className="font-medium text-white truncate">{session.displayName}</h3>
      <button
        onClick={(e) => {
          e.preventDefault();
          // Seed with the user's own name, never the generated one - prefilling
          // a derived string just gets it accepted verbatim.
          setDraft(session.name ?? "");
          setEditing(true);
        }}
        className="opacity-0 group-hover/title:opacity-100 transition-opacity text-gray-500 hover:text-white shrink-0"
        title="Rename session"
      >
        <Pencil size={12} />
      </button>
    </div>
  );
};

export default function SessionsPage() {
  const data = useQuery(api.sessions.listSessions, { limit: 50, thumbsPerSession: 5 });
  const sessions = (data?.sessions ?? []) as SessionCard[];

  return (
    <main className="flex-1 flex flex-col w-full overflow-y-auto">
      <header className="p-6 border-b border-gray-800">
        <h1 className="text-xl font-semibold">Sessions</h1>
        <p className="text-sm text-gray-400 mt-1">
          Start a session from the extension to group what you capture. Anything
          saved outside one lands in All Captures.
        </p>
      </header>

      <div className="p-6">
        {data === undefined && <p className="text-gray-500 text-sm">Loading…</p>}

        {data !== undefined && sessions.length === 0 && (
          <div className="text-center py-20">
            <p className="text-gray-300 mb-2">No sessions yet</p>
            <p className="text-sm text-gray-500 max-w-md mx-auto">
              Open the extension popup and hit <strong>Start a session</strong>.
              Everything you capture until you finish it is grouped here.
            </p>
          </div>
        )}

        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {sessions.map((session) => (
            <div
              key={session.id}
              className="group glass-card border border-gray-800 rounded-xl overflow-hidden hover:border-cyan-400/40 transition-colors"
            >
              <Link href={`/dashboard/sessions/${session.id}`} className="block">
                <div className="flex gap-0.5 h-28 bg-gray-900">
                  {session.thumbnails.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center text-gray-600 text-xs">
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
                      className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0 animate-pulse"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <SessionTitle session={session} />
                  </div>
                </div>

                <p className="text-xs text-gray-500 mt-1">
                  {formatDay(session.startedAt)} · {session.itemCount} item
                  {session.itemCount === 1 ? "" : "s"} ·{" "}
                  {formatDuration(session.startedAt, session.lastCaptureAt)}
                </p>

                {session.domains.length > 0 && (
                  <p className="text-xs text-gray-600 mt-1 truncate">
                    {session.domains.slice(0, 3).join(", ")}
                  </p>
                )}

                {session.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-3">
                    {session.tags.slice(0, 5).map((tag) => (
                      <span
                        key={tag}
                        className="text-[10px] bg-gray-800 text-gray-300 rounded-full px-2 py-0.5"
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

      </div>
    </main>
  );
}
