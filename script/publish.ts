#!/usr/bin/env bun

import { Script } from "@symbolic-agent/script"
import { $ } from "bun"
import { fileURLToPath } from "url"

const highlightsTemplate = `
<!--
Add highlights before publishing. Delete this section if no highlights.

- For multiple highlights, use multiple <highlight> tags
- Highlights with the same source attribute get grouped together
-->

<!--
<highlight source="SourceName (TUI/Desktop/Web/Core)">
  <h2>Feature title goes here</h2>
  <p short="Short description used for Desktop Recap">
    Full description of the feature or change
  </p>

  https://github.com/user-attachments/assets/uuid-for-video (you will want to drag & drop the video or picture)

  <img
    width="1912"
    height="1164"
    alt="image"
    src="https://github.com/user-attachments/assets/uuid-for-image"
  />
</highlight>
-->

`

function on(name: string) {
  return process.env[name] !== "false"
}

function repo() {
  return process.env.GH_REPO || process.env.GITHUB_REPOSITORY || "burn2delete/symbolic"
}

function host() {
  return `https://github.com/${repo()}`
}

console.log("=== publishing ===\n")

const pkgjsons = await Array.fromAsync(
  new Bun.Glob("**/package.json").scan({
    absolute: true,
  }),
).then((arr) => arr.filter((x) => !x.includes("node_modules") && !x.includes("dist")))

for (const file of pkgjsons) {
  let pkg = await Bun.file(file).text()
  pkg = pkg.replaceAll(/"version": "[^"]+"/g, `"version": "${Script.version}"`)
  console.log("updated:", file)
  await Bun.file(file).write(pkg)
}

const extensionToml = fileURLToPath(new URL("../packages/extensions/zed/extension.toml", import.meta.url))
let toml = await Bun.file(extensionToml).text()
toml = toml.replace(/^version = "[^"]+"/m, `version = "${Script.version}"`)
toml = toml.replace(/^repository = ".*"$/m, `repository = "${host()}"`)
toml = toml.replaceAll(/releases\/download\/v[^/]+\//g, `releases/download/v${Script.version}/`)
toml = toml.replaceAll(/https:\/\/github\.com\/[^/]+\/[^/]+/g, host())
console.log("updated:", extensionToml)
await Bun.file(extensionToml).write(toml)

await $`bun install`
await import(`../packages/sdk/js/script/build.ts`)

if (Script.release) {
  if (!Script.preview) {
    const diff = (await $`git status --short`.text()).trim()
    if (diff) {
      await $`git commit -am "release: v${Script.version}"`
    }
    await $`git fetch origin --tags`
    const tag = (await $`git tag -l v${Script.version}`.text()).trim()
    if (!tag) {
      await $`git tag v${Script.version}`
    }
    await $`git fetch origin`
    await $`git cherry-pick HEAD..origin/dev`.nothrow()
    await $`git push origin HEAD --tags --no-verify --force-with-lease`
    await new Promise((resolve) => setTimeout(resolve, 5_000))
  }

  if (on("SYMBOLIC_RELEASE_TAURI")) {
    await import(`../packages/desktop/scripts/finalize-latest-json.ts`)
  }
  if (on("SYMBOLIC_RELEASE_ELECTRON")) {
    await import(`../packages/desktop-electron/scripts/finalize-latest-yml.ts`)
  }

  await $`gh release edit v${Script.version} --draft=false --repo ${process.env.GH_REPO}`
}

if (
  on("SYMBOLIC_PUBLISH_NPM") ||
  on("SYMBOLIC_PUBLISH_CONTAINER") ||
  on("SYMBOLIC_PUBLISH_AUR") ||
  on("SYMBOLIC_PUBLISH_HOMEBREW")
) {
  console.log("\n=== cli ===\n")
  await import(`../packages/symbolic/script/publish.ts`)
}

if (on("SYMBOLIC_PUBLISH_SDK")) {
  console.log("\n=== sdk ===\n")
  await import(`../packages/sdk/js/script/publish.ts`)
}

if (on("SYMBOLIC_PUBLISH_PLUGIN")) {
  console.log("\n=== plugin ===\n")
  await import(`../packages/plugin/script/publish.ts`)
}

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)
