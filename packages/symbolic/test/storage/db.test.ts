import { describe, expect, test } from "bun:test"
import path from "path"
import { Global } from "../../src/global"
import { Installation } from "../../src/installation"
import { Database } from "../../src/storage/db"

const root = path.join(import.meta.dir, "../..")

function resolve(db?: string) {
  if (db) {
    if (path.isAbsolute(db)) return db
    return path.join(Global.Path.data, db)
  }

  if (["latest", "beta"].includes(Installation.CHANNEL)) {
    return path.join(Global.Path.data, "symbolic.db")
  }

  return path.join(Global.Path.data, `symbolic-${Installation.CHANNEL.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`)
}

function probe(db: string) {
  const child = Bun.spawnSync({
    cmd: [
      process.execPath,
      "-e",
      `import { Database } from "./src/storage/db"; console.log(Database.Path)`,
    ],
    cwd: root,
    env: {
      ...process.env,
      SYMBOLIC_DB: db,
    },
    stdout: "pipe",
    stderr: "pipe",
  })

  expect(child.exitCode).toBe(0)
  return child.stdout.toString().trim()
}

describe("Database.Path", () => {
  test("returns database path for the current channel", () => {
    expect(Database.Path).toBe(resolve(process.env["SYMBOLIC_DB"]))
  })

  test("resolves relative overrides under the data dir", () => {
    expect(probe("custom.db")).toBe(path.join(Global.Path.data, "custom.db"))
  })

  test("keeps absolute overrides as-is", () => {
    expect(probe("/tmp/symbolic-test.db")).toBe("/tmp/symbolic-test.db")
  })
})

describe("Database.close", () => {
  test("resets the cached client", () => {
    const first = Database.Client()
    Database.close()
    const second = Database.Client()

    expect(second).not.toBe(first)
  })
})
