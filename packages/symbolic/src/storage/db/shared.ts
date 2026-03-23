import type { SQLiteTransaction } from "drizzle-orm/sqlite-core"
import type * as schema from "../schema"

export type Journal = {
  sql: string
  timestamp: number
  name: string
}[]

export type Schema = typeof schema

export type Transaction = SQLiteTransaction<"sync", void, Schema>

export type Query = Record<string, unknown>

export type Raw = {
  exec(sql: string): unknown
  close(): void
}

export type Client = {
  $client: Raw
  insert(table: unknown): {
    values(values: unknown[]): {
      onConflictDoNothing(): {
        run(): unknown
      }
    }
  }
}
