import { action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";

// Avoid needing Node types in this package
declare const process: any;

const OPENAI_API_URL = "https://api.openai.com/v1";

export const generateImageCaptionAndEmbedding = action({
  args: {
    captureId: v.id("captures"),
  },
  handler: async (ctx, { captureId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const apiKey = process.env?.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("Missing OPENAI_API_KEY environment variable");
    }

    const capture = await ctx.runQuery(api.captures.getCaptureById, { id: captureId });
    if (!capture) throw new Error("Capture not found");
    if ((capture as any).kind !== "image") throw new Error("Only image captures are supported");

    const storageId = (capture as any).storageId;
    if (!storageId) throw new Error("Capture has no storageId");

    const imageUrl = await ctx.storage.getUrl(storageId);
    if (!imageUrl) throw new Error("Failed to generate image URL");

    // 1) Caption the image using gpt-4o-mini
    const captionJson = await (async () => {
      const body = {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Return JSON: {\"caption\": string, \"keywords\": string[]} describing and indexing this image. Keep it factual and concise." },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
        max_tokens: 250,
        temperature: 0.2,
      } as const;

      const resp = await fetch(`${OPENAI_API_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`OpenAI captioning failed: ${resp.status} ${text}`);
      }
      const data: any = await resp.json();
      const content = data?.choices?.[0]?.message?.content ?? "";
      try {
        // Try to parse JSON directly
        return JSON.parse(content);
      } catch {
        // If the model returned plain text, massage it minimally
        return { caption: String(content).slice(0, 500), keywords: [] };
      }
    })();

    const textToEmbed = [
      typeof captionJson?.caption === "string" ? captionJson.caption : "",
      Array.isArray(captionJson?.keywords) ? captionJson.keywords.join(" ") : "",
    ]
      .filter(Boolean)
      .join(" \n");

    // 2) Embed the caption/keywords using text-embedding-3-small
    const embedding = await (async () => {
      const body = {
        model: "text-embedding-3-small",
        input: textToEmbed || "image",
      } as const;
      const resp = await fetch(`${OPENAI_API_URL}/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`OpenAI embeddings failed: ${resp.status} ${text}`);
      }
      const data: any = await resp.json();
      const vec: number[] | undefined = data?.data?.[0]?.embedding;
      if (!Array.isArray(vec)) throw new Error("Embedding not returned");
      return vec.map((x) => Number(x));
    })();

    // 3) Save back to the document
    await ctx.runMutation(api.captures.patchImageCaptionAndEmbedding, {
      id: captureId,
      caption: String(captionJson?.caption ?? ""),
      imageEmbedding: embedding,
    });

    return { ok: true } as const;
  },
});

export const embedQuery = action({
  args: { q: v.string() },
  handler: async (ctx, { q }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const apiKey = process.env?.OPENAI_API_KEY;
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY environment variable");

    const resp = await fetch(`${OPENAI_API_URL}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: "text-embedding-3-small", input: q }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`OpenAI embeddings failed: ${resp.status} ${text}`);
    }
    const data: any = await resp.json();
    const vec: number[] | undefined = data?.data?.[0]?.embedding;
    if (!Array.isArray(vec)) throw new Error("Embedding not returned");
    return { vector: vec.map((x) => Number(x)) } as const;
  },
});


