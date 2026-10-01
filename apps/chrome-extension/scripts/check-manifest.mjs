// Flags `$VAR` placeholders Plasmo left in a built manifest because the env
// variable was missing. Chrome rejects such match patterns, so a manifest with
// one is not shippable. Warns by default; `--strict` exits non-zero.
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const strict = process.argv.includes("--strict")
const buildDir = new URL("../build/", import.meta.url).pathname.replace(/^\/(\w:)/, "$1")

let problems = 0
if (existsSync(buildDir)) {
  for (const target of readdirSync(buildDir)) {
    const file = join(buildDir, target, "manifest.json")
    if (!existsSync(file)) continue
    const unresolved = [...new Set(readFileSync(file, "utf8").match(/\$[A-Z][A-Z0-9_]*/g) ?? [])]
    if (unresolved.length === 0) continue
    problems++
    console.warn(`[check-manifest] ${target}/manifest.json has unresolved env: ${unresolved.join(", ")}`)
  }
}

if (problems > 0) {
  console.warn("[check-manifest] Set these in the env file for that build (e.g. .env.chrome for prod).")
  if (strict) process.exit(1)
}
