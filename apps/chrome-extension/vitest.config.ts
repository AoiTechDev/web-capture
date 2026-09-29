import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirrors the "~*" path alias Plasmo resolves at build time.
    alias: [{ find: /^~(.*)$/, replacement: fileURLToPath(new URL("./src/$1", import.meta.url)) }],
  },
  test: {
    environment: "happy-dom",
    include: ["tests/**/*.test.ts"],
  },
});
