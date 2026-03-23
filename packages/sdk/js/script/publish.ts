#!/usr/bin/env bun

import { Script } from "@symbolic-agent/script"
import { $ } from "bun"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

function host() {
  const repo = process.env.GH_REPO || process.env.GITHUB_REPOSITORY || "burn2delete/symbolic"
  return `https://github.com/${repo}`
}

async function seen(name: string, version: string) {
  const result = await $`npm view ${`${name}@${version}`} version`.nothrow()
  return result.exitCode === 0
}

const pkg = (await import("../package.json").then((m) => m.default)) as {
  name: string
  version: string
  exports: Record<string, string | object>
  repository?: { type: string; url: string }
}
const original = JSON.parse(JSON.stringify(pkg))
if (await seen(pkg.name, pkg.version)) process.exit(0)
function transformExports(exports: Record<string, string | object>) {
  for (const [key, value] of Object.entries(exports)) {
    if (typeof value === "object" && value !== null) {
      transformExports(value as Record<string, string | object>)
    } else if (typeof value === "string") {
      const file = value.replace("./src/", "./dist/").replace(".ts", "")
      exports[key] = {
        import: file + ".js",
        types: file + ".d.ts",
      }
    }
  }
}
transformExports(pkg.exports)
pkg.repository = {
  type: "git",
  url: host(),
}
await Bun.write("package.json", JSON.stringify(pkg, null, 2))
await $`bun pm pack`
await $`npm publish *.tgz --tag ${Script.channel} --access public`
await Bun.write("package.json", JSON.stringify(original, null, 2))
