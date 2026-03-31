import path from "path"
import { fileURLToPath, pathToFileURL } from "url"
import semver from "semver"
import { Filesystem } from "@/util/filesystem"

export const DEPRECATED_PLUGIN_PACKAGES = ["symbolic-openai-codex-auth", "symbolic-copilot-auth"]

export type PluginKind = "server" | "tui"
type Mode = "strict" | "detect"

type Target = {
  dir: string
  pkg: string
  json: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function isDeprecatedPlugin(spec: string) {
  return DEPRECATED_PLUGIN_PACKAGES.some((pkg) => spec.includes(pkg))
}

export function parsePluginSpecifier(spec: string) {
  const idx = spec.lastIndexOf("@")
  const pkg = idx > 0 ? spec.substring(0, idx) : spec
  const version = idx > 0 ? spec.substring(idx + 1) : "latest"
  return { pkg, version }
}

export type PluginSource = "file" | "npm"

export function pluginSource(spec: string): PluginSource {
  return spec.startsWith("file://") ? "file" : "npm"
}

export function isPathPluginSpec(spec: string) {
  return spec.startsWith("file://") || spec.startsWith(".") || path.isAbsolute(spec) || /^[A-Za-z]:[\\/]/.test(spec)
}

export async function resolvePathPluginTarget(spec: string) {
  const raw = spec.startsWith("file://") ? fileURLToPath(spec) : spec
  const file = path.isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw) ? raw : path.resolve(raw)
  const stat = await Filesystem.stat(file)
  if (!stat?.isDirectory()) {
    return spec.startsWith("file://") ? spec : pathToFileURL(file).href
  }

  const pkg = await Filesystem.readJson<Record<string, unknown>>(path.join(file, "package.json")).catch(() => undefined)
  if (!pkg) throw new Error(`Plugin directory ${file} is missing package.json`)
  if (typeof pkg.main !== "string" || !pkg.main.trim()) {
    throw new Error(`Plugin directory ${file} must define package.json main`)
  }

  return pathToFileURL(path.resolve(file, pkg.main)).href
}

export async function readPluginPackage(target: string): Promise<Target> {
  const file = target.startsWith("file://") ? fileURLToPath(target) : target
  const stat = await Filesystem.stat(file)
  let dir = stat?.isDirectory() ? file : path.dirname(file)
  let pkg = path.join(dir, "package.json")
  while (!(await Filesystem.exists(pkg))) {
    const next = path.dirname(dir)
    if (next === dir) break
    dir = next
    pkg = path.join(dir, "package.json")
  }
  const json = await Filesystem.readJson<Record<string, unknown>>(pkg)
  return { dir, pkg, json }
}

function entry(value: unknown) {
  if (typeof value === "string") return value
  if (!isRecord(value)) return undefined
  for (const key of ["import", "default"]) {
    const nested = value[key]
    if (typeof nested === "string") return nested
  }
  return undefined
}

function hasEntrypoint(json: Record<string, unknown>, kind: PluginKind) {
  if (!isRecord(json.exports)) return false
  return `./${kind}` in json.exports
}

function resolveExport(raw: string, dir: string) {
  if (raw.startsWith("./") || raw.startsWith("../")) return path.resolve(dir, raw)
  if (raw.startsWith("file://")) return fileURLToPath(raw)
  return raw
}

export async function resolvePluginEntrypoint(spec: string, target: string, kind: PluginKind) {
  const pkg = await readPluginPackage(target).catch(() => undefined)
  if (!pkg) return target
  if (!hasEntrypoint(pkg.json, kind)) return target

  const exports = pkg.json.exports
  if (!isRecord(exports)) return target
  const raw = entry(exports[`./${kind}`])
  if (!raw) return target

  const resolved = resolveExport(raw, pkg.dir)
  const root = Filesystem.resolve(pkg.dir)
  const next = Filesystem.resolve(resolved)
  if (!Filesystem.contains(root, next)) {
    throw new Error(`Plugin ${spec} resolved ${kind} entry outside plugin directory`)
  }

  return pathToFileURL(next).href
}

export function readV1Plugin(
  mod: Record<string, unknown>,
  spec: string,
  kind: PluginKind,
  mode: Mode = "strict",
) {
  const value = mod.default
  if (!isRecord(value)) {
    if (mode === "detect") return
    throw new TypeError(`Plugin ${spec} must default export an object with ${kind}()`)
  }
  if (mode === "detect" && !("id" in value) && !("server" in value) && !("tui" in value)) return

  const server = "server" in value ? value.server : undefined
  const tui = "tui" in value ? value.tui : undefined
  if (server !== undefined && typeof server !== "function") {
    throw new TypeError(`Plugin ${spec} has invalid server export`)
  }
  if (tui !== undefined && typeof tui !== "function") {
    throw new TypeError(`Plugin ${spec} has invalid tui export`)
  }
  if (server !== undefined && tui !== undefined) {
    throw new TypeError(`Plugin ${spec} must default export either server() or tui(), not both`)
  }
  if (kind === "server" && server === undefined) {
    throw new TypeError(`Plugin ${spec} must default export an object with server()`)
  }
  if (kind === "tui" && tui === undefined) {
    throw new TypeError(`Plugin ${spec} must default export an object with tui()`)
  }

  return value
}

export async function resolvePluginId(source: PluginSource, spec: string, target: string, id: string | undefined) {
  if (source === "file") {
    if (id) return id
    throw new TypeError(`Path plugin ${spec} must export id`)
  }
  if (id) return id
  const pkg = await readPluginPackage(target)
  if (typeof pkg.json.name !== "string" || !pkg.json.name.trim()) {
    throw new TypeError(`Plugin package ${pkg.pkg} is missing name`)
  }
  return pkg.json.name.trim()
}

export async function checkPluginCompatibility(target: string, version: string) {
  if (!semver.valid(version) || semver.major(version) === 0) return
  const pkg = await readPluginPackage(target).catch(() => undefined)
  if (!pkg) return
  const engines = pkg.json.engines
  if (!isRecord(engines)) return
  const range = engines.opencode
  if (typeof range !== "string") return
  if (!semver.satisfies(version, range)) {
    throw new Error(`Plugin requires opencode ${range} but running ${version}`)
  }
}
