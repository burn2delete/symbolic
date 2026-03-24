import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Filesystem } from "@/util/filesystem"
import { Log } from "@/util/log"
import { Git } from "@/git"
import { FileWatcher } from "@/file/watcher"
import { Snapshot } from "../snapshot"
import { Instance } from "./instance"
import { Effect, Layer, ServiceMap } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { makeRunPromise } from "@/effect/run-service"
import path from "path"
import z from "zod"

const log = Log.create({ service: "vcs" })

function count(text: string) {
  if (!text) return 0
  if (!text.endsWith("\n")) return text.split("\n").length
  return text.slice(0, -1).split("\n").length
}

async function read(file: string) {
  const full = path.join(Instance.directory, file)
  if (!(await Filesystem.exists(full))) return ""
  const buf = await Filesystem.readBytes(full).catch(() => Buffer.alloc(0))
  if (buf.includes(0)) return ""
  return buf.toString("utf8")
}

function stats(list: Git.Stat[]) {
  const out = new Map<string, { additions: number; deletions: number }>()
  for (const item of list) {
    out.set(item.file, {
      additions: item.additions,
      deletions: item.deletions,
    })
  }
  return out
}

function merge(...lists: Git.Item[][]) {
  const out = new Map<string, Git.Item>()
  for (const list of lists) {
    for (const item of list) {
      if (!out.has(item.file)) out.set(item.file, item)
    }
  }
  return [...out.values()]
}

async function files(ref: string | undefined, list: Git.Item[], nums: Map<string, { additions: number; deletions: number }>) {
  const prefix = ref ? await Git.prefix(Instance.directory) : ""
  const next = await Promise.all(
    list.map(async (item) => {
      const before = item.status === "added" || !ref ? "" : await Git.show(Instance.directory, ref, item.file, prefix)
      const after = item.status === "deleted" ? "" : await read(item.file)
      const stat = nums.get(item.file)
      return {
        file: item.file,
        before,
        after,
        additions: stat?.additions ?? (item.status === "added" ? count(after) : 0),
        deletions: stat?.deletions ?? (item.status === "deleted" ? count(before) : 0),
        status: item.status,
      } satisfies Snapshot.FileDiff
    }),
  )
  return next.toSorted((a, b) => a.file.localeCompare(b.file))
}

async function track(ref: string | undefined) {
  if (!ref) {
    return files(undefined, await Git.status(Instance.directory), new Map())
  }
  const [list, nums] = await Promise.all([Git.status(Instance.directory), Git.stats(Instance.directory, ref)])
  return files(ref, list, stats(nums))
}

async function compare(ref: string) {
  const [list, nums, extra] = await Promise.all([
    Git.diff(Instance.directory, ref),
    Git.stats(Instance.directory, ref),
    Git.status(Instance.directory),
  ])
  return files(
    ref,
    merge(
      list,
      extra.filter((item) => item.code === "??"),
    ),
    stats(nums),
  )
}

async function currentHead() {
  const result = await Git.run(["rev-parse", "HEAD"], {
    cwd: Instance.directory,
  })
  if (result.exitCode !== 0) return
  const text = result.text().trim()
  return text || undefined
}

async function currentDirty() {
  return Boolean((await Git.status(Instance.directory)).length)
}

export namespace Vcs {
  export const Mode = z.enum(["git", "branch"])
  export type Mode = z.infer<typeof Mode>

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

  export const Diff = z
    .object({
      mode: Mode,
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

  async function baseStatus(): Promise<Info> {
    if (Instance.project.vcs !== "git") {
      return {
        dirty: false,
      }
    }

    const [branch, base, head, dirty] = await Promise.all([
      Git.branch(Instance.directory),
      Git.defaultBranch(Instance.directory),
      currentHead(),
      currentDirty(),
    ])

    return {
      branch,
      default_branch: base?.name,
      head,
      dirty,
    }
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
            }
          }

          const info = yield* Effect.promise(() => baseStatus())
          log.info("initialized", { info })

          const entry: State = {
            info,
          }

          entry.unsubscribe = Bus.subscribe(FileWatcher.Event.Updated, async (evt) => {
            if (!evt.properties.file.endsWith("HEAD")) return
            const next = await baseStatus()
            const prev = entry.info
            if (
              next.branch === prev.branch &&
              next.default_branch === prev.default_branch &&
              next.head === prev.head &&
              next.dirty === prev.dirty
            )
              return

            log.info("updated", { from: prev, to: next })
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
        return yield* Effect.promise(() => baseStatus())
      })

      const diff = Effect.fn("Vcs.diff")(function* (input: Diff) {
        if (Instance.project.vcs !== "git") return []

        if (input.mode === "git") {
          const head = yield* Effect.promise(() => Git.hasHead(Instance.directory))
          return yield* Effect.promise(() => track(head ? "HEAD" : undefined))
        }

        const current = yield* Effect.promise(() => Git.branch(Instance.directory))
        const base = yield* Effect.promise(() => Git.defaultBranch(Instance.directory))
        if (!base) return []
        if (current && current === base.name) return []
        const ref = yield* Effect.promise(() => Git.mergeBase(Instance.directory, base.ref))
        if (!ref) return []
        return yield* Effect.promise(() => compare(ref))
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
