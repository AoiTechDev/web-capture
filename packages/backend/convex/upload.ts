import { v, type Infer } from "convex/values";
import { mutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { captureValidator, designDnaValidator, paletteColorValidator } from "./schema";
import { normalizeCaptureColors } from "./lib/color";
import { buildSearchText } from "./lib/search_rank";
import { capCaptureText, normalizeUserTags } from "./lib/capture_text";
import { isSignificantColor } from "./lib/search_filters";
import { deleteCapture, insertCapture } from "./user_stats";

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
    // Embeddings and AI fields are written only by the processing queue
    // (local_ai.completeProcessing), after the capture is claimed.
    const {
      userId: _userId,
      status: _status,
      error: _error,
      sessionId: _sessionId,
      designDna: _designDna,
      palette: _palette,
      thumbStorageId: _thumbStorageId,
      localEmbedding: _localEmbedding,
      textEmbedding: _textEmbedding,
      imageEmbedding: _imageEmbedding,
      aiAttempts: _aiAttempts,
      aiStartedAt: _aiStartedAt,
      aiCategory: _aiCategory,
      aiStyle: _aiStyle,
      aiTags: _aiTags,
      aiDescription: _aiDescription,
      aiClaim: _aiClaim,
      searchText: _searchText,
      truncated: _truncated,
      ...client
    } = capture as typeof capture & {
      designDna?: unknown;
      palette?: unknown;
      thumbStorageId?: unknown;
      localEmbedding?: unknown;
      textEmbedding?: unknown;
      imageEmbedding?: unknown;
    };
    // Text is cut to its caps (lib/capture_text) rather than refused, and
    // tags normalised as every other path stores them.
    const { fields: rest, truncated } = capCaptureText(client);
    const c = rest as {
      linkPreviewId?: Id<"link_previews">;
      storageId?: Id<"_storage">;
      tags?: string[];
    };
    await assertCaptureRefs(ctx, identity.subject, {
      linkPreviewId: c.linkPreviewId,
      storageId: c.storageId,
    });
    const tags = c.tags ? { tags: normalizeUserTags(c.tags) } : {};
    // `category` (a legacy folder, see the schema) is kept only when the
    // client chose one.
    return await insertCapture(ctx, {
      ...rest,
      ...tags,
      userId: identity.subject,
      status: "pending",
      searchText: buildSearchText({ ...(rest as any), ...tags }),
      ...(truncated ? { truncated } : {}),
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

    const { fields: text, truncated } = capCaptureText({ src, alt, url, category, title, note, tagName });
    const common = {
      storageId,
      thumbStorageId,
      palette,
      alt: text.alt,
      url: text.url,
      timestamp,
      width,
      height,
      category: text.category,
      tags: normalizeUserTags(tags ?? []),
      title: text.title,
      note: text.note,
      userId: identity.subject,
      status: "pending" as const,
      ...(truncated ? { truncated } : {}),
    };
    const searchText = buildSearchText(common);

    let captureId: Id<"captures">;
    if (kind === "element") {
      captureId = await insertCapture(ctx, {
        ...common,
        searchText,
        kind: "element",
        tagName: text.tagName,
        clipped,
        designDna,
      });
    } else if (kind === "viewport") {
      captureId = await insertCapture(ctx, { ...common, searchText, kind: "viewport", clipped });
    } else if (kind === "screenshot") {
      captureId = await insertCapture(ctx, { ...common, searchText, kind: "screenshot", src: text.src ?? "" });
    } else {
      captureId = await insertCapture(ctx, { ...common, searchText, kind: "image", src: text.src ?? "" });
    }

    // Colours are indexed server-side from what was just validated, so the
    // rows can never disagree with the capture they describe.
    const colors = normalizeCaptureColors(designDna?.colors, palette);
    for (const c of colors) {
      await ctx.db.insert("captureColors", {
        captureId,
        userId: identity.subject,
        ...c,
        significant: isSignificantColor(c.weight),
      });
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
    await deleteCapture(ctx, doc);

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

/**
 * Legacy folders: the extension's "choose category" overlay creates them
 * (and lists them with captures.listCategories). The dashboard no longer
 * shows them.
 */
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

/**
 * Count one more use of each tag in the user's tag list (suggestions),
 * adding new ones. Names are normalised as captures store them
 * (normalizeUserTags, so at most 20 per call). `useCount` counts adds:
 * removing a tag from a capture does not lower it.
 */
export async function recordTagUse(ctx: MutationCtx, userId: string, names: string[]) {
  const normalized = normalizeUserTags(names);
  const now = Date.now();
  for (const name of normalized) {
    const existing = await ctx.db
      .query("tags")
      .withIndex("by_user_and_name", (q) =>
        q.eq("userId", userId).eq("name", name)
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
        userId,
        lastUsedAt: now,
        useCount: 1,
      });
    }
  }
}

export const upsertTags = mutation({
  args: v.object({
    names: v.array(v.string()),
  }),
  handler: async (ctx, { names }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    await recordTagUse(ctx, identity.subject, names);
  },
});
