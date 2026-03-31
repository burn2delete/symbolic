import { afterAll, afterEach, describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"

const prev = process.env.SYMBOLIC_DISABLE_DEFAULT_PLUGINS
process.env.SYMBOLIC_DISABLE_DEFAULT_PLUGINS = "1"

const { Plugin } = await import("../../src/plugin/index")
const { Instance } = await import("../../src/project/instance")

afterEach(async () => {
  await Instance.disposeAll()
})

afterAll(() => {
  if (prev === undefined) {
    delete process.env.SYMBOLIC_DISABLE_DEFAULT_PLUGINS
    return
  }
  process.env.SYMBOLIC_DISABLE_DEFAULT_PLUGINS = prev
})

async function project(source: string) {
  return tmpdir({
    init: async (dir) => {
      const file = path.join(dir, ".symbolic", "plugin", "trigger.ts")
      await fs.mkdir(path.dirname(file), { recursive: true })
      await Bun.write(file, source)
    },
  })
}

describe("plugin.trigger", () => {
  test("runs synchronous hooks without crashing", async () => {
    await using tmp = await project(
      [
        "export default async () => ({",
        '  "experimental.chat.system.transform": (_input, output) => {',
        '    output.system.unshift("sync")',
        "  },",
        "})",
        "",
      ].join("\n"),
    )

    const out = await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const out = { system: [] as string[] }
        await Plugin.trigger(
          "experimental.chat.system.transform",
          {
            model: {
              providerID: "anthropic",
              modelID: "claude-sonnet-4-6",
            } as never,
          },
          out,
        )
        return out
      },
    })

    expect(out.system).toEqual(["sync"])
  })

  test("awaits asynchronous hooks", async () => {
    await using tmp = await project(
      [
        "export default async () => ({",
        '  "experimental.chat.system.transform": async (_input, output) => {',
        "    await Bun.sleep(1)",
        '    output.system.unshift("async")',
        "  },",
        "})",
        "",
      ].join("\n"),
    )

    const out = await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const out = { system: [] as string[] }
        await Plugin.trigger(
          "experimental.chat.system.transform",
          {
            model: {
              providerID: "anthropic",
              modelID: "claude-sonnet-4-6",
            } as never,
          },
          out,
        )
        return out
      },
    })

    expect(out.system).toEqual(["async"])
  })
})
