#!/usr/bin/env bun

import { $ } from "bun"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const source = process.platform === "win32" ? "symbolic.exe" : "symbolic"
const ext = process.platform === "win32" ? ".exe" : ""

function dir() {
  if (process.env.SYMBOLIC_INSTALL_DIR) return path.resolve(process.env.SYMBOLIC_INSTALL_DIR)
  if (process.env.XDG_BIN_DIR) return path.resolve(process.env.XDG_BIN_DIR)
  return path.join(os.homedir(), ".symbolic", "bin")
}

async function bin() {
  const dist = path.join(root, "dist")
  const dirs = await fs.readdir(dist, { withFileTypes: true }).catch(() => [])
  const hits = await Promise.all(
    dirs
      .filter((item) => item.isDirectory())
      .map(async (item) => {
        const file = path.join(dist, item.name, "bin", source)
        try {
          await fs.access(file)
          return file
        } catch {
          return
        }
      }),
  ).then((items) => items.filter((item): item is string => !!item))
  if (hits.length === 1) return hits[0]
  if (hits.length === 0) throw new Error("No built binary found in dist")
  throw new Error(`Expected one built binary in dist, found ${hits.length}`)
}

async function link(file: string, target: string) {
  await fs.rm(target, { force: true })
  await fs.symlink(file, target).catch(async () => {
    await fs.copyFile(file, target)
  })
  await fs.chmod(target, 0o755).catch(() => undefined)
}

async function main() {
  process.chdir(root)
  console.log("Building current platform binary")
  await $`bun run build --single`

  const file = await bin()
  const dest = dir()
  const target = path.join(dest, "symbolic" + ext)

  await fs.mkdir(dest, { recursive: true })
  await link(file, target)

  console.log(`Installed ${target}`)
}

await main()
