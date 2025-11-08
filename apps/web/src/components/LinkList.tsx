import { useMemo } from "react"
import Image from "next/image"
import LinkPreviewHover from "./LinkPreviewHover"
import { TooltipProvider } from "@/components/ui/tooltip"

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
  modifiedDate?: string
  keywords?: string[]
  themeColor?: string
  articleSection?: string
  articleTag?: string[]
  videoDuration?: string
  videoUrl?: string
  productPrice?: string
  productCurrency?: string
  productAvailability?: string
  productRating?: string
  twitterCard?: string
  twitterSite?: string
  twitterCreator?: string
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

interface LinkListProps {
  items: LinkItem[]
}

export default function LinkList({ items }: LinkListProps) {
  const safeItems = useMemo(() => items ?? [], [items])
  
  const formatHostname = (href?: string) => {
    try {
      if (!href) return ""
      const u = new URL(href)
      return u.hostname.replace(/^www\./, "")
    } catch {
      return href || ""
    }
  }

  const getTitle = (item: LinkItem) => {
    return item.preview?.title || item.title || item.text || formatHostname(item.href)
  }

  const getDescription = (item: LinkItem) => {
    return item.preview?.description || ""
  }

  const getDomain = (item: LinkItem) => {
    return item.preview?.domain || formatHostname(item.href)
  }

  if (safeItems.length === 0) {
    return <div className="text-center text-gray-500 py-8">No link captures</div>
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="w-full">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
          {safeItems.map((item) => (
            <LinkPreviewHover key={item._id} item={item}>
              <a
                href={item.href}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl shadow-md overflow-hidden group duration-100 bg-slate-900/60 border border-gray-800 hover:border-cyan-700/50 hover:shadow-cyan-700/10 flex flex-col"
              >
                <div className="p-3 flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    {item.preview?.faviconUrl && (
                      <Image
                        src={item.preview.faviconUrl}
                        alt=""
                        width={14}
                        height={14}
                        className="rounded"
                        unoptimized
                      />
                    )}
                    <span className="truncate">{getDomain(item)}</span>
                  </div>
                  <div className="text-sm font-semibold text-gray-100 line-clamp-2">
                    {getTitle(item)}
                  </div>
                  {getDescription(item) && (
                    <div className="text-xs text-gray-400 line-clamp-2">
                      {getDescription(item)}
                    </div>
                  )}
                  {item.tags && item.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {item.tags.slice(0, 3).map((tag, i) => (
                        <span
                          key={i}
                          className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-900/30 text-cyan-300"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </a>
            </LinkPreviewHover>
          ))}
        </div>
      </div>
    </TooltipProvider>
  )
}


