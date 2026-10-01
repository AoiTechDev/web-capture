"use client";

import { useId, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { ExternalLink, Trash, X } from "lucide-react";
import { api } from "../../../../packages/backend/convex/_generated/api";
import type { Id } from "../../../../packages/backend/convex/_generated/dataModel";
import { addTags, MAX_USER_TAGS, removeTag } from "@/lib/tags";
import { useRemovedCapturesStore } from "@/store/removed-captures-store";

/** The open capture as the panel shows it: the live document where it has loaded. */
export type CaptureInfo = {
  id: string;
  title: string | null;
  pageUrl: string | null;
  aiDescription: string | null;
  aiCategory: string | null;
  aiTags: string[];
  tags: string[];
  sessionId: string | null;
  sessionName: string | null;
};

function Section({ title, children, htmlFor }: { title: string; children: ReactNode; htmlFor?: string }) {
  const heading = "mb-2 block text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--text-subtle)]";
  return (
    <section className="border-t border-[var(--border)] px-4 py-3 first:border-t-0">
      {htmlFor ? (
        <label htmlFor={htmlFor} className={heading}>
          {title}
        </label>
      ) : (
        <h3 className={heading}>{title}</h3>
      )}
      {children}
    </section>
  );
}

/** Only web pages get a link; anything else (javascript:, data:) is shown as text. */
function safeHttpUrl(raw: string | null): URL | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** The user's tags, as removable chips plus a field with suggestions from their other tags. */
function TagEditor({ captureId, tags }: { captureId: string; tags: string[] }) {
  const setCaptureTags = useMutation(api.captures.setCaptureTags);
  const known = useQuery(api.captures.listTags);
  const [draft, setDraft] = useState("");
  // Shown until the live document catches up with the save.
  const [pending, setPending] = useState<readonly string[] | null>(null);
  const [error, setError] = useState(false);
  const listId = useId();
  const inputId = useId();
  const shown = pending ?? tags;
  const full = shown.length >= MAX_USER_TAGS;

  const save = async (next: readonly string[]) => {
    if (next === shown) return;
    setPending(next);
    setError(false);
    try {
      await setCaptureTags({ captureId: captureId as Id<"captures">, tags: [...next] });
    } catch (err) {
      console.error("Failed to save tags:", err);
      setError(true);
    } finally {
      setPending(null);
    }
  };

  const commit = () => {
    const next = addTags(shown, draft);
    setDraft("");
    void save(next);
  };

  const suggestions = (known ?? []).map((t) => t.name).filter((n) => !shown.includes(n)).slice(0, 50);

  return (
    <Section title="Tags" htmlFor={inputId}>
      {shown.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1">
          {shown.map((tag) => (
            <li key={tag} className="chip pr-1 text-[var(--text)]">
              {tag}
              <button
                type="button"
                aria-label={`Remove tag ${tag}`}
                className="rounded-[3px] p-0.5 text-[var(--text-subtle)] transition-colors hover:text-[var(--text)]"
                onClick={() => void save(removeTag(shown, tag))}
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        id={inputId}
        list={listId}
        className="input-field"
        value={draft}
        disabled={full}
        maxLength={200}
        placeholder={full ? `${MAX_USER_TAGS} tags at most` : "Add a tag and press Enter"}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit();
          }
        }}
        onBlur={() => {
          if (draft.trim()) commit();
        }}
      />
      <datalist id={listId}>
        {suggestions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      {error && <p className="mt-1.5 text-[12px] text-[var(--danger)]">Couldn&apos;t save the tags. Try again.</p>}
    </Section>
  );
}

/** Moves the capture to another of the user's sessions, or out of any. */
function SessionPicker({ info }: { info: CaptureInfo }) {
  const sessions = useQuery(api.sessions.listSessions, { limit: 100, thumbsPerSession: 0 });
  const setCaptureSession = useMutation(api.sessions.setCaptureSession);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const selectId = useId();
  const list = sessions?.sessions ?? [];
  // A session beyond the listed 100 still shows as the current choice.
  const missing = info.sessionId && !list.some((s) => s.id === info.sessionId);

  return (
    <Section title="Session" htmlFor={selectId}>
      <select
        id={selectId}
        className="input-field"
        value={info.sessionId ?? ""}
        disabled={saving || !sessions}
        onChange={async (e) => {
          setSaving(true);
          setError(false);
          try {
            await setCaptureSession({
              captureId: info.id as Id<"captures">,
              sessionId: (e.target.value || null) as Id<"sessions"> | null,
            });
          } catch (err) {
            console.error("Failed to move capture:", err);
            setError(true);
          } finally {
            setSaving(false);
          }
        }}
      >
        <option value="">No session</option>
        {missing && <option value={info.sessionId!}>{info.sessionName ?? "Current session"}</option>}
        {list.map((s) => (
          <option key={s.id} value={s.id}>
            {s.displayName}
          </option>
        ))}
      </select>
      {error && <p className="mt-1.5 text-[12px] text-[var(--danger)]">Couldn&apos;t move the capture. Try again.</p>}
    </Section>
  );
}

/** Delete, behind a second click. */
function DeleteCapture({ captureId, onDeleted }: { captureId: string; onDeleted: () => void }) {
  const deleteById = useMutation(api.upload.deleteById);
  const markRemoved = useRemovedCapturesStore((s) => s.markRemoved);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        className="btn-secondary w-full hover:border-[var(--danger)] hover:text-[var(--danger)]"
        onClick={() => setConfirming(true)}
      >
        <Trash className="h-3.5 w-3.5" />
        Delete capture
      </button>
    );
  }
  return (
    <div role="group" aria-label="Confirm delete">
      <p className="mb-2 text-[12px] text-[var(--text-muted)]">Delete this capture for good?</p>
      <div className="flex gap-2">
        <button
          type="button"
          autoFocus
          disabled={busy}
          className="btn-secondary flex-1 border-[var(--danger)] text-[var(--danger)]"
          onClick={async () => {
            setBusy(true);
            setError(false);
            try {
              // The server deletes the capture's own files; it never takes a storage id from the client.
              await deleteById({ docId: captureId as Id<"captures"> });
              markRemoved(captureId);
              onDeleted();
            } catch (err) {
              console.error("Failed to delete capture:", err);
              setError(true);
              setBusy(false);
            }
          }}
        >
          {busy ? "Deleting…" : "Delete"}
        </button>
        <button type="button" className="btn-secondary flex-1" disabled={busy} onClick={() => setConfirming(false)}>
          Cancel
        </button>
      </div>
      {error && <p className="mt-1.5 text-[12px] text-[var(--danger)]">Couldn&apos;t delete. Try again.</p>}
    </div>
  );
}

/** The detail view's capture panel: description, source, tags, session and delete. */
export default function CaptureInfoPanel({ info, onDeleted }: { info: CaptureInfo; onDeleted: () => void }) {
  const source = safeHttpUrl(info.pageUrl);
  const host = source?.hostname.replace(/^www\./, "") ?? null;
  const labels = [
    ...(info.aiCategory && info.aiCategory !== "other" ? [info.aiCategory] : []),
    ...info.aiTags.filter((t) => t !== info.aiCategory),
  ];

  return (
    <>
      <section className="px-4 py-3">
        <h2 className="text-[13px] font-medium text-[var(--text)]">{info.title || host || "Capture"}</h2>
        {source ? (
          <a
            href={source.href}
            target="_blank"
            rel="noopener noreferrer"
            className="mono mt-1 inline-flex max-w-full items-center gap-1 text-[11px] text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
          >
            <span className="truncate">{host}</span>
            <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="sr-only">(opens the source page in a new tab)</span>
          </a>
        ) : (
          info.pageUrl && <p className="mono mt-1 truncate text-[11px] text-[var(--text-muted)]">{info.pageUrl}</p>
        )}
        {info.aiDescription && (
          <p className="mt-2 text-[12px] leading-relaxed text-[var(--text-muted)]">{info.aiDescription}</p>
        )}
        {labels.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1" aria-label="AI labels">
            {labels.map((l) => (
              <span key={l} className="chip">
                {l}
              </span>
            ))}
          </div>
        )}
      </section>

      <TagEditor captureId={info.id} tags={info.tags} />
      <SessionPicker info={info} />

      <section className="border-t border-[var(--border)] px-4 py-3">
        <DeleteCapture captureId={info.id} onDeleted={onDeleted} />
      </section>
    </>
  );
}
