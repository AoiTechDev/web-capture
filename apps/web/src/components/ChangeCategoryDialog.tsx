"use client";

import { useEffect, useMemo, useState } from "react";
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
      // Ensure category exists
      await createCategory({ name });
      // Reassign
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
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-md glass-card border border-gray-800 rounded-2xl p-6">
        <h2 className="text-lg font-semibold mb-4">Change category</h2>

        <div className="space-y-3">
          <input
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-500"
            placeholder="Type a category or pick below"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />

          <div className="flex flex-wrap gap-2 max-h-40 overflow-auto">
            {suggestions.map((c) => (
              <button
                key={String(c._id)}
                onClick={() => setInput(c.name)}
                className={`px-3 py-1 rounded-full text-xs border ${
                  input.trim() === c.name
                    ? "bg-cyan-600 text-white border-cyan-600"
                    : "bg-white/10 text-gray-300 border-gray-700 hover:bg-white/15"
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            className="px-4 py-2 rounded-lg text-sm bg-white/10 text-gray-300 hover:bg-white/15 border border-gray-700"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            className="px-4 py-2 rounded-lg text-sm bg-gradient-to-r from-cyan-500 to-purple-600 text-white disabled:opacity-60"
            onClick={onConfirm}
            disabled={saving || !input.trim()}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}


