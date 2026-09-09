"use client";
import { useQuery } from "convex/react";
import { api } from "../../../../packages/backend/convex/_generated/api";
import { useSelectedCategoryStore } from "@/store/selected-category-store";
import { SignedIn, UserButton, useUser } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** Initials fallback for the avatar slot while Clerk's image loads. */
function initials(name?: string | null, email?: string | null): string {
  const source = name?.trim() || email?.split("@")[0] || "";
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

const NavRow = ({
  href,
  active,
  icon,
  label,
  trailing,
}: {
  href: string;
  active: boolean;
  icon: React.ReactNode;
  label: string;
  trailing?: React.ReactNode;
}) => (
  <Link
    href={href}
    className={`relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors ${
      active
        ? "bg-[var(--surface-hover)] text-[var(--text)]"
        : "text-[var(--text-muted)] hover:bg-[var(--surface)] hover:text-[var(--text)]"
    }`}
  >
    {/* Active rows get a 2px accent rule rather than a filled or gradient pill. */}
    {active && (
      <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r bg-[var(--blue-500)]" />
    )}
    <span className="flex w-4 justify-center text-[var(--text-subtle)]">{icon}</span>
    <span className="flex-1 truncate">{label}</span>
    {trailing}
  </Link>
);

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <h3 className="mb-2 px-2.5 text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--text-subtle)]">
    {children}
  </h3>
);

const Sidebar = () => {
  const categories = useQuery(api.captures.listCategories);
  const tags = useQuery(api.captures.listTags);
  const sessions = useQuery(api.sessions.listSessions, { limit: 100, thumbsPerSession: 0 });
  const { selected, setSelected } = useSelectedCategoryStore();
  const { user } = useUser();
  const pathname = usePathname();

  const sessionList = sessions?.sessions ?? [];
  const isRecording = sessionList.some((s: { running: boolean }) => s.running);

  return (
    <aside className="flex w-[240px] flex-col border-r border-[var(--border)] bg-[var(--surface)]">
      {/* Brand */}
      <div className="flex h-14 items-center border-b border-[var(--border)] px-4">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex h-5 w-5 items-center justify-center rounded-[5px] bg-[var(--blue-500)]">
            <span className="h-1.5 w-1.5 rounded-[1px] bg-white" />
          </span>
          <span className="text-[13px] font-semibold text-[var(--text)]">Web Capture</span>
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        <div className="mb-6">
          <SectionLabel>Browse</SectionLabel>
          <div className="space-y-0.5">
            <NavRow
              href="/dashboard"
              active={pathname === "/dashboard"}
              label="All Captures"
              icon={
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="2" y="2" width="12" height="12" rx="2" />
                </svg>
              }
            />
            <NavRow
              href="/dashboard/sessions"
              active={pathname?.startsWith("/dashboard/sessions") ?? false}
              label="Sessions"
              icon={
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="8" cy="8" r="6" />
                </svg>
              }
              trailing={
                <span className="flex items-center gap-1.5">
                  {isRecording && <span className="recording-dot" />}
                  <span className="text-[11px] tabular-nums text-[var(--text-subtle)]">
                    {sessionList.length || ""}
                  </span>
                </span>
              }
            />
          </div>
        </div>

        {tags && tags.length > 0 && (
          <div className="mb-6">
            <SectionLabel>Tags</SectionLabel>
            <div className="flex flex-wrap gap-1.5 px-2.5">
              {tags.map((t: { name: string; useCount?: number }) => (
                <button key={t.name} className="chip transition-colors hover:text-[var(--text)]">
                  {t.name}
                  {typeof t.useCount === "number" && (
                    <span className="chip-count">{t.useCount}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Categories predate Sessions and are kept only for existing data, so
            they sit below the fold under a label that says as much. */}
        {categories && categories.length > 0 && (
          <div>
            <SectionLabel>Legacy</SectionLabel>
            <button
              onClick={() => setSelected("unsorted")}
              className={`flex h-8 w-full items-center justify-between rounded-md px-2.5 text-[13px] transition-colors ${
                selected === "unsorted"
                  ? "text-[var(--text)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              <span>Categories</span>
              <span className="text-[11px] tabular-nums text-[var(--text-subtle)]">
                {categories.length}
              </span>
            </button>
            <div className="mt-0.5 space-y-0.5">
              {categories
                .filter((c: { name: string }) => c.name !== "unsorted")
                .map((c: { _id: string; name: string }) => (
                  <button
                    key={c._id}
                    onClick={() => setSelected(c.name)}
                    className={`flex h-7 w-full items-center rounded-md pl-5 pr-2.5 text-[12px] transition-colors ${
                      selected === c.name
                        ? "bg-[var(--surface-hover)] text-[var(--text)]"
                        : "text-[var(--text-muted)] hover:text-[var(--text)]"
                    }`}
                  >
                    <span className="truncate">{c.name}</span>
                  </button>
                ))}
            </div>
          </div>
        )}
      </div>

      <SignedIn>
        <div className="flex items-center gap-2.5 border-t border-[var(--border)] px-4 py-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--surface-hover)] text-[10px] font-medium text-[var(--text-muted)]">
            {user?.imageUrl ? (
              <UserButton />
            ) : (
              initials(user?.fullName, user?.primaryEmailAddress?.emailAddress)
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-medium text-[var(--text)]">
              {user?.fullName || user?.username || "Account"}
            </div>
            <div className="mono truncate text-[11px] text-[var(--text-subtle)]">
              {user?.primaryEmailAddress?.emailAddress ??
                user?.emailAddresses?.[0]?.emailAddress}
            </div>
          </div>
        </div>
      </SignedIn>
    </aside>
  );
};

export default Sidebar;
