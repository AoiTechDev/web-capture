import { v, type Infer } from "convex/values";
import { mutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { captureValidator, designDnaValidator, paletteColorValidator } from "./schema";
import { assertLocalEmbedding } from "./helpers";
import { normalizeCaptureColors } from "./lib/color";

type DesignDna = Infer<typeof designDnaValidator>;
type PaletteColor = Infer<typeof paletteColorValidator>;

/** Caps from spec 6.1 / 6.2, enforced so a client cannot store unbounded arrays. */
const DNA_LIMITS = { colors: 16, fonts: 8, radii: 10, shadows: 10, spacing: 10 } as const;
const MAX_PALETTE = 6;
const MAX_SHADOW_LENGTH = 500;
const HEX_RE = /^#[0-9a-f]{6}$/i;
const MAX_FONT_FAMILY_LENGTH = 200;
const MAX_URL_LENGTH = 4096;
const MAX_TITLE_LENGTH = 1000;

const isWeight = (w: number) => Number.isFinite(w) && w >= 0 && w <= 1;

/** Reject DNA / palette that break the spec's shape limits. */
function assertColorPayload(designDna?: DesignDna, palette?: PaletteColor[]) {
  if (designDna) {
    for (const [key, max] of Object.entries(DNA_LIMITS)) {
      const list = designDna[key as keyof typeof DNA_LIMITS];
      if (list.length > max) throw new Error(`designDna.${key} has more than ${max} entries`);
      if (!list.every((x) => isWeight(x.weight))) throw new Error(`designDna.${key} has an invalid weight`);
    }
    if (!designDna.colors.every((c) => HEX_RE.test(c.hex))) throw new Error("designDna.colors has an invalid hex");
    if (designDna.shadows.some((s) => s.value.length > MAX_SHADOW_LENGTH)) {
      throw new Error("designDna.shadows has an oversized value");
    }
    const finite = (...xs: Array<number | null>) => xs.every((x) => x === null || Number.isFinite(x));
    const fontsOk = designDna.fonts.every(
      (f) =>
        f.family.length <= MAX_FONT_FAMILY_LENGTH &&
        finite(f.size, f.fontWeight, f.lineHeight, f.letterSpacing)
    );
    if (!fontsOk) throw new Error("designDna.fonts has an invalid entry");
    if (!designDna.radii.every((r) => finite(r.value)) || !designDna.spacing.every((x) => finite(x.value))) {
      throw new Error("designDna has a non-finite size");
    }
    const src = designDna.source;
    if (
      src.url.length > MAX_URL_LENGTH ||
      src.title.length > MAX_TITLE_LENGTH ||
      !finite(src.viewport.w, src.viewport.h, src.dpr, src.rect.x, src.rect.y, src.rect.w, src.rect.h)
    ) {
      throw new Error("designDna.source is invalid");
    }
  }
  if (palette) {
    if (palette.length > MAX_PALETTE) throw new Error(`palette has more than ${MAX_PALETTE} entries`);
    for (const p of palette) {
      if (!HEX_RE.test(p.hex) || !isWeight(p.weight)) throw new Error("palette has an invalid entry");
      if (p.lab.length !== 3 || !p.lab.every(Number.isFinite)) throw new Error("palette has an invalid lab value");
    }
  }
}

/** Whether any capture already points at this storage object, as image or thumbnail. */
async function storageInUse(ctx: MutationCtx, id: Id<"_storage">): Promise<boolean> {
  const asImage = await ctx.db
    .query("captures")
    .withIndex("by_storageId", (q) => q.eq("storageId", id))
    .first();
  if (asImage) return true;
  const asThumb = await ctx.db
    .query("captures")
    .withIndex("by_thumbStorageId", (q) => q.eq("thumbStorageId", id))
    .first();
  return asThumb !== null;
}

export const generateUploadUrl = mutation(async (ctx) => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthorized");

  return await ctx.storage.generateUploadUrl();
});

/**
 * Check every reference a client put on a new capture before it is stored.
 *
 * A capture may only point at the caller's own session and link preview, and
 * at a storage object no other capture already owns - otherwise a client could
 * adopt (and later delete) someone else's file by guessing its id.
 */
async function assertCaptureRefs(
  ctx: MutationCtx,
  userId: string,
  refs: {
    sessionId?: Id<"sessions">;
    linkPreviewId?: Id<"link_previews">;
    storageId?: Id<"_storage">;
    thumbStorageId?: Id<"_storage">;
    localEmbedding?: number[];
  }
) {
  if (refs.sessionId) {
    const session = await ctx.db.get(refs.sessionId);
    if (!session || session.userId !== userId) throw new Error("Session not found");
  }
  if (refs.linkPreviewId) {
    const preview = await ctx.db.get(refs.linkPreviewId);
    if (!preview || preview.userId !== userId) throw new Error("Link preview not found");
  }
  if (refs.storageId && (await storageInUse(ctx, refs.storageId))) {
    throw new Error("Storage object already in use");
  }
  if (refs.thumbStorageId) {
    if (refs.thumbStorageId === refs.storageId || (await storageInUse(ctx, refs.thumbStorageId))) {
      throw new Error("Storage object already in use");
    }
  }
  assertLocalEmbedding(refs.localEmbedding);
}

export const uploadCapture = mutation({
  args: v.object({
    capture: captureValidator,
  }),
  handler: async (ctx, { capture }) => {
    const identity = await ctx.auth.getUserIdentity();
    
    if (!identity) throw new Error("Unauthorized");
    // Server-owned fields: whatever the client sent for these is discarded.
    // sessionId is attached by sessions.assignCapture, which also keeps the
    // session's itemCount in step; accepting it here would bypass that count.
    // Image-derived fields (DNA, palette, thumbnail) only come through
    // saveImageCapture, which validates them and indexes the colours.
    const {
      userId: _userId,
      status: _status,
      error: _error,
      sessionId: _sessionId,
      designDna: _designDna,
      palette: _palette,
      thumbStorageId: _thumbStorageId,
      ...rest
    } = capture as typeof capture & {
      designDna?: unknown;
      palette?: unknown;
      thumbStorageId?: unknown;
    };
    const c = rest as {
      linkPreviewId?: Id<"link_previews">;
      storageId?: Id<"_storage">;
      localEmbedding?: number[];
      category?: string;
    };
    await assertCaptureRefs(ctx, identity.subject, {
      linkPreviewId: c.linkPreviewId,
      storageId: c.storageId,
      localEmbedding: c.localEmbedding,
    });
    return await ctx.db.insert("captures", {
      ...rest,
      category: c.category ?? "unsorted",
      userId: identity.subject,
      status: "pending",
    });
  },
});

export const saveImageCapture = mutation({
  args: v.object({
    storageId: v.id("_storage"),
    src: v.optional(v.string()),
    alt: v.optional(v.string()),
    url: v.string(),
    timestamp: v.float64(),
    width: v.number(),
    height: v.number(),
    category: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    title: v.optional(v.string()),
    note: v.optional(v.string()),
    kind: v.optional(
      v.union(
        v.literal("image"),
        v.literal("screenshot"),
        v.literal("element"),
        v.literal("viewport")
      )
    ),
    /** element only: the picked element's tag. */
    tagName: v.optional(v.string()),
    /** element / viewport: cropped to the visible part of the page. */
    clipped: v.optional(v.boolean()),
    /** element only: computed-style summary of the picked element. */
    designDna: v.optional(designDnaValidator),
    /** Pixel palette of the stored image (max 6). */
    palette: v.optional(v.array(paletteColorValidator)),
    /** WebP thumbnail uploaded alongside the image. */
    thumbStorageId: v.optional(v.id("_storage")),
  }),
  handler: async (
    ctx,
    {
      storageId, src, alt, url, timestamp, width, height, category, tags, title, note, kind, tagName, clipped,
      designDna, palette, thumbStorageId,
    }
  ) => {
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) throw new Error("Unauthorized");
    if (designDna && kind !== "element") {
      throw new Error("designDna is only accepted for element captures");
    }
    assertColorPayload(designDna, palette);
    await assertCaptureRefs(ctx, identity.subject, { storageId, thumbStorageId });

    const common = {
      storageId,
      thumbStorageId,
      palette,
      alt,
      url,
      timestamp,
      width,
      height,
      category: category ?? "unsorted",
      tags: (tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean),
      title,
      note,
      userId: identity.subject,
      status: "pending" as const,
    };

    let captureId: Id<"captures">;
    if (kind === "element") {
      captureId = await ctx.db.insert("captures", { ...common, kind: "element", tagName, clipped, designDna });
    } else if (kind === "viewport") {
      captureId = await ctx.db.insert("captures", { ...common, kind: "viewport", clipped });
    } else if (kind === "screenshot") {
      captureId = await ctx.db.insert("captures", { ...common, kind: "screenshot", src: src ?? "" });
    } else {
      captureId = await ctx.db.insert("captures", { ...common, kind: "image", src: src ?? "" });
    }

    // Colours are indexed server-side from what was just validated, so the
    // rows can never disagree with the capture they describe.
    const colors = normalizeCaptureColors(designDna?.colors, palette);
    for (const c of colors) {
      await ctx.db.insert("captureColors", { captureId, userId: identity.subject, ...c });
    }
    return captureId;
  },
});




export const deleteById = mutation({
  args: {
    docId: v.id("captures"),
    /**
     * Ignored: the file deleted is always the capture's own. Still accepted so
     * dashboard tabs loaded before this change can delete until they reload.
     */
    storageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    
    if (!identity) throw new Error("Unauthorized");
    const doc = await ctx.db.get(args.docId);
    if (!doc || doc.userId !== identity.subject) {
      throw new Error("Not found or permission denied");
    }
    await ctx.db.delete(args.docId);

    const colorRows = await ctx.db
      .query("captureColors")
      .withIndex("by_capture", (q) => q.eq("captureId", args.docId))
      .collect();
    for (const row of colorRows) await ctx.db.delete(row._id);

    // Only ever the capture's own files, never an id supplied by the client.
    // Legacy rows may share a storage object, so keep it while anything else
    // still points at it.
    const files = doc as { storageId?: Id<"_storage">; thumbStorageId?: Id<"_storage"> };
    for (const storageId of [files.storageId, files.thumbStorageId]) {
      if (!storageId) continue;
      const stillUsed = await storageInUse(ctx, storageId);
      const exists = await ctx.db.system.get(storageId);
      if (!stillUsed && exists) await ctx.storage.delete(storageId);
    }

    if (doc.sessionId) {
      const session = await ctx.db.get(doc.sessionId);
      if (session && session.userId === identity.subject) {
        await ctx.db.patch(session._id, {
          itemCount: Math.max(0, (session.itemCount ?? 0) - 1),
        });
      }
    }
  },
});

export const createCategory = mutation({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
  
    if (!identity) throw new Error("Unauthorized");
    const name = args.name.trim();
    if (!name) return null;
    // ensure unique by name
    const existing = await ctx.db
      .query("categories")
      .withIndex("by_user_and_name", (q) =>
        q.eq("userId", identity.subject).eq("name", name)
      )
      .unique();
    if (existing) return existing._id;
    return await ctx.db.insert("categories", {
      name,
      createdAt: Date.now(),
      userId: identity.subject,
    });
  },
});

export const upsertTags = mutation({
  args: v.object({
    names: v.array(v.string()),
  }),
  handler: async (ctx, { names }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const normalized = Array.from(
      new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean))
    );
    const now = Date.now();
    for (const name of normalized) {
      const existing = await ctx.db
        .query("tags")
        .withIndex("by_user_and_name", (q) =>
          q.eq("userId", identity.subject).eq("name", name)
        )
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, {
          useCount: (existing as any).useCount + 1,
          lastUsedAt: now,
        });
      } else {
        await ctx.db.insert("tags", {
          name,
          userId: identity.subject,
          lastUsedAt: now,
          useCount: 1,
        });
      }
    }
  },
});

export const reassignCaptureCategory = mutation({
  args: v.object({
    docId: v.id("captures"),
    newCategory: v.string(),
  }),
  handler: async (ctx, { docId, newCategory }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const capture = await ctx.db.get(docId);
    if (!capture || (capture as any).userId !== identity.subject) {
      throw new Error("Not found or permission denied");
    }

    const name = newCategory.trim();
    const categoryName = name.length > 0 ? name : "unsorted";

    const existing = await ctx.db
      .query("categories")
      .withIndex("by_user_and_name", (q) =>
        q.eq("userId", identity.subject).eq("name", categoryName)
      )
      .unique();
    if (!existing) {
      await ctx.db.insert("categories", {
        name: categoryName,
        createdAt: Date.now(),
        userId: identity.subject,
      });
    }

    await ctx.db.patch(docId, { category: categoryName });
  },
});
