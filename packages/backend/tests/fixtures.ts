/// <reference types="vite/client" />
import type { Id } from "../convex/_generated/dataModel";
import { makeT, userA, userB } from "./setup";

export type T = ReturnType<typeof makeT>;

export const vec = (n: number, fill = 0.1) => Array.from({ length: n }, () => fill);

export async function storeBlob(t: T, text = "png-bytes"): Promise<Id<"_storage">> {
  return await t.run((ctx) => ctx.storage.store(new Blob([text])));
}

export async function storageExists(t: T, id: Id<"_storage">): Promise<boolean> {
  return await t.run(async (ctx) => (await ctx.storage.getUrl(id)) !== null);
}

/**
 * Seed one user's world: a session, a link preview, a link capture pointing at
 * it, and a screenshot capture with its own stored file, all in the session.
 */
export async function seedUser(t: T, userId: string, tag = userId) {
  const storageId = await storeBlob(t, `file-of-${tag}`);
  return await t.run(async (ctx) => {
    const sessionId = await ctx.db.insert("sessions", {
      userId,
      startedAt: 1,
      lastCaptureAt: 1,
      itemCount: 2,
      domains: [],
      tags: [],
    });
    const previewId = await ctx.db.insert("link_previews", {
      userId,
      canonicalUrl: `https://example.com/${tag}`,
      originalUrl: `https://example.com/${tag}`,
      domain: "example.com",
      title: `secret-title-${tag}`,
      description: `secret-desc-${tag}`,
      createdAt: 1,
      updatedAt: 1,
    });
    const linkId = await ctx.db.insert("captures", {
      kind: "link",
      href: `https://example.com/${tag}`,
      url: "https://page.example",
      timestamp: 1,
      category: "unsorted",
      userId,
      sessionId,
      linkPreviewId: previewId,
      title: `link-${tag}`,
    });
    const shotId = await ctx.db.insert("captures", {
      kind: "screenshot",
      url: "https://page.example",
      timestamp: 2,
      storageId,
      category: "unsorted",
      userId,
      sessionId,
      localEmbedding: vec(512),
    });
    return { sessionId, previewId, linkId, shotId, storageId };
  });
}

export async function seedAB(t: T) {
  const a = await seedUser(t, userA.subject, "A");
  const b = await seedUser(t, userB.subject, "B");
  return { a, b };
}

export { makeT, userA, userB };
