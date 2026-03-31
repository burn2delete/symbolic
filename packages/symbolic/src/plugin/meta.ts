import path from "path"
import { fileURLToPath } from "url"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { Lock } from "@/util/lock"

export namespace PluginMeta {
  type Source = "file" | "npm"

  export type Theme = {
    src: string
    dest: string
    mtime?: number
    size?: number
  }

  export type Entry = {
    id: string
    source: Source
    spec: string
    target: string
    requested?: string
    version?: string
    modified?: number
    first_time: number
    last_time: number
    time_changed: number
    load_count: number
    fingerprint: string
    themes?: Record<string, Theme>
  }

  export type State = "first" | "updated" | "same"

  export type Touch = {
    spec: string
    target: string
    id: string
  }

  type Store = Record<string, Entry>
  type Core = Omit<Entry, "first_time" | "last_time" | "time_changed" | "load_count" | "fingerprint" | "themes">

  function file() {
    return path.join(Global.Path.state, "plugin-meta.json")
  }

  function lock(file: string) {
    return `plugin-meta:${file}`
  }

  function source(spec: string, target: string): Source {
    return spec.startsWith("file://") || target.startsWith("file://") ? "file" : "npm"
  }

  function spec(input: string) {
    if (input.startsWith("file://")) return { pkg: input, version: undefined as string | undefined }
    const idx = input.lastIndexOf("@")
    if (idx <= 0) return { pkg: input, version: undefined as string | undefined }
    return {
      pkg: input.substring(0, idx),
      version: input.substring(idx + 1),
    }
  }

  function target(input: string) {
    return input.startsWith("file://") ? fileURLToPath(input) : input
  }

  function stat(input: string) {
    return Filesystem.stat(input)
  }

  async function modified(file: string) {
    const s = stat(file)
    if (!s) return
    return Math.floor(typeof s.mtimeMs === "bigint" ? Number(s.mtimeMs) : s.mtimeMs)
  }

  async function version(input: string) {
    const dir = target(input)
    const s = stat(dir)
    const root = s?.isDirectory() ? dir : path.dirname(dir)
    return Filesystem.readJson<{ version?: string }>(path.join(root, "package.json"))
      .then((item) => item.version)
      .catch(() => undefined)
  }

  async function core(item: Touch): Promise<Core> {
    const src = source(item.spec, item.target)
    if (src === "file") {
      const file = item.target.startsWith("file://") ? target(item.target) : target(item.spec)
      return {
        id: item.id,
        source: src,
        spec: item.spec,
        target: item.target,
        modified: file ? await modified(file) : undefined,
      }
    }

    return {
      id: item.id,
      source: src,
      spec: item.spec,
      target: item.target,
      requested: spec(item.spec).version,
      version: await version(item.target),
    }
  }

  function fp(item: Core) {
    if (item.source === "file") return [item.target, item.modified ?? ""].join("|")
    return [item.target, item.requested ?? "", item.version ?? ""].join("|")
  }

  async function read(file: string): Promise<Store> {
    return Filesystem.readJson<Store>(file).catch(() => ({} as Store))
  }

  function next(prev: Entry | undefined, item: Core, now: number) {
    const entry: Entry = {
      ...item,
      first_time: prev?.first_time ?? now,
      last_time: now,
      time_changed: prev?.time_changed ?? now,
      load_count: (prev?.load_count ?? 0) + 1,
      fingerprint: fp(item),
      themes: prev?.themes,
    }
    const state: State = !prev ? "first" : prev.fingerprint === entry.fingerprint ? "same" : "updated"
    if (state === "updated") entry.time_changed = now
    return { state, entry }
  }

  export async function touchMany(items: Touch[]) {
    if (!items.length) return []
    const p = file()
    const rows = await Promise.all(items.map(core))

    using _ = await Lock.write(lock(p))
    const store = await read(p)
    const now = Date.now()
    const out: Array<{ state: State; entry: Entry }> = []

    for (const item of rows) {
      const hit = next(store[item.id], item, now)
      store[item.id] = hit.entry
      out.push(hit)
    }

    await Filesystem.writeJson(p, store)
    return out
  }

  export async function touch(spec: string, target: string, id: string) {
    const hit = await touchMany([{ spec, target, id }])
    const row = hit[0]
    if (row) return row
    throw new Error("Failed to touch plugin metadata.")
  }

  export async function setTheme(id: string, name: string, theme: Theme) {
    const p = file()
    using _ = await Lock.write(lock(p))
    const store = await read(p)
    const entry = store[id]
    if (!entry) return
    entry.themes = {
      ...(entry.themes ?? {}),
      [name]: theme,
    }
    await Filesystem.writeJson(p, store)
  }

  export async function list(): Promise<Store> {
    const p = file()
    using _ = await Lock.read(lock(p))
    return read(p)
  }
}
