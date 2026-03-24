import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import { setTimeout as wait } from "node:timers/promises"
import path from "path"
import { Bus } from "../../src/bus"
import { FileWatcher } from "../../src/file/watcher"
import { Flag } from "../../src/flag/flag"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

type Evt = {
  file: string
  event: "add" | "change" | "unlink"
}

const describeWatcher = FileWatcher.hasNativeBinding() && !process.env.CI ? describe : describe.skip

function sub(check: (evt: Evt) => boolean) {
  let open!: (evt: Evt) => void
  const done = new Promise<Evt>((resolve) => {
    open = resolve
  })
  const off = Bus.subscribe(FileWatcher.Event.Updated, (evt) => {
    if (!check(evt.properties)) return
    open(evt.properties)
  })
  return { done, off }
}

async function next(check: (evt: Evt) => boolean, run: () => Promise<void>, ms = 5_000) {
  const state = sub(check)
  await run()
  const evt = await Promise.race([state.done, wait(ms).then(() => undefined)])
  state.off()
  expect(evt).toBeDefined()
  return evt
}

async function none(check: (evt: Evt) => boolean, run: () => Promise<void>, ms = 500) {
  const state = sub(check)
  await run()
  const evt = await Promise.race([state.done, wait(ms).then(() => undefined)])
  state.off()
  expect(evt).toBeUndefined()
}

async function ready(dir: string) {
  const file = path.join(dir, `.watcher-${Math.random().toString(36).slice(2)}`)
  await next(
    (evt) => evt.file === file && evt.event === "add",
    () => fs.writeFile(file, "ready"),
  )
  await fs.rm(file, { force: true }).catch(() => undefined)
}

async function withWatcher(dir: string, fn: () => Promise<void>) {
  await Instance.provide({
    directory: dir,
    fn: async () => {
      await FileWatcher.init()
      await ready(dir)
      await fn()
    },
  })
}

describeWatcher("file.watcher", () => {
  afterEach(async () => {
    await Instance.disposeAll()
  })

  test("cleanup stops publishing events", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "after-dispose.txt")
    const prev = Flag.SYMBOLIC_EXPERIMENTAL_FILEWATCHER
    ;(Flag as { SYMBOLIC_EXPERIMENTAL_FILEWATCHER: boolean }).SYMBOLIC_EXPERIMENTAL_FILEWATCHER = true

    await (async () => {
      await withWatcher(tmp.path, async () => {})
      await Instance.disposeAll()

      await Instance.provide({
        directory: tmp.path,
        fn: () =>
          none((evt) => evt.file === file, () => fs.writeFile(file, "gone")),
      })
    })().finally(() => {
      ;(Flag as { SYMBOLIC_EXPERIMENTAL_FILEWATCHER: boolean }).SYMBOLIC_EXPERIMENTAL_FILEWATCHER = prev
    })
  })
})
