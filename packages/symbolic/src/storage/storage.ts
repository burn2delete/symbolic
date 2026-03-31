import { Effect, Exit, Layer, Option, Schema, ServiceMap } from "effect"
import { AppFileSystem } from "@/filesystem"
import { makeRunPromise } from "@/effect/run-service"
import { Log } from "../util/log"
import path from "path"
import { Global } from "../global"
import { NamedError } from "@symbolic-agent/util/error"
import z from "zod"
import { Git } from "@/git"
import { Lock } from "@/util/lock"

export namespace Storage {
  const log = Log.create({ service: "storage" })

  type Migration = (dir: string, fs: AppFileSystem.Interface) => Effect.Effect<void, AppFileSystem.Error>

  export const NotFoundError = NamedError.create(
    "NotFoundError",
    z.object({
      message: z.string(),
    }),
  )

  export type Error = AppFileSystem.Error | InstanceType<typeof NotFoundError>

  const RootFile = Schema.Struct({
    path: Schema.optional(
      Schema.Struct({
        root: Schema.optional(Schema.String),
      }),
    ),
  })

  const SessionFile = Schema.Struct({
    id: Schema.String,
  })

  const MessageFile = Schema.Struct({
    id: Schema.String,
  })

  const DiffFile = Schema.Struct({
    additions: Schema.Number,
    deletions: Schema.Number,
  })

  const SummaryFile = Schema.Struct({
    id: Schema.String,
    projectID: Schema.String,
    summary: Schema.Struct({ diffs: Schema.Array(DiffFile) }),
  })

  const decodeRoot = Schema.decodeUnknownOption(RootFile)
  const decodeSession = Schema.decodeUnknownOption(SessionFile)
  const decodeMessage = Schema.decodeUnknownOption(MessageFile)
  const decodeSummary = Schema.decodeUnknownOption(SummaryFile)

  export interface Interface {
    readonly remove: (key: string[]) => Effect.Effect<void, AppFileSystem.Error>
    readonly read: <T>(key: string[]) => Effect.Effect<T, Error>
    readonly update: <T>(key: string[], fn: (draft: T) => void) => Effect.Effect<T, Error>
    readonly write: <T>(key: string[], content: T) => Effect.Effect<void, AppFileSystem.Error>
    readonly list: (prefix: string[]) => Effect.Effect<string[][], AppFileSystem.Error>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@symbolic-agent/Storage") {}

  function file(dir: string, key: string[]) {
    return path.join(dir, ...key) + ".json"
  }

  function missing(err: unknown) {
    if (!err || typeof err !== "object") return false
    if ("code" in err && err.code === "ENOENT") return true
    if (!("reason" in err)) return false
    if (!err.reason || typeof err.reason !== "object") return false
    if (!("_tag" in err.reason)) return false
    return err.reason._tag === "NotFound"
  }

  function parseMigration(text: string) {
    const value = Number.parseInt(text, 10)
    return Number.isNaN(value) ? 0 : value
  }

  const MIGRATIONS: Migration[] = [
    Effect.fn("Storage.migration.1")(function* (dir: string, fs: AppFileSystem.Interface) {
      const project = path.resolve(dir, "../project")
      if (!(yield* fs.isDir(project))) return
      const dirs = yield* fs.glob("*", {
        cwd: project,
        include: "all",
      })
      for (const projectDir of dirs) {
        const full = path.join(project, projectDir)
        if (!(yield* fs.isDir(full))) continue
        log.info(`migrating project ${projectDir}`)
        let id = projectDir
        let worktree = "/"

        if (id !== "global") {
          for (const msg of yield* fs.glob("storage/session/message/*/*.json", {
            cwd: full,
            absolute: true,
          })) {
            const root = decodeRoot(yield* fs.readJson(msg), { onExcessProperty: "preserve" })
            const next = Option.isSome(root) ? root.value.path?.root : undefined
            if (!next) continue
            worktree = next
            break
          }
          if (!worktree) continue
          if (!(yield* fs.isDir(worktree))) continue
          const result = yield* Effect.promise(() =>
            Git.run(["rev-list", "--max-parents=0", "--all"], {
              cwd: worktree,
            }),
          )
          const [first] = result
            .text()
            .split("\n")
            .filter(Boolean)
            .map((item) => item.trim())
            .toSorted()
          if (!first) continue
          id = first

          yield* fs.writeWithDirs(
            path.join(dir, "project", id + ".json"),
            JSON.stringify(
              {
                id,
                vcs: "git",
                worktree,
                time: {
                  created: Date.now(),
                  initialized: Date.now(),
                },
              },
              null,
              2,
            ),
          )

          log.info(`migrating sessions for project ${id}`)
          for (const sessionFile of yield* fs.glob("storage/session/info/*.json", {
            cwd: full,
            absolute: true,
          })) {
            const dest = path.join(dir, "session", id, path.basename(sessionFile))
            log.info("copying", { sessionFile, dest })
            const session = yield* fs.readJson(sessionFile)
            const info = decodeSession(session, { onExcessProperty: "preserve" })
            yield* fs.writeWithDirs(dest, JSON.stringify(session, null, 2))
            if (Option.isNone(info)) continue

            log.info(`migrating messages for session ${info.value.id}`)
            for (const msgFile of yield* fs.glob(`storage/session/message/${info.value.id}/*.json`, {
              cwd: full,
              absolute: true,
            })) {
              const next = path.join(dir, "message", info.value.id, path.basename(msgFile))
              log.info("copying", { msgFile, dest: next })
              const message = yield* fs.readJson(msgFile)
              const item = decodeMessage(message, { onExcessProperty: "preserve" })
              yield* fs.writeWithDirs(next, JSON.stringify(message, null, 2))
              if (Option.isNone(item)) continue

              log.info(`migrating parts for message ${item.value.id}`)
              for (const partFile of yield* fs.glob(`storage/session/part/${info.value.id}/${item.value.id}/*.json`, {
                cwd: full,
                absolute: true,
              })) {
                const out = path.join(dir, "part", item.value.id, path.basename(partFile))
                const part = yield* fs.readJson(partFile)
                log.info("copying", { partFile, dest: out })
                yield* fs.writeWithDirs(out, JSON.stringify(part, null, 2))
              }
            }
          }
        }
      }
    }),
    Effect.fn("Storage.migration.2")(function* (dir: string, fs: AppFileSystem.Interface) {
      for (const item of yield* fs.glob("session/*/*.json", {
        cwd: dir,
        absolute: true,
      })) {
        const raw = yield* fs.readJson(item)
        const session = decodeSummary(raw, { onExcessProperty: "preserve" })
        if (Option.isNone(session)) continue
        const diffs = session.value.summary.diffs
        yield* fs.writeWithDirs(path.join(dir, "session_diff", session.value.id + ".json"), JSON.stringify(diffs, null, 2))
        yield* fs.writeWithDirs(
          path.join(dir, "session", session.value.projectID, session.value.id + ".json"),
          JSON.stringify(
            {
              ...(raw as Record<string, unknown>),
              summary: {
                additions: diffs.reduce((sum, item) => sum + item.additions, 0),
                deletions: diffs.reduce((sum, item) => sum + item.deletions, 0),
              },
            },
            null,
            2,
          ),
        )
      }
    }),
  ]

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      const state = yield* Effect.cached(
        Effect.gen(function* () {
          const dir = path.join(Global.Path.data, "storage")
          const marker = path.join(dir, "migration")
          const migration = yield* fs.readFileString(marker).pipe(
            Effect.map(parseMigration),
            Effect.catchIf(missing, () => Effect.succeed(0)),
            Effect.orElseSucceed(() => 0),
          )
          for (let i = migration; i < MIGRATIONS.length; i++) {
            log.info("running migration", { index: i })
            const step = MIGRATIONS[i]!
            const exit = yield* Effect.exit(step(dir, fs))
            if (Exit.isFailure(exit)) {
              log.error("failed to run migration", { index: i, cause: exit.cause })
              break
            }
            yield* fs.writeWithDirs(marker, String(i + 1))
          }
          return { dir }
        }),
      )

      const fail = (target: string): Effect.Effect<never, InstanceType<typeof NotFoundError>> =>
        Effect.fail(new NotFoundError({ message: `Resource not found: ${target}` }))

      const wrap = <A>(target: string, body: Effect.Effect<A, AppFileSystem.Error>) =>
        body.pipe(Effect.catchIf(missing, () => fail(target)))

      const writeJson = Effect.fnUntraced(function* (target: string, content: unknown) {
        yield* fs.writeWithDirs(target, JSON.stringify(content, null, 2))
      })

      const release = (lock: Disposable) => Effect.sync(() => lock[Symbol.dispose]())

      const withRead = <A, E>(target: string, body: Effect.Effect<A, E>) =>
        Effect.acquireUseRelease(Effect.promise(() => Lock.read(target)), () => body, release)

      const withWrite = <A, E>(target: string, body: Effect.Effect<A, E>) =>
        Effect.acquireUseRelease(Effect.promise(() => Lock.write(target)), () => body, release)

      const withResolved = <A, E>(key: string[], fn: (target: string) => Effect.Effect<A, E>) =>
        Effect.gen(function* () {
          return yield* fn(file((yield* state).dir, key))
        })

      const remove: Interface["remove"] = Effect.fn("Storage.remove")(function* (key: string[]) {
        yield* withResolved(key, (target) =>
          withWrite(target, fs.remove(target).pipe(Effect.catchIf(missing, () => Effect.void))),
        )
      })

      const read: Interface["read"] = <T>(key: string[]) =>
        Effect.gen(function* () {
          const value = yield* withResolved(key, (target) => withRead(target, wrap(target, fs.readJson(target))))
          return value as T
        })

      const update: Interface["update"] = <T>(key: string[], fn: (draft: T) => void) =>
        Effect.gen(function* () {
          const value = yield* withResolved(key, (target) =>
            withWrite(
              target,
              Effect.gen(function* () {
                const content = yield* wrap(target, fs.readJson(target))
                fn(content as T)
                yield* writeJson(target, content)
                return content
              }),
            ),
          )
          return value as T
        })

      const write: Interface["write"] = (key: string[], content: unknown) =>
        Effect.gen(function* () {
          yield* withResolved(key, (target) => withWrite(target, writeJson(target, content)))
        })

      const list: Interface["list"] = Effect.fn("Storage.list")(function* (prefix: string[]) {
        const dir = (yield* state).dir
        const cwd = path.join(dir, ...prefix)
        const items = yield* fs
          .glob("**/*", {
            cwd,
            include: "file",
          })
          .pipe(Effect.catch(() => Effect.succeed<string[]>([])))
        return items
          .map((item) => [...prefix, ...item.slice(0, -5).split(path.sep)])
          .toSorted((left, right) => left.join("/").localeCompare(right.join("/")))
      })

      return Service.of({
        remove,
        read,
        update,
        write,
        list,
      })
    }),
  )

  export const defaultLayer = layer.pipe(Layer.provide(AppFileSystem.defaultLayer))

  const runPromise = makeRunPromise(Service, defaultLayer)

  export async function remove(key: string[]) {
    return runPromise((svc) => svc.remove(key))
  }

  export async function read<T>(key: string[]) {
    return runPromise((svc) => svc.read<T>(key))
  }

  export async function update<T>(key: string[], fn: (draft: T) => void) {
    return runPromise((svc) => svc.update<T>(key, fn))
  }

  export async function write<T>(key: string[], content: T) {
    return runPromise((svc) => svc.write(key, content))
  }

  export async function list(prefix: string[]) {
    return runPromise((svc) => svc.list(prefix))
  }
}
