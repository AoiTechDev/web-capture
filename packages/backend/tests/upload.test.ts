import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import { makeT, seedAB, seedUser, storageExists, storeBlob, userA, userB, vec } from "./fixtures";

const baseText = { kind: "text" as const, content: "hello", url: "https://p.example", timestamp: 1 };

describe("upload.generateUploadUrl", () => {
  test("rejects anonymous callers", async () => {
    const t = makeT();
    await expect(t.mutation(api.upload.generateUploadUrl, {})).rejects.toThrow(/Unauthorized/);
  });
  test("returns a URL for a signed-in user", async () => {
    const t = makeT();
    const url = await t.withIdentity(userA).mutation(api.upload.generateUploadUrl, {});
    expect(typeof url).toBe("string");
  });
});

describe("upload.uploadCapture", () => {
  test("rejects anonymous callers", async () => {
    const t = makeT();
    await expect(t.mutation(api.upload.uploadCapture, { capture: baseText })).rejects.toThrow(
      /Unauthorized/
    );
  });

  test("saves with status 'pending', server userId, default category", async () => {
    const t = makeT();
    const id = await t.withIdentity(userA).mutation(api.upload.uploadCapture, { capture: baseText });
    const doc = await t.run((ctx) => ctx.db.get(id));
    expect(doc).toMatchObject({ userId: userA.subject, status: "pending", category: "unsorted" });
    expect(doc!.error).toBeUndefined();
  });

  test("client cannot set userId, status or error", async () => {
    const t = makeT();
    const id = await t.withIdentity(userA).mutation(api.upload.uploadCapture, {
      capture: { ...baseText, userId: userB.subject, status: "ready", error: "forged" },
    });
    const doc = await t.run((ctx) => ctx.db.get(id));
    expect(doc!.userId).toBe(userA.subject);
    expect(doc!.status).toBe("pending");
    expect(doc!.error).toBeUndefined();
  });

  test("accepts the caller's own preview; ignores a client sessionId", async () => {
    const t = makeT();
    const { a } = await seedAB(t);
    const id = await t.withIdentity(userA).mutation(api.upload.uploadCapture, {
      capture: {
        kind: "link",
        href: "https://x.example",
        url: "https://p.example",
        timestamp: 1,
        sessionId: a.sessionId,
        linkPreviewId: a.previewId,
      },
    });
    const doc = await t.run((ctx) => ctx.db.get(id));
    expect(doc).toMatchObject({ linkPreviewId: a.previewId });
    // Sessions are attached by sessions.assignCapture, which keeps itemCount right.
    expect(doc!.sessionId).toBeUndefined();
  });

  test("never attaches another user's sessionId", async () => {
    const t = makeT();
    const { b } = await seedAB(t);
    const id = await t.withIdentity(userA).mutation(api.upload.uploadCapture, {
      capture: { ...baseText, sessionId: b.sessionId },
    });
    const doc = await t.run((ctx) => ctx.db.get(id));
    expect(doc!.sessionId).toBeUndefined();
  });

  test("rejects another user's linkPreviewId", async () => {
    const t = makeT();
    const { b } = await seedAB(t);
    await expect(
      t.withIdentity(userA).mutation(api.upload.uploadCapture, {
        capture: {
          kind: "link",
          href: "https://x.example",
          url: "https://p.example",
          timestamp: 1,
          linkPreviewId: b.previewId,
        },
      })
    ).rejects.toThrow(/Link preview not found/);
  });

  test("rejects a storageId already used by another capture (any owner)", async () => {
    const t = makeT();
    const { a, b } = await seedAB(t);
    for (const storageId of [a.storageId, b.storageId]) {
      await expect(
        t.withIdentity(userA).mutation(api.upload.uploadCapture, {
          capture: { kind: "screenshot", url: "https://p.example", timestamp: 1, storageId },
        })
      ).rejects.toThrow(/already in use/);
    }
  });

  test("accepts a fresh storageId", async () => {
    const t = makeT();
    const storageId = await storeBlob(t);
    const id = await t.withIdentity(userA).mutation(api.upload.uploadCapture, {
      capture: { kind: "element", storageId, width: 10, height: 20, url: "https://p", timestamp: 1 },
    });
    expect((await t.run((ctx) => ctx.db.get(id)))!.kind).toBe("element");
  });

  // Embeddings and AI fields belong to the processing queue
  // (local_ai.completeProcessing); a client cannot pre-fill them.
  test("discards client-supplied embeddings and AI fields", async () => {
    const t = makeT();
    const storageId = await storeBlob(t);
    const textId = await t.withIdentity(userA).mutation(api.upload.uploadCapture, {
      capture: {
        ...baseText,
        textEmbedding: vec(512),
        aiCategory: "hero",
        aiStyle: ["dark"],
        aiTags: ["forged"],
        aiAttempts: 5,
        aiDescription: "forged",
      },
    });
    const shotId = await t.withIdentity(userA).mutation(api.upload.uploadCapture, {
      capture: { kind: "screenshot", url: "https://p", timestamp: 1, storageId, localEmbedding: vec(7) },
    });
    const text = (await t.run((ctx) => ctx.db.get(textId))) as any;
    const shot = (await t.run((ctx) => ctx.db.get(shotId))) as any;
    for (const key of ["textEmbedding", "aiCategory", "aiStyle", "aiTags", "aiAttempts", "aiDescription"]) {
      expect(text[key], key).toBeUndefined();
    }
    expect(shot.localEmbedding).toBeUndefined();
    expect(text.status).toBe("pending");
  });
});

describe("upload.saveImageCapture", () => {
  const args = { url: "https://p.example", timestamp: 1, width: 100, height: 50 };

  test("rejects anonymous callers", async () => {
    const t = makeT();
    const storageId = await storeBlob(t);
    await expect(t.mutation(api.upload.saveImageCapture, { ...args, storageId })).rejects.toThrow(
      /Unauthorized/
    );
  });

  test.each(["image", "screenshot", "element", "viewport"] as const)(
    "saves kind %s with status pending and caller's userId",
    async (kind) => {
      const t = makeT();
      const storageId = await storeBlob(t);
      const id = await t.withIdentity(userA).mutation(api.upload.saveImageCapture, {
        ...args,
        storageId,
        kind,
        tagName: "DIV",
        clipped: true,
      });
      const doc = (await t.run((ctx) => ctx.db.get(id))) as any;
      expect(doc).toMatchObject({ kind, userId: userA.subject, status: "pending", storageId });
      if (kind === "element") expect(doc).toMatchObject({ tagName: "DIV", clipped: true });
      if (kind === "viewport") expect(doc.clipped).toBe(true);
    }
  );

  test("defaults to kind image when omitted", async () => {
    const t = makeT();
    const storageId = await storeBlob(t);
    const id = await t.withIdentity(userA).mutation(api.upload.saveImageCapture, { ...args, storageId });
    expect((await t.run((ctx) => ctx.db.get(id)))!.kind).toBe("image");
  });

  test("rejects a storageId owned by another user's capture", async () => {
    const t = makeT();
    const { b } = await seedAB(t);
    await expect(
      t.withIdentity(userA).mutation(api.upload.saveImageCapture, { ...args, storageId: b.storageId })
    ).rejects.toThrow(/already in use/);
  });

  test("rejects reusing a storageId the caller already used", async () => {
    const t = makeT();
    const storageId = await storeBlob(t);
    await t.withIdentity(userA).mutation(api.upload.saveImageCapture, { ...args, storageId });
    await expect(
      t.withIdentity(userA).mutation(api.upload.saveImageCapture, { ...args, storageId })
    ).rejects.toThrow(/already in use/);
  });
});

describe("upload.deleteById", () => {
  test("rejects anonymous callers", async () => {
    const t = makeT();
    const { a } = await seedAB(t);
    await expect(t.mutation(api.upload.deleteById, { docId: a.shotId })).rejects.toThrow(/Unauthorized/);
  });

  test("rejects another user's capture and leaves it intact", async () => {
    const t = makeT();
    const { a } = await seedAB(t);
    await expect(
      t.withIdentity(userB).mutation(api.upload.deleteById, { docId: a.shotId })
    ).rejects.toThrow(/permission denied/);
    expect(await t.run((ctx) => ctx.db.get(a.shotId))).not.toBeNull();
    expect(await storageExists(t, a.storageId)).toBe(true);
  });

  test("deletes the capture's own file and decrements session itemCount", async () => {
    const t = makeT();
    const { a, b } = await seedAB(t);
    await t.withIdentity(userA).mutation(api.upload.deleteById, { docId: a.shotId });
    expect(await t.run((ctx) => ctx.db.get(a.shotId))).toBeNull();
    expect(await storageExists(t, a.storageId)).toBe(false);
    expect(await storageExists(t, b.storageId)).toBe(true);
    const session = await t.run((ctx) => ctx.db.get(a.sessionId));
    expect(session!.itemCount).toBe(1);
  });

  test("ignores a client-supplied storageId argument", async () => {
    const t = makeT();
    const { a, b } = await seedAB(t);
    await t.withIdentity(userA).mutation(api.upload.deleteById, {
      docId: a.linkId,
      storageId: b.storageId,
    });
    expect(await t.run((ctx) => ctx.db.get(a.linkId))).toBeNull();
    expect(await storageExists(t, b.storageId)).toBe(true);
  });

  test("itemCount never goes below zero", async () => {
    const t = makeT();
    const a = await seedUser(t, userA.subject);
    await t.run((ctx) => ctx.db.patch(a.sessionId, { itemCount: 0 }));
    await t.withIdentity(userA).mutation(api.upload.deleteById, { docId: a.linkId });
    expect((await t.run((ctx) => ctx.db.get(a.sessionId)))!.itemCount).toBe(0);
  });

  test("keeps a legacy shared storage object while another capture uses it", async () => {
    const t = makeT();
    const { a } = await seedAB(t);
    const twin = await t.run((ctx) =>
      ctx.db.insert("captures", {
        kind: "image",
        src: "",
        url: "https://p",
        timestamp: 3,
        width: 1,
        height: 1,
        storageId: a.storageId,
        userId: userA.subject,
      })
    );
    await t.withIdentity(userA).mutation(api.upload.deleteById, { docId: a.shotId });
    expect(await storageExists(t, a.storageId)).toBe(true);
    await t.withIdentity(userA).mutation(api.upload.deleteById, { docId: twin });
    expect(await storageExists(t, a.storageId)).toBe(false);
  });
});
