import { afterEach, expect, test } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { Snapshot } from "../../src/snapshot"
import { Instance } from "../../src/project/instance"
import { Vcs } from "../../src/project/vcs"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

async function commit(dir: string, msg: string) {
  await $`git add -A`.cwd(dir).quiet()
  await $`git commit -m ${msg}`.cwd(dir).quiet()
}

function sort(list: Snapshot.FileDiff[]) {
  return [...list].toSorted((a, b) => a.file.localeCompare(b.file))
}

test("returns metadata for non-git directories", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      expect(await Vcs.status()).toEqual({
        dirty: false,
      })
      expect(await Vcs.diff({ mode: "working_tree" })).toEqual([])
    },
  })
})

test("returns status and diffs for git worktrees", async () => {
  await using tmp = await tmpdir({ git: true })
  const base = path.join(tmp.path, "base.txt")
  const quote = path.join(tmp.path, "src", 'quo"te-µ.txt')

  await fs.mkdir(path.dirname(quote), { recursive: true })
  await Bun.write(base, "left\n")
  await commit(tmp.path, "base")

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const info = await Vcs.status()
      expect(info.dirty).toBe(false)
      expect(info.head).toMatch(/^[0-9a-f]{40}$/)
      expect(info.default_branch).toMatch(/^(main|master)$/)
    },
  })

  await fs.rm(base, { force: true })
  await Bun.write(quote, "uno\ndos")

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      expect(await Vcs.diff({ mode: "working_tree" })).toEqual(
        sort([
          {
            file: "base.txt",
            before: "left\n",
            after: "",
            additions: 0,
            deletions: 1,
            status: "deleted",
          },
          {
            file: 'src/quo"te-µ.txt',
            before: "",
            after: "uno\ndos",
            additions: 2,
            deletions: 0,
            status: "added",
          },
        ]),
      )
    },
  })
})
