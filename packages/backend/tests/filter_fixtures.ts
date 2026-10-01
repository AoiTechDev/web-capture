/**
 * Seeding helpers for the search / browse filter tests. Rows carry
 * searchText (convex-test's search index needs it) and are inserted in
 * order, so `_creationTime` increases with each call.
 */
import type { Id } from "../convex/_generated/dataModel";
import type { AiCategory } from "../convex/schema";
import { hexToLab, type Lab } from "../convex/lib/color";
import { buildSearchText } from "../convex/lib/search_rank";
import { DIM, type T } from "./fixtures";

/** Unit vector along axis `i`. */
export const axis = (i: number) => Array.from({ length: DIM }, (_, j) => (j === i ? 1 : 0));
/** Unit vector whose cosine with axis(0) is exactly `c`. */
export const atCosine = (c: number) =>
  Array.from({ length: DIM }, (_, j) => (j === 0 ? c : j === 1 ? Math.sqrt(1 - c * c) : 0));

export async function addSession(t: T, userId: string, name?: string): Promise<Id<"sessions">> {
  return await t.run((ctx) =>
    ctx.db.insert("sessions", {
      userId,
      ...(name ? { name } : {}),
      startedAt: 1,
      lastCaptureAt: 1,
      itemCount: 0,
      domains: [],
      tags: [],
    })
  );
}

export type CaptureOpts = {
  kind?: "viewport" | "text" | "link";
  title?: string;
  sessionId?: Id<"sessions">;
  aiCategory?: AiCategory;
  tags?: string[];
  localEmbedding?: number[];
  textEmbedding?: number[];
};

export async function addCapture(t: T, userId: string, o: CaptureOpts = {}): Promise<Id<"captures">> {
  return await t.run(async (ctx) => {
    const kind = o.kind ?? "viewport";
    const common = {
      url: "https://page.example",
      timestamp: 1,
      userId,
      ...(o.title ? { title: o.title } : {}),
      ...(o.sessionId ? { sessionId: o.sessionId } : {}),
      ...(o.aiCategory ? { aiCategory: o.aiCategory } : {}),
      ...(o.tags ? { tags: o.tags } : {}),
      searchText: buildSearchText({ url: "https://page.example", title: o.title, tags: o.tags, aiCategory: o.aiCategory }),
    };
    if (kind === "text") {
      return await ctx.db.insert("captures", {
        kind: "text",
        content: o.title ?? "x",
        ...common,
        ...(o.textEmbedding ? { textEmbedding: o.textEmbedding } : {}),
      });
    }
    if (kind === "link") {
      return await ctx.db.insert("captures", { kind: "link", href: "https://example.com", ...common });
    }
    return await ctx.db.insert("captures", {
      kind: "viewport",
      storageId: await ctx.storage.store(new Blob(["x"])),
      width: 1,
      height: 1,
      ...common,
      ...(o.localEmbedding ? { localEmbedding: o.localEmbedding } : {}),
    });
  });
}

/** One captureColors row; `color` is a hex or a raw LAB triple. */
export async function addColor(
  t: T,
  captureId: Id<"captures">,
  userId: string,
  color: string | Lab,
  weight = 0.5
) {
  const lab = typeof color === "string" ? hexToLab(color)! : color;
  const hex = typeof color === "string" ? color : "#000000";
  return await t.run((ctx) =>
    ctx.db.insert("captureColors", { captureId, userId, hex, l: lab[0], a: lab[1], b: lab[2], weight })
  );
}

export async function creationTime(t: T, id: Id<"captures">): Promise<number> {
  return await t.run(async (ctx) => (await ctx.db.get(id))!._creationTime);
}
