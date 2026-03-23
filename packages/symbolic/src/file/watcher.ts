import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import { Effect, Layer, ServiceMap } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { makeRunPromise } from "@/effect/run-service"
import { Log } from "../util/log"
import { FileIgnore } from "./ignore"
import { Config } from "../config/config"
import path from "path"
// @ts-ignore
import { createWrapper } from "@parcel/watcher/wrapper"
import { lazy } from "@/util/lazy"
import { withTimeout } from "@/util/timeout"
import type ParcelWatcher from "@parcel/watcher"
import { Flag } from "@/flag/flag"
import { Instance } from "@/project/instance"
import { readdir } from "fs/promises"
import { git } from "@/util/git"
import { Protected } from "./protected"

const SUBSCRIBE_TIMEOUT_MS = 10_000

declare const SYMBOLIC_LIBC: string | undefined

export namespace FileWatcher {
  const log = Log.create({ service: "file.watcher" })

  export const Event = {
    Updated: BusEvent.define(
      "file.watcher.updated",
      z.object({
        file: z.string(),
        event: z.union([z.literal("add"), z.literal("change"), z.literal("unlink")]),
      }),
    ),
  }

  const watcher = lazy((): typeof import("@parcel/watcher") | undefined => {
    try {
      const binding = require(
        `@parcel/watcher-${process.platform}-${process.arch}${process.platform === "linux" ? `-${SYMBOLIC_LIBC || "glibc"}` : ""}`,
      )
      return createWrapper(binding) as typeof import("@parcel/watcher")
    } catch (error) {
      log.error("failed to load watcher binding", { error })
      return
    }
  })

  interface State {
    subs: ParcelWatcher.AsyncSubscription[]
  }

  interface Interface {
    readonly init: () => Effect.Effect<void>
  }

  class Service extends ServiceMap.Service<Service, Interface>()("@symbolic-agent/FileWatcher") {}

  const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const state = yield* InstanceState.make<State>(
        Effect.fn("FileWatcher.state")(function* () {
          log.info("init")
          const cfg = yield* Effect.promise(() => Config.get())
          const backend = (() => {
            if (process.platform === "win32") return "windows"
            if (process.platform === "darwin") return "fs-events"
            if (process.platform === "linux") return "inotify"
          })()
          if (!backend) {
            log.error("watcher backend not supported", { platform: process.platform })
            return { subs: [] }
          }
          log.info("watcher backend", { platform: process.platform, backend })

          const w = watcher()
          if (!w) return { subs: [] }

          const subscribe: ParcelWatcher.SubscribeCallback = (err, evts) => {
            if (err) return
            for (const evt of evts) {
              if (evt.type === "create") Bus.publish(Event.Updated, { file: evt.path, event: "add" })
              if (evt.type === "update") Bus.publish(Event.Updated, { file: evt.path, event: "change" })
              if (evt.type === "delete") Bus.publish(Event.Updated, { file: evt.path, event: "unlink" })
            }
          }

          const subs: ParcelWatcher.AsyncSubscription[] = []
          yield* Effect.addFinalizer(() =>
            Effect.promise(async () => {
              await Promise.all(subs.map((sub) => sub?.unsubscribe()))
            }),
          )

          const cfgIgnores = cfg.watcher?.ignore ?? []

          if (Flag.SYMBOLIC_EXPERIMENTAL_FILEWATCHER) {
            const pending = w.subscribe(Instance.directory, subscribe, {
              ignore: [...FileIgnore.PATTERNS, ...cfgIgnores, ...Protected.paths()],
              backend,
            })
            const sub = yield* Effect.promise(() =>
              withTimeout(pending, SUBSCRIBE_TIMEOUT_MS).catch((err) => {
                log.error("failed to subscribe to Instance.directory", { error: err })
                pending.then((s) => s.unsubscribe()).catch(() => {})
                return undefined
              }),
            )
            if (sub) subs.push(sub)
          }

          if (Instance.project.vcs === "git") {
            const result = yield* Effect.promise(() =>
              git(["rev-parse", "--git-dir"], {
                cwd: Instance.worktree,
              }),
            )
            const vcsDir = result.exitCode === 0 ? path.resolve(Instance.worktree, result.text().trim()) : undefined
            if (vcsDir && !cfgIgnores.includes(".git") && !cfgIgnores.includes(vcsDir)) {
              const gitDirContents = yield* Effect.promise(() => readdir(vcsDir).catch(() => [] as string[]))
              const ignoreList = gitDirContents.filter((entry) => entry !== "HEAD")
              const pending = w.subscribe(vcsDir, subscribe, {
                ignore: ignoreList,
                backend,
              })
              const sub = yield* Effect.promise(() =>
                withTimeout(pending, SUBSCRIBE_TIMEOUT_MS).catch((err) => {
                  log.error("failed to subscribe to vcsDir", { error: err })
                  pending.then((s) => s.unsubscribe()).catch(() => {})
                  return undefined
                }),
              )
              if (sub) subs.push(sub)
            }
          }

          return { subs }
        }),
      )

      const init = Effect.fn("FileWatcher.init")(function* () {
        yield* InstanceState.get(state)
      })

      return Service.of({ init })
    }),
  )

  const runPromise = makeRunPromise(Service, layer)

  export function init() {
    if (Flag.SYMBOLIC_EXPERIMENTAL_DISABLE_FILEWATCHER) {
      return
    }
    void runPromise((svc) => svc.init()).catch((error) => {
      log.error("failed to initialize file watcher", { error })
    })
  }
}
