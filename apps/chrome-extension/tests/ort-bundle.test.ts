/**
 * The offscreen document imports onnxruntime-web's dist/ort.webgpu.bundle.min.mjs,
 * which Parcel compiles into a classic script. That only parses if no
 * `import.meta` is left where Parcel does not transpile it: inside
 * `new Worker(...)`. The repo's pnpm patch (patches/onnxruntime-web@*.patch)
 * removes the one such expression; this fails if an upgrade drops the patch.
 */
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { expect, test } from "vitest"

const require = createRequire(join(__dirname, "package.json"))

test("the installed ORT bundle carries the worker-URL patch", () => {
  const bundle = readFileSync(
    // "exports" hides dist/; the Node entry sits in the same directory.
    join(dirname(require.resolve("onnxruntime-web")), "ort.webgpu.bundle.min.mjs"),
    "utf8"
  )
  expect(bundle).not.toMatch(/new Worker\(\(\(\)=>\{[^}]*import\.meta/)
  expect(bundle.split("new Worker(ye").length - 1).toBe(1)
  // The JS loader must be embedded: offscreen.tsx relies on never importing it from a URL.
  expect(bundle).toContain("ort-wasm-simd-threaded.asyncify.wasm")
})
