/** Convex wraps server errors in "[CONVEX ...] Uncaught Error: ..."; keep the reason. */
export function convexErrorMessage(e: unknown, fallback: string): string {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  const m = /Uncaught Error:\s*([^\n]+)/.exec(raw);
  return (m ? m[1] : raw.split("\n")[0]).trim() || fallback;
}
