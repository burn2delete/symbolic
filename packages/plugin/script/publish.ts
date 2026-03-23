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

async function open(name: string) {
  if (!name.startsWith("@")) return
  await $`npm access public ${name}`.nothrow()
}

async function seen(name: string, version: string) {
  const result = await $`npm view ${`${name}@${version}`} version`.nothrow()
  return result.exitCode === 0
}

await $`bun tsc`
const pkg = await import("../package.json").then((m) => m.default)
const original = JSON.parse(JSON.stringify(pkg))
if (await seen(pkg.name, pkg.version)) {
  await open(pkg.name)
  process.exit(0)
}
for (const [key, value] of Object.entries(pkg.exports)) {
  const file = value.replace("./src/", "./dist/").replace(".ts", "")
  // @ts-ignore
  pkg.exports[key] = {
    import: file + ".js",
    types: file + ".d.ts",
  }
}
pkg.repository = {
  type: "git",
  url: host(),
}
await Bun.write("package.json", JSON.stringify(pkg, null, 2))
await $`bun pm pack && npm publish *.tgz --tag ${Script.channel} --access public`
await open(pkg.name)
await Bun.write("package.json", JSON.stringify(original, null, 2))
