import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, process.cwd(), '');
  
  return {
    plugins: [react(), tailwindcss(), viteStaticCopy({
      targets: [
        {
          src: "public/manifest.json",
          dest: ".",
        },
      ],
    })],
    define: {
      // Make environment variables available to the background script
      'import.meta.env.CONVEX_URL': JSON.stringify(env.CONVEX_URL),
    },
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
  };
});
