import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Filesystem } from "@/util/filesystem"
import { Log } from "@/util/log"
import { git } from "@/util/git"
import { FileWatcher } from "@/file/watcher"
import { Snapshot } from "../snapshot"
import { Instance } from "./instance"
import { Effect, Layer, ServiceMap } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { makeRunPromise } from "@/effect/run-service"
import path from "path"
import z from "zod"

const log = Log.create({ service: "vcs" })

export namespace Vcs {
  export const Info = z
    .object({
      branch: z.string().optional(),
      default_branch: z.string().optional(),
      head: z.string().optional(),
      dirty: z.boolean(),
    })
    .meta({
      ref: "VcsInfo",
    })
  export type Info = z.infer<typeof Info>

  export const Event = {
    BranchUpdated: BusEvent.define("vcs.branch.updated", Info),
  }

  export const DiffMode = z.enum(["working_tree", "range"])
  export type DiffMode = z.infer<typeof DiffMode>

  export const Diff = z
    .object({
      mode: DiffMode,
      base: z.string().optional(),
      head: z.string().optional(),
    })
    .meta({
      ref: "VcsDiff",
    })
  export type Diff = z.infer<typeof Diff>

  type State = {
    info: Info
    unsubscribe?: () => void
  }

  interface Interface {
    readonly init: () => Effect.Effect<void>
    readonly status: () => Effect.Effect<Info>
    readonly info: () => Effect.Effect<Info>
    readonly diff: (input: Diff) => Effect.Effect<Snapshot.FileDiff[]>
  }

  class Service extends ServiceMap.Service<Service, Interface>()("@symbolic-agent/Vcs") {}

  function work() {
    return Instance.worktree
  }

  function trim(result: Awaited<ReturnType<typeof git>>) {
    return result.text().trim()
  }

  function output(result: Awaited<ReturnType<typeof git>>) {
    return result.text()
  }

  async function currentBranch() {
    const result = await git(["symbolic-ref", "--quiet", "--short", "HEAD"], {
      cwd: work(),
    })
    if (result.exitCode !== 0) return
    const value = trim(result)
    if (!value || value === "HEAD") return
    return value
  }

  async function currentHead() {
    const result = await git(["rev-parse", "HEAD"], {
      cwd: work(),
    })
    if (result.exitCode !== 0) return
    const value = trim(result)
    if (!value) return
    return value
  }

  async function currentDefaultBranch() {
    const remotes = await git(["remote"], {
      cwd: work(),
    })
    if (remotes.exitCode === 0) {
      const list = trim(remotes)
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean)
      const remote = list.includes("origin") ? "origin" : list.length === 1 ? list[0] : list.includes("upstream") ? "upstream" : ""
      if (remote) {
        const ref = await git(["symbolic-ref", "--quiet", "--short", `refs/remotes/${remote}/HEAD`], {
          cwd: work(),
        })
        if (ref.exitCode === 0) {
          const target = trim(ref)
          if (target.startsWith(`${remote}/`)) return target.slice(remote.length + 1)
        }
      }
    }

    const heads = await git(["for-each-ref", "--format=%(refname:short)", "refs/heads"], {
      cwd: work(),
    })
    if (heads.exitCode !== 0) return

    const list = trim(heads)
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean)

    if (list.includes("main")) return "main"
    if (list.includes("master")) return "master"
    if (list.length === 1) return list[0]
  }

  async function currentDirty() {
    const result = await git(["-c", "core.fsmonitor=false", "status", "--porcelain=v1", "--untracked-files=all"], {
      cwd: work(),
    })
    if (result.exitCode !== 0) return false
    return Boolean(trim(result))
  }

  async function baseStatus(): Promise<Info> {
    if (Instance.project.vcs !== "git") {
      return {
        dirty: false,
      }
    }

    const [current, base, top, busy] = await Promise.all([currentBranch(), currentDefaultBranch(), currentHead(), currentDirty()])
    return {
      branch: current,
      default_branch: base,
      head: top,
      dirty: busy,
    }
  }

  async function current() {
    const next = await baseStatus()
    return next
  }

  function records(input: string) {
    return input.split("\0").filter(Boolean)
  }

  function parseName(input: string, file?: string) {
    if (file) {
      return {
        code: input,
        file,
      }
    }

    const cut = input.indexOf("\t")
    if (cut === -1) return
    return {
      code: input.slice(0, cut),
      file: input.slice(cut + 1),
    }
  }

  function parseNum(input: string) {
    const cut = input.indexOf("\t")
    if (cut === -1) return
    const next = input.indexOf("\t", cut + 1)
    if (next === -1) return
    const add = input.slice(0, cut)
    const del = input.slice(cut + 1, next)
    const file = input.slice(next + 1)
    return {
      file,
      additions: add === "-" ? 0 : Number.parseInt(add, 10),
      deletions: del === "-" ? 0 : Number.parseInt(del, 10),
      binary: add === "-" && del === "-",
    }
  }

  async function show(ref: string, file: string) {
    const result = await git(["show", `${ref}:${file}`], {
      cwd: work(),
    })
    if (result.exitCode !== 0) return ""
    return result.text()
  }

  async function read(file: string) {
    return Filesystem.readText(path.join(work(), file)).catch(() => "")
  }

  function lines(input: string) {
    return input ? input.split(/\r?\n/).length : 0
  }

  async function build(base: string, head: string) {
    const args = ["-c", "core.autocrlf=false", "-c", "core.longpaths=true", "-c", "core.symlinks=true", "-c", "core.quotepath=false"]
    const diff = await git([...args, "diff", "--no-ext-diff", "--name-status", "--no-renames", "-z", base, head, "--", "."], {
      cwd: work(),
    })
    const num = await git([...args, "diff", "--no-ext-diff", "--numstat", "--no-renames", "-z", base, head, "--", "."], {
      cwd: work(),
    })

    if (diff.exitCode !== 0 || num.exitCode !== 0) return []

    const status = new Map<string, Snapshot.FileDiff["status"]>()
    const rows = records(output(diff))
    for (let i = 0; i < rows.length; i += 2) {
      const item = parseName(rows[i] ?? "", rows[i + 1])
      if (!item) continue
      const code = item.code
      const kind = code.startsWith("A") ? "added" : code.startsWith("D") ? "deleted" : "modified"
      status.set(item.file, kind)
    }

    const count = new Map<string, { additions: number; deletions: number; binary: boolean }>()
    for (const row of records(output(num))) {
      const item = parseNum(row)
      if (!item) continue
      count.set(item.file, item)
    }

    const files = new Set([...status.keys(), ...count.keys()])
    const result: Snapshot.FileDiff[] = []

    for (const file of files) {
      const item = count.get(file)
      const binary = item?.binary ?? false
      result.push({
        file,
        before: binary ? "" : await show(base, file),
        after: binary ? "" : await show(head, file),
        additions: binary ? 0 : item?.additions ?? 0,
        deletions: binary ? 0 : item?.deletions ?? 0,
        status: status.get(file),
      })
    }

    return result
  }

  async function workingTree() {
    const top = await git(["rev-parse", "HEAD"], {
      cwd: work(),
    })
    if (top.exitCode !== 0) return []
    const base = trim(top)
    const args = ["-c", "core.autocrlf=false", "-c", "core.longpaths=true", "-c", "core.symlinks=true", "-c", "core.quotepath=false"]
    const diff = await git([...args, "diff", "--no-ext-diff", "--name-status", "--no-renames", "-z", base, "--", "."], {
      cwd: work(),
    })
    const num = await git([...args, "diff", "--no-ext-diff", "--numstat", "--no-renames", "-z", base, "--", "."], {
      cwd: work(),
    })
    const files = await git([...args, "ls-files", "--others", "--exclude-standard", "-z"], {
      cwd: work(),
    })

    if (diff.exitCode !== 0 || num.exitCode !== 0 || files.exitCode !== 0) return []

    const status = new Map<string, Snapshot.FileDiff["status"]>()
    const rows = records(output(diff))
    for (let i = 0; i < rows.length; i += 2) {
      const item = parseName(rows[i] ?? "", rows[i + 1])
      if (!item) continue
      const code = item.code
      const kind = code.startsWith("A") ? "added" : code.startsWith("D") ? "deleted" : "modified"
      status.set(item.file, kind)
    }

    const count = new Map<string, { additions: number; deletions: number; binary: boolean }>()
    for (const row of records(output(num))) {
      const item = parseNum(row)
      if (!item) continue
      count.set(item.file, item)
    }

    const extra = new Set(records(output(files)))
    const result: Snapshot.FileDiff[] = []
    const all = new Set([...status.keys(), ...count.keys(), ...extra])

    for (const file of all) {
      const item = count.get(file)
      const next = extra.has(file)
      const binary = item?.binary ?? false
      const after = binary ? "" : await read(file)
      result.push({
        file,
        before: binary ? "" : next ? "" : await show(base, file),
        after,
        additions: binary ? 0 : next ? lines(after) : item?.additions ?? 0,
        deletions: binary ? 0 : item?.deletions ?? 0,
        status: next ? "added" : status.get(file),
      })
    }

    return result
  }

  const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const state = yield* InstanceState.make<State>(
        Effect.fn("Vcs.state")(function* () {
          if (Instance.project.vcs !== "git") {
            return {
              info: {
                dirty: false,
              },
              unsubscribe: undefined,
            }
          }

          const info = yield* Effect.promise(() => current())
          log.info("initialized", { info })

          const entry: State = {
            info,
            unsubscribe: undefined,
          }

          entry.unsubscribe = Bus.subscribe(FileWatcher.Event.Updated, async (evt) => {
            if (!evt.properties.file.endsWith("HEAD")) return
            const next = await current()
            const prev = entry.info
            if (
              next.branch === prev.branch &&
              next.default_branch === prev.default_branch &&
              next.head === prev.head &&
              next.dirty === prev.dirty
            )
              return

            log.info("updated", {
              from: prev,
              to: next,
            })
            entry.info = next
            Bus.publish(Event.BranchUpdated, next)
          })

          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              entry.unsubscribe?.()
            }),
          )

          return entry
        }),
      )

      const init = Effect.fn("Vcs.init")(function* () {
        yield* InstanceState.get(state)
      })

      const info = Effect.fn("Vcs.info")(function* () {
        return yield* Effect.promise(() => current())
      })

      const diff = Effect.fn("Vcs.diff")(function* (input: Diff) {
        if (Instance.project.vcs !== "git") return []
        if (input.mode === "working_tree") return yield* Effect.promise(() => workingTree())
        if (!input.base || !input.head) return []
        const base = input.base
        const head = input.head
        return yield* Effect.promise(() => build(base, head))
      })

      return Service.of({
        init,
        status: info,
        info,
        diff,
      })
    }),
  )

  const runPromise = makeRunPromise(Service, layer)

  export async function init() {
    void runPromise((svc) => svc.init())
  }

  export async function branch() {
    return (await baseStatus()).branch
  }

  export async function status() {
    return runPromise((svc) => svc.status())
  }

  export async function info() {
    return runPromise((svc) => svc.info())
  }

  export async function diff(input: Diff): Promise<Snapshot.FileDiff[]> {
    return runPromise((svc) => svc.diff(input))
  }
}
