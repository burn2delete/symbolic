import { describe, expect, test } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"
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

function nodeProbe(db: string) {
  const file = pathToFileURL(path.join(root, "src/storage/db/node.ts")).href
  const child = Bun.spawnSync({
    cmd: [
      "node",
      "--experimental-strip-types",
      "--input-type=module",
      "-e",
      `const mod = await import(${JSON.stringify(file)}); const item = mod.open(${JSON.stringify(resolve(db))}, [], true); mod.close(item.handle); const sqlite = mod.openReadonly(${JSON.stringify(resolve(db))}); console.log("node\\n" + mod.query(sqlite, "select 1 as value")[0]?.value); mod.close(sqlite)`,
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
  return child.stdout.toString().trim().split("\n")
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

  test("loads the node runtime driver", () => {
    const [runtime, value] = nodeProbe("node-custom.db")
    expect(runtime).toBe("node")
    expect(value).toBe("1")
  })
})

describe("Database.close", () => {
  test("resets the cached client", () => {
    const first = Database.Client()
    Database.close()
    const second = Database.Client()

    expect(second).not.toBe(first)
  })

  test("queries through the active runtime helper", () => {
    expect(Database.query("select 1 as value")).toEqual([{ value: 1 }])
  })
})
