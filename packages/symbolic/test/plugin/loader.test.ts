import { describe, expect, test } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"
import { tmpdir } from "../fixture/fixture"
import { Filesystem } from "../../src/util/filesystem"
import { PluginLoader } from "../../src/plugin/loader"

describe("plugin.loader", () => {
  test("plans, resolves, and loads path tui plugins", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const root = path.join(dir, "demo")
        await Filesystem.write(
          path.join(root, "package.json"),
          JSON.stringify({
            name: "demo",
            type: "module",
            exports: {
              "./tui": "./tui.js",
            },
          }),
        )
        await Filesystem.write(path.join(root, "tui.js"), 'export default { id: "demo", tui() {} }\n')
      },
    })

    const item = pathToFileURL(path.join(tmp.path, "demo")).href
    const plan = PluginLoader.plan(item)
    const resolved = await PluginLoader.resolve(plan, "tui")
    const loaded = await PluginLoader.load(resolved)

    expect(plan.deprecated).toBe(false)
    expect(resolved.source).toBe("file")
    expect(resolved.entry).toBe(pathToFileURL(path.join(tmp.path, "demo", "tui.js")).href)
    expect(loaded.mod.default).toMatchObject({ id: "demo" })
  })
})
