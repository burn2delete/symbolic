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
import type * as BunDriver from "./db/bun"
import type * as NodeDriver from "./db/node"
import type { Client as DbClient } from "./db/bun"
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

type Driver = {
  open(path: string, entries: Journal, skip: boolean): {
    db: Client
    handle: Raw
  }
  wrap(sqlite: Raw): Client
  openReadonly(path: string): Raw
  query(sqlite: Raw, sql: string): Query[]
  close(sqlite: Raw): void
}

const runtime: "bun" | "node" = process.versions.bun ? "bun" : "node"
const driver: Driver = (runtime === "bun" ? await import("./db/bun") : await import("./db/node")) as unknown as Driver

export namespace Database {
  export const Runtime = runtime

  export const Path = iife(() => {
    if (Flag.SYMBOLIC_DB) {
      if (path.isAbsolute(Flag.SYMBOLIC_DB)) return Flag.SYMBOLIC_DB
      return path.join(Global.Path.data, Flag.SYMBOLIC_DB)
    }
    const channel = Installation.CHANNEL
    if (["latest", "beta"].includes(channel) || Flag.SYMBOLIC_DISABLE_CHANNEL_DB)
      return path.join(Global.Path.data, "symbolic.db")
    const safe = channel.replace(/[^a-zA-Z0-9._-]/g, "-")
    return path.join(Global.Path.data, `symbolic-${safe}.db`)
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

    const { db, handle } = driver.open(Path, entries, Flag.SYMBOLIC_SKIP_MIGRATIONS)
    state.sqlite = handle
    return db
  })

  export function close() {
    const sqlite = state.sqlite
    if (!sqlite) return
    driver.close(sqlite)
    state.sqlite = undefined
    Client.reset()
  }

  export type TxOrDb = Transaction | Client

  export function query(sql: string): Query[] {
    const sqlite = driver.openReadonly(Path)
    try {
      return driver.query(sqlite, sql)
    } finally {
      driver.close(sqlite)
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

  export function transaction<T>(callback: (tx: TxOrDb) => T): T {
    try {
      return callback(ctx.use().tx)
    } catch (err) {
      if (err instanceof Context.NotFound) {
        const effects: (() => void | Promise<void>)[] = []
        const db = Client()
        const run = db.transaction.bind(db) as unknown as (fn: (tx: Transaction) => T) => T
        const result = run((tx) => {
          return ctx.provide({ tx, effects }, () => callback(tx))
        })
        for (const effect of effects) effect()
        return result
      }
      throw err
    }
  }
}
