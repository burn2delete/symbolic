import { $ } from "bun"
import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Snapshot } from "../../src/snapshot"
import { Instance } from "../../src/project/instance"
import { Vcs } from "../../src/project/vcs"
import { Server } from "../../src/server/server"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await resetDatabase()
})

async function commit(dir: string, msg: string) {
  await $`git add -A`.cwd(dir).quiet()
  await $`git commit -m ${msg}`.cwd(dir).quiet()
}

function sort(list: Snapshot.FileDiff[]) {
  return [...list].toSorted((a, b) => a.file.localeCompare(b.file))
}

describe("vcs endpoints", () => {
  test("returns rich metadata for a git worktree and detached head", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.Default()
    const wt = path.join(path.dirname(tmp.path), `${path.basename(tmp.path)}-worktree`)

    try {
      await $`git worktree add -b feature ${wt}`.cwd(tmp.path).quiet()

      const work = await app.request("/vcs", {
        headers: {
          "x-symbolic-directory": wt,
        },
      })
      expect(work.status).toBe(200)
      const tree = await work.json()
      expect(tree.branch).toBe("feature")
      expect(tree.dirty).toBe(false)
      expect(tree.head).toMatch(/^[0-9a-f]{40}$/)
      expect(tree.default_branch).toMatch(/^(main|master)$/)

      await $`git checkout --detach HEAD`.cwd(tmp.path).quiet()

      const head = await app.request("/vcs", {
        headers: {
          "x-symbolic-directory": tmp.path,
        },
      })
      expect(head.status).toBe(200)
      const body = await head.json()
      expect(body.branch).toBeUndefined()
      expect(body.dirty).toBe(false)
      expect(body.head).toMatch(/^[0-9a-f]{40}$/)
      expect(body.default_branch).toMatch(/^(main|master)$/)
    } finally {
      await fs.rm(wt, { force: true, recursive: true }).catch(() => undefined)
    }
  })

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

  test("returns working tree diffs with unicode and quoted paths", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.Default()
    const base = path.join(tmp.path, "base.txt")
    const quote = path.join(tmp.path, "src", 'quo"te-µ.txt')

    await fs.mkdir(path.dirname(quote), { recursive: true })
    await Bun.write(base, "left\n")
    await commit(tmp.path, "base")

    const clean = await app.request("/vcs/diff?mode=working_tree", {
      headers: {
        "x-symbolic-directory": tmp.path,
      },
    })
    expect(clean.status).toBe(200)
    expect(await clean.json()).toEqual([])

    await fs.rm(base, { force: true })
    await Bun.write(quote, "uno\ndos")

    const res = await app.request("/vcs/diff?mode=working_tree", {
      headers: {
        "x-symbolic-directory": tmp.path,
      },
    })

    expect(res.status).toBe(200)
    expect(sort((await res.json()) as Snapshot.FileDiff[])).toEqual([
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
    ])
  })

  test("returns range diffs and empty comparisons", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.Default()
    const left = path.join(tmp.path, "left.txt")
    const quote = path.join(tmp.path, "src", 'quo"te-µ.txt')

    await fs.mkdir(path.dirname(quote), { recursive: true })
    await Bun.write(left, "one\n")
    await commit(tmp.path, "one")

    const base = (await $`git rev-parse HEAD`.cwd(tmp.path).text()).trim()

    await Bun.write(left, "two\n")
    await Bun.write(quote, "alpha\nbeta")
    await commit(tmp.path, "two")

    const head = (await $`git rev-parse HEAD`.cwd(tmp.path).text()).trim()

    const same = await app.request(`/vcs/diff?mode=range&base=${base}&head=${base}`, {
      headers: {
        "x-symbolic-directory": tmp.path,
      },
    })
    expect(same.status).toBe(200)
    expect(await same.json()).toEqual([])

    const res = await app.request(`/vcs/diff?mode=range&base=${base}&head=${head}`, {
      headers: {
        "x-symbolic-directory": tmp.path,
      },
    })

    expect(res.status).toBe(200)
    expect(sort((await res.json()) as Snapshot.FileDiff[])).toEqual([
      {
        file: "left.txt",
        before: "one\n",
        after: "two\n",
        additions: 1,
        deletions: 1,
        status: "modified",
      },
      {
        file: 'src/quo"te-µ.txt',
        before: "",
        after: "alpha\nbeta",
        additions: 2,
        deletions: 0,
        status: "added",
      },
    ])
  })
})
