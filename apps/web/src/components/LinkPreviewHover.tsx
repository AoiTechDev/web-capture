"use client"
import Image from "next/image"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

type LinkPreview = {
  _id: string
  canonicalUrl: string
  originalUrl: string
  domain: string
  siteName?: string
  faviconUrl?: string
  title?: string
  description?: string
  imageUrl?: string
  contentType?: string
  status?: number
  author?: string
  publishedDate?: string
  keywords?: string[]
}

type LinkItem = {
  _id: string
  kind: "link"
  href: string
  text?: string
  url: string
  title?: string
  timestamp: number
  category?: string
  tags?: string[]
  note?: string
  preview?: LinkPreview
}

interface LinkPreviewHoverProps {
  item: LinkItem
  children: React.ReactNode
}

export default function LinkPreviewHover({
  item,
  children,
}: LinkPreviewHoverProps) {
  const preview = item.preview

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return null
    try {
      const d = new Date(dateStr)
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    } catch {
      return null
    }
  }

  const formatTimestamp = (ts: number) => {
    const d = new Date(ts)
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
  }

  const getDomain = () => {
    return preview?.domain || new URL(item.href).hostname.replace(/^www\./, "")
  }

  const getTitle = () => {
    return preview?.title || item.title || item.text || item.href
  }

  
  const hasPreviewData =
    preview &&
    (preview.description ||
      preview.imageUrl ||
      preview.contentType ||
      preview.author ||
      preview.publishedDate ||
      preview.keywords)

  if (!hasPreviewData) {
    return <>{children}</>
  }

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        {children}
      </TooltipTrigger>
      <TooltipContent
        side="right"
        align="start"
        className="w-[420px] bg-[var(--surface)] border-[var(--border-strong)] shadow-2xl shadow-cyan-900/20 p-4"
        sideOffset={12}
      >
        {/* Header */}
        <div className="flex items-start gap-3 mb-3 pb-3 border-b border-[var(--border-strong)]">
          {preview.imageUrl && (
            <div className="relative w-24 h-24 flex-shrink-0 rounded-lg overflow-hidden bg-[var(--surface)]">
              <Image
                src={preview.imageUrl}
                alt={getTitle()}
                fill
                className="object-cover"
                unoptimized
              />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] mb-1">
              {preview.faviconUrl && (
                <Image
                  src={preview.faviconUrl}
                  alt=""
                  width={14}
                  height={14}
                  className="rounded"
                  unoptimized
                />
              )}
              <span className="truncate">{preview.siteName || getDomain()}</span>
            </div>
            <h3 className="text-sm font-semibold text-[var(--text)] line-clamp-2 mb-1">{getTitle()}</h3>
            {preview.description && (
              <p className="text-xs text-[var(--text-muted)] line-clamp-3">{preview.description}</p>
            )}
          </div>
        </div>

        {/* Metadata Grid */}
        <div className="space-y-2 text-xs">
          {/* Content Type */}
          {preview.contentType && (
            <div className="flex items-center gap-2">
              <span className="text-[var(--text-subtle)] w-20 flex-shrink-0">Type:</span>
              <span className="chip uppercase">
                {preview.contentType}
              </span>
            </div>
          )}

          {/* Author */}
          {preview.author && (
            <div className="flex items-start gap-2">
              <span className="text-[var(--text-subtle)] w-20 flex-shrink-0">Author:</span>
              <span className="text-[var(--text-muted)]">{preview.author}</span>
            </div>
          )}

          {/* Published Date */}
          {preview.publishedDate && (
            <div className="flex items-start gap-2">
              <span className="text-[var(--text-subtle)] w-20 flex-shrink-0">Published:</span>
              <span className="text-[var(--text-muted)]">{formatDate(preview.publishedDate)}</span>
            </div>
          )}

          {/* Keywords */}
          {preview.keywords && preview.keywords.length > 0 && (
            <div className="flex items-start gap-2">
              <span className="text-[var(--text-subtle)] w-20 flex-shrink-0">Keywords:</span>
              <div className="flex flex-wrap gap-1">
                {preview.keywords.slice(0, 6).map((kw, i) => (
                  <span
                    key={i}
                    className="chip"
                  >
                    {kw}
                  </span>
                ))}
                {preview.keywords.length > 6 && (
                  <span className="text-[var(--text-subtle)] text-[10px]">
                    +{preview.keywords.length - 6}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-3 pt-3 border-t border-[var(--border-strong)] flex items-center justify-between text-[10px] text-[var(--text-subtle)]">
          <span>Saved {formatTimestamp(item.timestamp)}</span>
          {preview.status && (
            <span
              className={`px-2 py-0.5 rounded ${
                preview.status === 200
                  ? "bg-green-900/30 text-[var(--success)]"
                  : "bg-red-900/30 text-red-400"
              }`}
            >
              {preview.status === 200 ? "✓ Active" : `⚠ ${preview.status}`}
            </span>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

