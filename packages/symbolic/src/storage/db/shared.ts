import type { SQLiteTransaction } from "drizzle-orm/sqlite-core"
import type * as schema from "../schema"

export type Journal = {
  sql: string
  timestamp: number
  name: string
}[]

export type Schema = typeof schema

export type Transaction = SQLiteTransaction<"sync", void, Schema>
