import { Context } from "../util/context"
import { lazy } from "../util/lazy"
import { Global } from "../global"
import { Log } from "../util/log"
import { NamedError } from "@symbolic-agent/util/error"
import z from "zod"
import path from "path"
import { readFileSync, readdirSync, existsSync } from "fs"
import { Installation } from "../installation"
import { Flag } from "../flag/flag"
import { iife } from "../util/iife"
import { close as closeDriver, open, openReadonly, query as queryDriver } from "#db"
import type { Client as DbClient } from "#db"
import type { Journal, Query, Raw, Transaction } from "./db/shared"

declare const SYMBOLIC_MIGRATIONS: { sql: string; timestamp: number; name: string }[] | undefined

export * from "drizzle-orm"

export const NotFoundError = NamedError.create(
  "NotFoundError",
  z.object({
    message: z.string(),
  }),
)

const log = Log.create({ service: "db" })

type Client = DbClient
const runtime: "bun" | "node" = process.versions.bun ? "bun" : "node"

export namespace Database {
  export const Runtime = runtime

  export function getChannelPath() {
    const channel = Installation.CHANNEL
    if (["latest", "beta"].includes(channel) || Flag.SYMBOLIC_DISABLE_CHANNEL_DB)
      return path.join(Global.Path.data, "symbolic.db")
    const safe = channel.replace(/[^a-zA-Z0-9._-]/g, "-")
    return path.join(Global.Path.data, `symbolic-${safe}.db`)
  }

  export const Path = iife(() => {
    if (Flag.SYMBOLIC_DB) {
      if (Flag.SYMBOLIC_DB === ":memory:" || path.isAbsolute(Flag.SYMBOLIC_DB)) return Flag.SYMBOLIC_DB
      return path.join(Global.Path.data, Flag.SYMBOLIC_DB)
    }
    return getChannelPath()
  })

  const state = {
    sqlite: undefined as Raw | undefined,
  }

  function time(tag: string) {
    const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(tag)
    if (!match) return 0
    return Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6]),
    )
  }

  function migrations(dir: string): Journal {
    const dirs = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)

    const sql = dirs
      .map((name) => {
        const file = path.join(dir, name, "migration.sql")
        if (!existsSync(file)) return
        return {
          sql: readFileSync(file, "utf-8"),
          timestamp: time(name),
          name,
        }
      })
      .filter(Boolean) as Journal

    return sql.sort((a, b) => a.timestamp - b.timestamp)
  }

  export const Client = lazy(() => {
    log.info("opening database", { path: Path })

    const entries =
      typeof SYMBOLIC_MIGRATIONS !== "undefined"
        ? SYMBOLIC_MIGRATIONS
        : migrations(path.join(import.meta.dirname, "../../migration"))
    if (entries.length > 0) {
      log.info("applying migrations", {
        count: entries.length,
        mode: typeof SYMBOLIC_MIGRATIONS !== "undefined" ? "bundled" : "dev",
      })
    }

    const { db, handle } = open(Path, entries, Flag.SYMBOLIC_SKIP_MIGRATIONS)
    state.sqlite = handle
    return db
  })

  export function close() {
    const sqlite = state.sqlite
    if (!sqlite) return
    closeDriver(sqlite)
    state.sqlite = undefined
    Client.reset()
  }

  export type TxOrDb = Transaction | Client

  export function query(sql: string): Query[] {
    const sqlite = openReadonly(Path)
    try {
      return queryDriver(sqlite, sql)
    } finally {
      closeDriver(sqlite)
    }
  }

  export function raw(): Raw {
    return Client().$client
  }

  const ctx = Context.create<{
    tx: TxOrDb
    effects: (() => void | Promise<void>)[]
  }>("database")

  export function use<T>(callback: (trx: TxOrDb) => T): T {
    try {
      return callback(ctx.use().tx)
    } catch (err) {
      if (err instanceof Context.NotFound) {
        const effects: (() => void | Promise<void>)[] = []
        const result = ctx.provide({ effects, tx: Client() }, () => callback(Client()))
        for (const effect of effects) effect()
        return result
      }
      throw err
    }
  }

  export function effect(fn: () => any | Promise<any>) {
    try {
      ctx.use().effects.push(fn)
    } catch {
      fn()
    }
  }

  type NotPromise<T> = T extends Promise<any> ? never : T

  export function transaction<T>(
    callback: (tx: TxOrDb) => NotPromise<T>,
    options?: {
      behavior?: "deferred" | "immediate" | "exclusive"
    },
  ): NotPromise<T> {
    try {
      return callback(ctx.use().tx)
    } catch (err) {
      if (err instanceof Context.NotFound) {
        const effects: (() => void | Promise<void>)[] = []
        const result = (Client().transaction as any)(
          (tx: TxOrDb) => {
            return ctx.provide({ tx, effects }, () => callback(tx))
          },
          { behavior: options?.behavior },
        )
        for (const effect of effects) effect()
        return result as NotPromise<T>
      }
      throw err
    }
  }
}
