import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Global } from "../../src/global"
import { Storage } from "../../src/storage/storage"

describe("storage", () => {
  const dir = path.join(Global.Path.data, "storage")

  beforeEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  test("writes, reads, updates, and lists keys", async () => {
    await Storage.write(["session", "b", "two"], { count: 2 })
    await Storage.write(["session", "a", "one"], { count: 1 })

    expect(await Storage.list(["session"])).toEqual([
      ["session", "a", "one"],
      ["session", "b", "two"],
    ])
    expect(await Storage.read<{ count: number }>(["session", "a", "one"])).toEqual({ count: 1 })
    expect(
      await Storage.update<{ count: number }>(["session", "a", "one"], (draft) => {
        draft.count += 2
      }),
    ).toEqual({ count: 3 })
    expect(await Storage.read<{ count: number }>(["session", "a", "one"])).toEqual({ count: 3 })
  })

  test("remove ignores missing keys and deletes existing files", async () => {
    await expect(Storage.remove(["session", "missing"])).resolves.toBeUndefined()

    await Storage.write(["session", "a", "one"], { count: 1 })
    await expect(Storage.remove(["session", "a", "one"])).resolves.toBeUndefined()
    await expect(Storage.read(["session", "a", "one"])).rejects.toMatchObject({ name: "NotFoundError" })
  })

  test("read maps missing files to NotFoundError", async () => {
    await expect(Storage.read(["session", "missing"])).rejects.toMatchObject({ name: "NotFoundError" })
  })
})
