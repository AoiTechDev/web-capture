import { type FunctionReference, anyApi } from "convex/server";
import { type GenericId as Id } from "convex/values";

export const api: PublicApiType = anyApi as unknown as PublicApiType;
export const internal: InternalApiType = anyApi as unknown as InternalApiType;

export type PublicApiType = {
  captures: {
    imageUrls: FunctionReference<"query", "public", Record<string, never>, any>;
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
              kind: "image";
              src: string;
              storageId?: Id<"_storage">;
              timestamp: number;
              url: string;
            }
          | { content: string; kind: "text"; timestamp: number; url: string }
          | {
              href: string;
              kind: "link";
              text?: string;
              timestamp: number;
              url: string;
            }
          | { content: string; kind: "code"; timestamp: number; url: string }
          | {
              content?: string;
              kind: "element";
              tagName: string;
              timestamp: number;
              url: string;
            };
      },
      any
    >;
    saveImageCapture: FunctionReference<
      "mutation",
      "public",
      {
        alt?: string;
        src?: string;
        storageId: Id<"_storage">;
        timestamp: number;
        url: string;
      },
      any
    >;
  };
};
export type InternalApiType = {};
