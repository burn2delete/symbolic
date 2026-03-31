import path from "path"
import {
  type ParseError as JsoncParseError,
  applyEdits,
  modify,
  parse as parseJsonc,
  printParseErrorCode,
} from "jsonc-parser"
import { BunProc } from "../bun"
import { ConfigPaths } from "../config/paths"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import { Lock } from "../util/lock"

type Mode = "noop" | "add" | "replace"
type Kind = "server" | "tui"
type Item = string | [string, Record<string, unknown>]

export type Target = {
  kind: Kind
  opts?: Record<string, unknown>
}

type Ok<T> = {
  ok: true
} & T

type Err<C extends string, T> = {
  ok: false
  code: C
} & T

export type InstallResult = Ok<{ target: string }> | Err<"install_failed", { error: unknown }>

export type ManifestResult =
  | Ok<{ targets?: Target[] }>
  | Err<"manifest_read_failed", { file: string; error: unknown }>
  | Err<"manifest_no_targets", { file: string }>

export type PatchResult =
  | Ok<{ file: string; mode: Mode }>
  | Err<"invalid_json", { file: string; line: number; col: number; parse: string }>
  | Err<"patch_failed", { file: string; error: unknown }>

export type PatchInput = {
  spec: string
  item?: Item
  kind?: Kind
  force?: boolean
  global?: boolean
  vcs?: string
  worktree: string
  directory: string
}

function parseSpec(spec: string) {
  const idx = spec.lastIndexOf("@")
  const pkg = idx > 0 ? spec.substring(0, idx) : spec
  const version = idx > 0 ? spec.substring(idx + 1) : "latest"
  return { pkg, version }
}

function pluginName(spec: string) {
  if (spec.startsWith("file://")) {
    return path.parse(new URL(spec).pathname).name
  }
  const idx = spec.lastIndexOf("@")
  if (idx > 0) return spec.substring(0, idx)
  return spec
}

function pluginSpec(item: unknown) {
  if (typeof item === "string") return item
  if (!Array.isArray(item)) return
  if (typeof item[0] !== "string") return
  return item[0]
}

function pluginList(data: unknown) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return
  const item = data as { plugin?: unknown }
  if (!Array.isArray(item.plugin)) return
  return item.plugin
}

function parseTarget(item: unknown): Target | undefined {
  if (item === "server" || item === "tui") return { kind: item }
  if (!Array.isArray(item)) return
  if (item[0] !== "server" && item[0] !== "tui") return
  if (item.length < 2) return { kind: item[0] }
  const opt = item[1]
  if (!opt || typeof opt !== "object" || Array.isArray(opt)) return { kind: item[0] }
  return {
    kind: item[0],
    opts: opt,
  }
}

function parseTargets(raw: unknown) {
  if (!Array.isArray(raw)) return []
  const map = new Map<Kind, Target>()
  for (const item of raw) {
    const hit = parseTarget(item)
    if (!hit) continue
    map.set(hit.kind, hit)
  }
  return [...map.values()]
}

function patch(text: string, path: Array<string | number>, value: unknown, insert = false) {
  return applyEdits(
    text,
    modify(text, path, value, {
      formattingOptions: {
        tabSize: 2,
        insertSpaces: true,
      },
      isArrayInsertion: insert,
    }),
  )
}

function patchList(
  text: string,
  list: unknown[] | undefined,
  spec: string,
  item: Item = spec,
  force = false,
): { mode: Mode; text: string } {
  const name = pluginName(spec)
  const rows = (list ?? []).map((item, i) => ({
    item,
    i,
    spec: pluginSpec(item),
  }))
  const dup = rows.filter((item) => item.spec && pluginName(item.spec) === name)

  if (!dup.length) {
    if (!list) {
      return {
        mode: "add",
        text: patch(text, ["plugin"], [item]),
      }
    }
    return {
      mode: "add",
      text: patch(text, ["plugin", list.length], item, true),
    }
  }

  if (!force) {
    return {
      mode: "noop",
      text,
    }
  }

  const keep = dup[0]
  if (!keep) {
    return {
      mode: "noop",
      text,
    }
  }

  if (dup.length === 1 && keep.spec === spec) {
    return {
      mode: "noop",
      text,
    }
  }

  let out = text
  if (typeof keep.item === "string") {
    out = patch(out, ["plugin", keep.i], item)
  } else if (Array.isArray(keep.item) && typeof keep.item[0] === "string") {
    out = Array.isArray(item) ? patch(out, ["plugin", keep.i], item) : patch(out, ["plugin", keep.i, 0], item)
  }

  const del = dup
    .map((item) => item.i)
    .filter((i) => i !== keep.i)
    .sort((a, b) => b - a)

  for (const i of del) {
    out = patch(out, ["plugin", i], undefined)
  }

  return {
    mode: "replace",
    text: out,
  }
}

function cfgDir(input: PatchInput) {
  if (input.global) return Global.Path.config
  const git = input.vcs === "git" && input.worktree !== "/"
  return git ? input.worktree : input.directory
}

function cfgName(kind: Kind) {
  if (kind === "server") return "symbolic"
  return "tui"
}

function cfgFiles(dir: string, kind: Kind, global = false) {
  const name = cfgName(kind)
  if (global) return ConfigPaths.fileInDirectory(dir, name)
  const root = [path.join(dir, `${name}.jsonc`), path.join(dir, `${name}.json`)]
  const local = [path.join(dir, ".symbolic", `${name}.jsonc`), path.join(dir, ".symbolic", `${name}.json`)]
  return [
    ...local,
    ...root,
  ]
}

async function cfgFile(input: PatchInput) {
  const dir = cfgDir(input)
  const kind = input.kind ?? "server"
  if (!input.global) {
    const name = cfgName(kind)
    const local = [path.join(dir, ".symbolic", `${name}.jsonc`), path.join(dir, ".symbolic", `${name}.json`)]
    for (const file of local) {
      if (await Filesystem.exists(file)) return file
    }
  }

  const files = cfgFiles(dir, kind, Boolean(input.global))
  for (const file of files) {
    if (await Filesystem.exists(file)) return file
  }
  if (!input.global) return path.join(dir, `${cfgName(kind)}.jsonc`)
  return files[0]
}

export async function installPlugin(spec: string): Promise<InstallResult> {
  const parsed = parseSpec(spec)
  const target = await BunProc.install(parsed.pkg, parsed.version, { ignoreScripts: true }).then(
    (item) => ({
      ok: true as const,
      item,
    }),
    (error: unknown) => ({
      ok: false as const,
      error,
    }),
  )
  if (!target.ok) {
    return {
      ok: false,
      code: "install_failed",
      error: target.error,
    }
  }
  return {
    ok: true,
    target: target.item,
  }
}

export async function readPluginManifest(target: string): Promise<ManifestResult> {
  const file = path.join(target, "package.json")
  const json = await Filesystem.readJson<Record<string, unknown>>(file).then(
    (item) => ({
      ok: true as const,
      item,
    }),
    (error: unknown) => ({
      ok: false as const,
      error,
    }),
  )
  if (!json.ok) {
    return {
      ok: false,
      code: "manifest_read_failed",
      file,
      error: json.error,
    }
  }

  if (json.item["oc-plugin"] === undefined) {
    return {
      ok: true,
    }
  }

  const targets = parseTargets(json.item["oc-plugin"])
  if (!targets.length) {
    return {
      ok: false,
      code: "manifest_no_targets",
      file,
    }
  }

  return {
    ok: true,
    targets,
  }
}

export async function patchPluginConfig(input: PatchInput): Promise<PatchResult> {
  const file = await cfgFile(input)
  using _ = await Lock.write(`plugin-config:${Filesystem.resolve(file)}`)

  const src = await Filesystem.readText(file).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return "{}"
    return err
  })
  if (src instanceof Error) {
    return {
      ok: false,
      code: "patch_failed",
      file,
      error: src,
    }
  }

  const text = src.trim() ? src : "{}"
  const errs: JsoncParseError[] = []
  const data = parseJsonc(text, errs, { allowTrailingComma: true })
  if (errs.length) {
    const err = errs[0]
    const lines = text.substring(0, err.offset).split("\n")
    return {
      ok: false,
      code: "invalid_json",
      file,
      line: lines.length,
      col: lines[lines.length - 1].length + 1,
      parse: printParseErrorCode(err.error),
    }
  }

  const next = patchList(text, pluginList(data), input.spec, input.item ?? input.spec, Boolean(input.force))
  if (next.mode === "noop") {
    return {
      ok: true,
      file,
      mode: next.mode,
    }
  }

  const write = await Filesystem.write(file, next.text).then(
    () => undefined,
    (error: unknown) => error,
  )
  if (write) {
    return {
      ok: false,
      code: "patch_failed",
      file,
      error: write,
    }
  }

  return {
    ok: true,
    file,
    mode: next.mode,
  }
}
