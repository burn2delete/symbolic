import { Database as Sqlite } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import type { Journal, Query } from "./shared.ts"

export type Handle = InstanceType<typeof Sqlite>
export type Client = ReturnType<typeof drizzle>

export function open(path: string, entries: Journal, skip: boolean) {
  const sqlite = new Sqlite(path, { create: true })

  sqlite.run("PRAGMA journal_mode = WAL")
  sqlite.run("PRAGMA synchronous = NORMAL")
  sqlite.run("PRAGMA busy_timeout = 5000")
  sqlite.run("PRAGMA cache_size = -64000")
  sqlite.run("PRAGMA foreign_keys = ON")
  sqlite.run("PRAGMA wal_checkpoint(PASSIVE)")

  const db = drizzle({ client: sqlite })
  const list = skip ? entries.map((item) => ({ ...item, sql: "select 1;" })) : entries
  if (list.length > 0) migrate(db, list)

  return {
    handle: sqlite,
    db,
  }
}

export function wrap(sqlite: Handle) {
  return drizzle({ client: sqlite })
}

export function openReadonly(path: string) {
  return new Sqlite(path, { readonly: true })
}

export function query(sqlite: Handle, sql: string) {
  return sqlite.query(sql).all() as Query[]
}

export function close(sqlite: Handle) {
  sqlite.close()
}
