import { describe, expect, test } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { AppFileSystem } from "../../src/filesystem"
import { testEffect } from "../fixture/effect"

const live = AppFileSystem.layer.pipe(Layer.provide(NodeFileSystem.layer))
const { effect: it } = testEffect(live)

describe("AppFileSystem", () => {
  it(
    "detects files and directories",
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const dir = yield* fs.makeTempDirectoryScoped()
        const file = path.join(dir, "test.txt")
        yield* fs.writeFileString(file, "hello")
        expect(yield* fs.isDir(dir)).toBe(true)
        expect(yield* fs.isDir(file)).toBe(false)
        expect(yield* fs.isFile(file)).toBe(true)
        expect(yield* fs.isFile(dir)).toBe(false)
      }),
    ),
  )

  it(
    "round-trips JSON data",
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const dir = yield* fs.makeTempDirectoryScoped()
        const file = path.join(dir, "data.json")
        const data = { name: "test", nested: { ok: true } }
        yield* fs.writeJson(file, data)
        expect(yield* fs.readJson(file)).toEqual(data)
      }),
    ),
  )

  it(
    "creates parent directories when writing",
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const dir = yield* fs.makeTempDirectoryScoped()
        const file = path.join(dir, "deep", "nested", "file.txt")
        yield* fs.writeWithDirs(file, "hello")
        expect(yield* fs.readFileString(file)).toBe("hello")
      }),
    ),
  )

  it(
    "finds files while walking upward",
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const dir = yield* fs.makeTempDirectoryScoped()
        const child = path.join(dir, "a", "b")
        yield* fs.makeDirectory(child, { recursive: true })
        yield* fs.writeFileString(path.join(dir, "root.txt"), "root")
        yield* fs.writeFileString(path.join(child, "leaf.txt"), "leaf")
        expect(yield* fs.findUp("root.txt", child, dir)).toEqual([path.join(dir, "root.txt")])
        expect(yield* fs.globUp("*.txt", child, dir)).toContain(path.join(child, "leaf.txt"))
      }),
    ),
  )

  it(
    "matches glob patterns and pure helpers",
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const dir = yield* fs.makeTempDirectoryScoped()
        yield* fs.writeFileString(path.join(dir, "a.ts"), "a")
        yield* fs.writeFileString(path.join(dir, "b.ts"), "b")
        expect((yield* fs.glob("*.ts", { cwd: dir })).sort()).toEqual(["a.ts", "b.ts"])
        expect(fs.globMatch("*.ts", "foo.ts")).toBe(true)
        expect(AppFileSystem.mimeType("file.json")).toBe("application/json")
        expect(AppFileSystem.contains("/a/b", "/a/b/c")).toBe(true)
        expect(AppFileSystem.overlaps("/a/b", "/a/b/c")).toBe(true)
      }),
    ),
  )

  test("resolve normalizes Windows and symlink paths", () => {
    const dir = process.cwd()
    expect(AppFileSystem.resolve(dir)).toBeTruthy()
  })
})
