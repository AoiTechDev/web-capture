import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), viteStaticCopy({
    targets: [
      {
        src: "public/manifest.json",
        dest: ".",
      },
    ],
  })],
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: "index.html",
        content: "src/content-script.ts",
        background: "src/background.ts",
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'content') return 'content.js';
          if (chunkInfo.name === 'background') return 'background.js';
          return 'assets/[name]-[hash].js';
        },
      },
    },
  },
});
