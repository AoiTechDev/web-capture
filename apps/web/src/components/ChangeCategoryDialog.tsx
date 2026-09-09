"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../packages/backend/convex/_generated/api";
import { Id } from "../../../../packages/backend/convex/_generated/dataModel";

type Props = {
  open: boolean;
  onClose: () => void;
  captureId: string | null;
};

export default function ChangeCategoryDialog({ open, onClose, captureId }: Props) {
  const categories = useQuery(api.captures.listCategories);
  const createCategory = useMutation(api.upload.createCategory);
  const reassign = useMutation(api.upload.reassignCaptureCategory);

  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setInput("");
  }, [open]);

  const suggestions = useMemo(() => categories ?? [], [categories]);

  if (!open) return null;

  const onConfirm = async () => {
    if (!captureId) return;
    const name = input.trim();
    if (!name) return;
    setSaving(true);
    try {
      await createCategory({ name });
      await reassign({
        docId: captureId as unknown as Id<"captures">,
        newCategory: name,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-[rgba(8,9,10,0.85)] backdrop-blur-sm"
        onClick={onClose}
      />

      <div
        className="relative w-full max-w-md overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl"
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start justify-between border-b border-[var(--border)] px-5 py-4">
          <div>
            <h2 className="text-[14px] font-semibold text-[var(--text)]">
              Change category
            </h2>
            <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">
              Moves 1 capture out of unsorted.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border-strong)] text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="px-5 py-4">
          <input
            autoFocus
            className="input-field"
            placeholder="Category name"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && input.trim()) void onConfirm();
              if (e.key === "Escape") onClose();
            }}
          />

          {suggestions.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--text-subtle)]">
                Suggestions
              </h3>
              {/* A list, not chips: these carry counts, and counts want a
                  right-aligned column to scan down. */}
              <div className="max-h-52 overflow-y-auto">
                {suggestions.map((c: { _id: string; name: string; count?: number }) => {
                  const active = input.trim() === c.name;
                  return (
                    <button
                      key={String(c._id)}
                      onClick={() => setInput(c.name)}
                      className={`flex h-8 w-full items-center justify-between rounded-md px-2.5 text-[13px] transition-colors ${
                        active
                          ? "bg-[var(--surface-hover)] text-[var(--text)]"
                          : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                      }`}
                    >
                      <span className="truncate">{c.name}</span>
                      {typeof c.count === "number" && (
                        <span className="text-[11px] tabular-nums text-[var(--text-subtle)]">
                          {c.count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-5 py-4">
          <button className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="btn-primary disabled:opacity-50"
            onClick={onConfirm}
            disabled={saving || !input.trim()}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
