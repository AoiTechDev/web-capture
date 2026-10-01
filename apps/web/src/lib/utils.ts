import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** A URL's hostname without "www.", for display; the input itself when it does not parse. Never throws. */
export function formatHostname(href?: string | null): string {
  if (!href) return ""
  try {
    return new URL(href).hostname.replace(/^www\./, "")
  } catch {
    return href
  }
}
