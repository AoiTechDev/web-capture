"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Download } from "lucide-react";
import type { DesignSystemTokens } from "../../../../../packages/backend/convex/lib/design_system/types";
import { EXPORT_FORMATS, type ExportFormat } from "@/lib/design-system/exports";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API refused (permissions, insecure origin): fall back to a hidden textarea.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

function download(filename: string, mime: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a tick to start the download before revoking.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * The three exports (CSS variables, Tailwind v4, Design Tokens JSON) of the
 * tokens currently in the editor, unsaved edits included.
 */
export default function ExportPanel({ tokens }: { tokens: DesignSystemTokens }) {
  const [active, setActive] = useState<ExportFormat>("css");
  const [copied, setCopied] = useState<ExportFormat | "failed" | null>(null);

  const format = EXPORT_FORMATS.find((f) => f.id === active) ?? EXPORT_FORMATS[0];
  const text = useMemo(() => format.build(tokens), [format, tokens]);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(null), 2000);
    return () => window.clearTimeout(t);
  }, [copied]);

  return (
    <section className="surface-card overflow-hidden" aria-labelledby="ds-export-title">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-4 py-3">
        <h2 id="ds-export-title" className="mr-auto text-[13px] font-medium text-[var(--text)]">
          Export
        </h2>
        <div role="tablist" aria-label="Export format" className="flex flex-wrap gap-1">
          {EXPORT_FORMATS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={f.id === active}
              aria-controls="ds-export-code"
              onClick={() => setActive(f.id)}
              className={`h-7 rounded-[var(--radius-sm)] px-2.5 text-[12px] transition-colors ${
                f.id === active
                  ? "bg-[var(--surface-active)] text-[var(--text)]"
                  : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <button
          type="button"
          className="btn-secondary"
          onClick={async () => setCopied((await copyText(text)) ? format.id : "failed")}
        >
          {copied === format.id ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
          {copied === format.id ? "Copied" : "Copy"}
        </button>
        <button type="button" className="btn-secondary" onClick={() => download(format.filename, format.mime, text)}>
          <Download size={14} aria-hidden />
          Download {format.filename.slice(format.filename.lastIndexOf("."))}
        </button>
        <span role="status" aria-live="polite" className="text-[12px] text-[var(--text-subtle)]">
          {copied === "failed" ? "Couldn't copy; select the text below instead." : copied ? `${format.label} copied to the clipboard.` : ""}
        </span>
      </div>

      <pre
        id="ds-export-code"
        role="tabpanel"
        tabIndex={0}
        aria-label={`${format.label} export`}
        className="mono max-h-[360px] overflow-auto border-t border-[var(--border)] bg-[var(--bg)] px-4 py-3 text-[11.5px] leading-[1.6] text-[var(--text-muted)]"
      >
        {text}
      </pre>
    </section>
  );
}
