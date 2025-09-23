import { type FunctionReference, anyApi } from "convex/server";
import { type GenericId as Id } from "convex/values";

export const api: PublicApiType = anyApi as unknown as PublicApiType;
export const internal: InternalApiType = anyApi as unknown as InternalApiType;

export type PublicApiType = {
  captures: {
    imageUrls: FunctionReference<
      "query",
      "public",
      { category?: string },
      Array<{
        _id: Id<"captures">;
        url: string;
        width: number;
        height: number;
        storageId: Id<"_storage">;
        category?: string;
      }>
    >;
    listCategories: FunctionReference<
      "query",
      "public",
      Record<string, never>,
      Array<{ _id: Id<"categories">; name: string }>
    >;
  };
  upload: {
    generateUploadUrl: FunctionReference<"mutation", "public", any, any>;
    uploadCapture: FunctionReference<
      "mutation",
      "public",
      {
        capture:
          | {
              alt?: string;
              height: number;
              kind: "image";
              src: string;
              storageId?: Id<"_storage">;
              timestamp: number;
              url: string;
              width: number;
            }
          | { content: string; kind: "text"; timestamp: number; url: string; category?: string }
          | {
              href: string;
              kind: "link";
              text?: string;
              timestamp: number;
              url: string;
              category?: string;
            }
          | { content: string; kind: "code"; timestamp: number; url: string; category?: string }
          | {
              content?: string;
              kind: "element";
              tagName: string;
              timestamp: number;
              url: string;
              category?: string;
            };
      },
      any
    >;
    saveImageCapture: FunctionReference<
      "mutation",
      "public",
      {
        alt?: string;
        height: number;
        src?: string;
        storageId: Id<"_storage">;
        timestamp: number;
        url: string;
        width: number;
        category?: string;
      },
      any
    >;
    deleteById: FunctionReference<
      "mutation",
      "public",
      { docId: Id<"captures">; storageId: Id<"_storage"> },
      any
    >;
    createCategory: FunctionReference<
      "mutation",
      "public",
      { name: string },
      Id<"categories"> | null
    >;
  };
};
export type InternalApiType = {};
