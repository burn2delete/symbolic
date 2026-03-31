import { describe, test, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { FileTime } from "../../src/file/time"
import { Instance } from "../../src/project/instance"
import { SessionID } from "../../src/session/schema"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

async function touch(file: string, time: number) {
  const date = new Date(time)
  await fs.utimes(file, date, date)
}

function gate() {
  let open!: () => void
  const wait = new Promise<void>((resolve) => {
    open = resolve
  })
  return { open, wait }
}

describe("file/time", () => {
  const sessionID = SessionID.make("test-session-123")
  const session1 = SessionID.make("session1")
  const session2 = SessionID.make("session2")

  describe("read() and get()", () => {
    test("stores read timestamp", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "content", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const before = await FileTime.get(sessionID, filepath)
          expect(before).toBeUndefined()

          await FileTime.read(sessionID, filepath)

          const after = await FileTime.get(sessionID, filepath)
          expect(after).toBeInstanceOf(Date)
          expect(after!.getTime()).toBeGreaterThan(0)
        },
      })
    })

    test("tracks separate timestamps per session", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "content", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await FileTime.read(session1, filepath)
          await FileTime.read(session2, filepath)

          const time1 = await FileTime.get(session1, filepath)
          const time2 = await FileTime.get(session2, filepath)

          expect(time1).toBeDefined()
          expect(time2).toBeDefined()
        },
      })
    })

    test("updates timestamp on subsequent reads", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "content", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await FileTime.read(sessionID, filepath)
          const first = (await FileTime.get(sessionID, filepath))!

          await FileTime.read(sessionID, filepath)
          const second = (await FileTime.get(sessionID, filepath))!

          expect(second.getTime()).toBeGreaterThanOrEqual(first.getTime())
        },
      })
    })
  })

  describe("assert()", () => {
    test("passes when file has not been modified", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "content", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await FileTime.read(sessionID, filepath)

          // Should not throw
          await FileTime.assert(sessionID, filepath)
        },
      })
    })

    test("throws when file was not read first", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "content", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await expect(FileTime.assert(sessionID, filepath)).rejects.toThrow("You must read file")
        },
      })
    })

    test("throws when file was modified after read", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "content", "utf-8")
      await touch(filepath, 1_000)

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await FileTime.read(sessionID, filepath)
          await fs.writeFile(filepath, "modified content", "utf-8")
          await touch(filepath, 2_000)

          await expect(FileTime.assert(sessionID, filepath)).rejects.toThrow("modified since it was last read")
        },
      })
    })

    test("includes timestamps in error message", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "content", "utf-8")
      await touch(filepath, 1_000)

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await FileTime.read(sessionID, filepath)
          await fs.writeFile(filepath, "modified", "utf-8")
          await touch(filepath, 2_000)

          let error: Error | undefined
          try {
            await FileTime.assert(sessionID, filepath)
          } catch (e) {
            error = e as Error
          }
          expect(error).toBeDefined()
          expect(error!.message).toContain("Last modification:")
          expect(error!.message).toContain("Last read:")
        },
      })
    })

    test("skips check when SYMBOLIC_DISABLE_FILETIME_CHECK is true", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "content", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const { Flag } = await import("../../src/flag/flag")
          const original = Flag.SYMBOLIC_DISABLE_FILETIME_CHECK
          ;(Flag as { SYMBOLIC_DISABLE_FILETIME_CHECK: boolean }).SYMBOLIC_DISABLE_FILETIME_CHECK = true

          try {
            // Should not throw even though file wasn't read
            await FileTime.assert(sessionID, filepath)
          } finally {
            ;(Flag as { SYMBOLIC_DISABLE_FILETIME_CHECK: boolean }).SYMBOLIC_DISABLE_FILETIME_CHECK = original
          }
        },
      })
    })
  })

  describe("withLock()", () => {
    test("executes function within lock", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          let executed = false
          await FileTime.withLock(filepath, async () => {
            executed = true
            return "result"
          })
          expect(executed).toBe(true)
        },
      })
    })

    test("returns function result", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await FileTime.withLock(filepath, async () => {
            return "success"
          })
          expect(result).toBe("success")
        },
      })
    })

    test("serializes concurrent operations on same file", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const order: number[] = []
          const hold = gate()
          const ready = gate()

          const op1 = FileTime.withLock(filepath, async () => {
            order.push(1)
            ready.open()
            await hold.wait
            order.push(2)
          })

          await ready.wait

          const op2 = FileTime.withLock(filepath, async () => {
            order.push(3)
            order.push(4)
          })

          hold.open()

          await Promise.all([op1, op2])
          expect(order).toEqual([1, 2, 3, 4])
        },
      })
    })

    test("allows concurrent operations on different files", async () => {
      await using tmp = await tmpdir()
      const filepath1 = path.join(tmp.path, "file1.txt")
      const filepath2 = path.join(tmp.path, "file2.txt")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          let started1 = false
          let started2 = false
          const hold = gate()
          const ready = gate()

          const op1 = FileTime.withLock(filepath1, async () => {
            started1 = true
            ready.open()
            await hold.wait
            expect(started2).toBe(true)
          })

          await ready.wait

          const op2 = FileTime.withLock(filepath2, async () => {
            started2 = true
            hold.open()
          })

          await Promise.all([op1, op2])

          expect(started1).toBe(true)
          expect(started2).toBe(true)
        },
      })
    })

    test("releases lock even if function throws", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await expect(
            FileTime.withLock(filepath, async () => {
              throw new Error("Test error")
            }),
          ).rejects.toThrow("Test error")

          // Lock should be released, subsequent operations should work
          let executed = false
          await FileTime.withLock(filepath, async () => {
            executed = true
          })
          expect(executed).toBe(true)
        },
      })
    })

    test("deadlocks on nested locks (expected behavior)", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          // Nested locks on same file cause deadlock - this is expected
          // The outer lock waits for inner to complete, but inner waits for outer to release
          const timeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Deadlock detected")), 100),
          )

          const nestedLock = FileTime.withLock(filepath, async () => {
            return FileTime.withLock(filepath, async () => {
              return "inner"
            })
          })

          // Should timeout due to deadlock
          await expect(Promise.race([nestedLock, timeout])).rejects.toThrow("Deadlock detected")
        },
      })
    })
  })

  describe("stat() Filesystem.stat pattern", () => {
    test("reads file modification time via Filesystem.stat()", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "content", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await FileTime.read(sessionID, filepath)

          const stats = Filesystem.stat(filepath)
          expect(stats?.mtime).toBeInstanceOf(Date)
          expect(stats!.mtime.getTime()).toBeGreaterThan(0)

          // FileTime.assert uses this stat internally
          await FileTime.assert(sessionID, filepath)
        },
      })
    })

    test("detects modification via stat mtime", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "original", "utf-8")
      await touch(filepath, 1_000)

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await FileTime.read(sessionID, filepath)

          const originalStat = Filesystem.stat(filepath)

          await fs.writeFile(filepath, "modified", "utf-8")
          await touch(filepath, 2_000)

          const newStat = Filesystem.stat(filepath)
          expect(newStat!.mtime.getTime()).toBeGreaterThan(originalStat!.mtime.getTime())

          await expect(FileTime.assert(sessionID, filepath)).rejects.toThrow()
        },
      })
    })
  })
})
