import * as driver from "./db/node.ts"
import type { Journal, Query, Raw } from "./db/shared.ts"

export type Client = driver.Client
export type Handle = driver.Handle

export function open(path: string, entries: Journal, skip: boolean) {
  const result = driver.open(path, entries, skip)
  return {
    db: result.db,
    handle: result.handle as Raw,
  }
}

export function wrap(sqlite: Raw) {
  return driver.wrap(sqlite as Handle)
}

export function openReadonly(path: string) {
  return driver.openReadonly(path) as Raw
}

export function query(sqlite: Raw, sql: string): Query[] {
  return driver.query(sqlite as Handle, sql)
}

export function close(sqlite: Raw) {
  driver.close(sqlite as Handle)
}
