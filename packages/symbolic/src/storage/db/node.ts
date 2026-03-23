import Sqlite from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import type { Journal } from "./shared"

type Handle = InstanceType<typeof Sqlite>

export type Client = ReturnType<typeof drizzle>
export type { Handle }

export function open(path: string, entries: Journal, skip: boolean) {
  const sqlite = new Sqlite(path)

  sqlite.pragma("journal_mode = WAL")
  sqlite.pragma("synchronous = NORMAL")
  sqlite.pragma("busy_timeout = 5000")
  sqlite.pragma("cache_size = -64000")
  sqlite.pragma("foreign_keys = ON")
  sqlite.pragma("wal_checkpoint(PASSIVE)")

  const db = drizzle({ client: sqlite })
  const list = skip ? entries.map((item) => ({ ...item, sql: "select 1;" })) : entries
  for (const item of list) {
    sqlite.exec(item.sql)
  }

  return {
    handle: sqlite,
    db,
  }
}

export function close(sqlite: Handle) {
  sqlite.close()
}
