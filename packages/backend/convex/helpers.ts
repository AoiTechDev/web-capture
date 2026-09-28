import { type Infer } from "convex/values";
import { captureValidator } from "./schema";

export type Capture = Infer<typeof captureValidator>;

/* ---------- local embeddings ---------- */

/** CLIP ViT-B/32 projection size; must match the by_localEmbedding vector index. */
export const LOCAL_EMBEDDING_DIM = 512;

/** Reject a vector the vector index would refuse (or silently mis-score). */
export function assertLocalEmbedding(vector: number[] | undefined, what = "localEmbedding") {
  if (vector === undefined) return;
  if (vector.length !== LOCAL_EMBEDDING_DIM) {
    throw new Error(`${what} must have ${LOCAL_EMBEDDING_DIM} dimensions, got ${vector.length}`);
  }
}

/* ---------- outbound fetches ---------- */

function isPrivateIPv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 0 || // "this" network
    a === 10 ||
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, incl. cloud metadata endpoints
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 192 && b === 0 && Number(m[3]) === 0) || // IETF protocol assignments
    a >= 224 // multicast and reserved
  );
}

function isPrivateIPv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (!h.includes(":")) return false;
  if (h === "::" || h === "::1") return true;
  if (/^f[cd][0-9a-f]{0,2}:/.test(h)) return true; // unique local fc00::/7
  if (/^fe[89ab][0-9a-f]?:/.test(h)) return true; // link-local fe80::/10
  // 6to4 (2002:AABB:CCDD::/48) carries an IPv4 address in its second and third groups.
  const sixToFour = h.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4})(?::|$)/);
  if (sixToFour) {
    const hi = parseInt(sixToFour[1]!, 16);
    const lo = parseInt(sixToFour[2]!, 16);
    return isPrivateIPv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  // An IPv4 address embedded in IPv6: mapped (::ffff:), the deprecated
  // compatible form (::a.b.c.d) and NAT64 (64:ff9b::), written either dotted
  // or as the two hex groups the URL parser normalises it to.
  const mapped = h.match(/^(?:::ffff:|64:ff9b::|::)([0-9a-f.]+(?::[0-9a-f]+)?)$/);
  if (mapped) {
    const rest = mapped[1]!;
    if (rest.includes(".")) return isPrivateIPv4(rest);
    const parts = rest.split(":");
    if (parts.length === 2) {
      const hi = parseInt(parts[0]!, 16);
      const lo = parseInt(parts[1]!, 16);
      return isPrivateIPv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
  }
  return false;
}

/**
 * Whether the server may fetch this URL on a user's behalf.
 *
 * Only plain http(s), and never a loopback, private or link-local address
 * written as a literal. This cannot see what a public hostname resolves to (no
 * DNS API here), so it stops the obvious SSRF targets rather than all of them.
 */
export function isFetchableUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  // "localhost." is a valid spelling of "localhost"; drop the root dot first.
  const host = u.hostname.toLowerCase().replace(/\.+$/, "");
  if (!host) return false;
  if (
    host === "localhost" ||
    /\.(localhost|local|internal|home\.arpa)$/.test(host) ||
    host === "internal" ||
    host === "home.arpa"
  ) {
    return false;
  }
  return !isPrivateIPv4(host) && !isPrivateIPv6(host);
}

export type LimitedFetchResult = {
  status?: number;
  finalUrl: string;
  contentType: string;
  body: string;
};

/**
 * GET a page for metadata extraction, bounded in time, size and destination.
 *
 * Redirects are followed by hand so every hop is re-checked with
 * `isFetchableUrl`; letting fetch follow them would allow a public URL to
 * bounce the request to an internal address. The body is read incrementally
 * and cut off at `maxBytes`, since a page's <head> is all that is needed.
 */
export async function fetchTextLimited(
  url: string,
  { timeoutMs = 8000, maxBytes = 1_000_000, maxRedirects = 5 } = {}
): Promise<LimitedFetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let current = url;
    for (let hop = 0; hop <= maxRedirects; hop++) {
      if (!isFetchableUrl(current)) throw new Error("URL not allowed");
      const resp: Response = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
      });
      const location = resp.headers.get("location");
      if (resp.status >= 300 && resp.status < 400 && location) {
        current = new URL(location, current).toString();
        resp.body?.cancel().catch(() => {});
        continue;
      }
      const contentType = resp.headers.get("content-type") || "";
      let body = "";
      if (contentType.includes("text/html") && resp.body) {
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let received = 0;
        while (received < maxBytes) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = value.byteLength > maxBytes - received
            ? value.subarray(0, maxBytes - received)
            : value;
          received += chunk.byteLength;
          body += decoder.decode(chunk, { stream: true });
        }
        body += decoder.decode();
        reader.cancel().catch(() => {});
      } else {
        resp.body?.cancel().catch(() => {});
      }
      return { status: resp.status, finalUrl: current, contentType, body };
    }
    throw new Error("Too many redirects");
  } finally {
    clearTimeout(timer);
  }
}
