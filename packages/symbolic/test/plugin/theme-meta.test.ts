import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Filesystem } from "../../src/util/filesystem"
import { PluginMeta } from "../../src/plugin/meta"
import { allThemes, hasTheme, upsertTheme } from "../../src/plugin/theme"

describe("tui theme registry", () => {
  test("upsertTheme adds and replaces plugin themes", () => {
    const name = `theme-${Math.random().toString(36).slice(2)}`
    const a = { theme: { primary: "#111111" } }
    const b = { theme: { primary: "#222222" } }

    expect(hasTheme(name)).toBe(false)
    expect(upsertTheme(name, a)).toBe(true)
    expect(hasTheme(name)).toBe(true)
    expect(allThemes()[name]).toEqual(a)

    expect(upsertTheme(name, b)).toBe(true)
    expect(allThemes()[name]).toEqual(b)
  })
})

describe("plugin.meta", () => {
  test("touch persists entries and keeps themes across updates", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Filesystem.write(path.join(dir, "package.json"), JSON.stringify({ version: "1.0.0" }))
      },
    })

    const id = `plugin-${Math.random().toString(36).slice(2)}`
    const spec = "acme@1.0.0"
    const theme = {
      src: "src/theme.json",
      dest: "dest/theme.json",
      mtime: 1,
      size: 2,
    }

    const first = await PluginMeta.touch(spec, tmp.path, id)
    expect(first.state).toBe("first")
    expect(first.entry.id).toBe(id)
    expect(first.entry.source).toBe("npm")
    expect(first.entry.requested).toBe("1.0.0")
    expect(first.entry.version).toBe("1.0.0")

    await PluginMeta.setTheme(id, "emerald", theme)
    await Filesystem.write(path.join(tmp.path, "package.json"), JSON.stringify({ version: "1.0.1" }))

    const next = await PluginMeta.touch(spec, tmp.path, id)
    expect(next.state).toBe("updated")
    expect(next.entry.load_count).toBe(2)
    expect(next.entry.version).toBe("1.0.1")
    expect(next.entry.themes?.emerald).toEqual(theme)

    const store = await PluginMeta.list()
    expect(store[id]?.themes?.emerald).toEqual(theme)
  })
})
