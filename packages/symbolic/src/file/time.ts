import { Effect, Layer, ManagedRuntime, ServiceMap } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { Log } from "../util/log"
import { Flag } from "../flag/flag"
import { Filesystem } from "../util/filesystem"

export namespace FileTime {
  const log = Log.create({ service: "file.time" })

  interface State {
    read: {
      [sessionID: string]: {
        [path: string]: Date | undefined
      }
    }
    locks: Map<string, Promise<void>>
  }

  export interface Interface {
    readonly state: () => Effect.Effect<State>
  }

  class Service extends ServiceMap.Service<Service, Interface>()("@symbolic-agent/FileTime") {}
  // Per-session read times plus per-file write locks.
  // All tools that overwrite existing files should run their
  // assert/read/write/update sequence inside withLock(filepath, ...)
  // so concurrent writes to the same file are serialized.
  const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const store = yield* InstanceState.make<State>(
        Effect.fn("FileTime.state")(() =>
          Effect.sync(() => ({
            read: {},
            locks: new Map<string, Promise<void>>(),
          })),
        ),
      )

      const state = Effect.fn("FileTime.state")(function* () {
        return yield* InstanceState.get(store)
      })

      return Service.of({ state })
    }),
  )

  const runtime = ManagedRuntime.make(layer)

  function runSync<A>(fn: (svc: Interface) => Effect.Effect<A>) {
    return runtime.runSync(Service.use(fn))
  }

  function state() {
    return runSync((svc) => svc.state())
  }

  export function read(sessionID: string, file: string) {
    log.info("read", { sessionID, file })
    const next = state()
    next.read[sessionID] = next.read[sessionID] || {}
    next.read[sessionID][file] = new Date()
  }

  export function get(sessionID: string, file: string) {
    return state().read[sessionID]?.[file]
  }

  export async function withLock<T>(filepath: string, fn: () => Promise<T>): Promise<T> {
    const current = state()
    const lock = current.locks.get(filepath) ?? Promise.resolve()
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const chain = lock.then(() => gate)
    current.locks.set(filepath, chain)
    await lock
    try {
      return await fn()
    } finally {
      release()
      if (current.locks.get(filepath) === chain) {
        current.locks.delete(filepath)
      }
    }
  }

  export async function assert(sessionID: string, filepath: string) {
    if (Flag.SYMBOLIC_DISABLE_FILETIME_CHECK === true) {
      return
    }

    const time = get(sessionID, filepath)
    if (!time) throw new Error(`You must read file ${filepath} before overwriting it. Use the Read tool first`)
    const mtime = Filesystem.stat(filepath)?.mtime
    // Allow a 50ms tolerance for Windows NTFS timestamp fuzziness / async flushing
    if (mtime && mtime.getTime() > time.getTime() + 50) {
      throw new Error(
        `File ${filepath} has been modified since it was last read.\nLast modification: ${mtime.toISOString()}\nLast read: ${time.toISOString()}\n\nPlease read the file again before modifying it.`,
      )
    }
  }
}
