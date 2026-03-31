import { describe, expect, test } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"
import { tmpdir } from "../fixture/fixture"
import { Filesystem } from "../../src/util/filesystem"
import {
  checkPluginCompatibility,
  isDeprecatedPlugin,
  isPathPluginSpec,
  parsePluginSpecifier,
  pluginSource,
  readPluginPackage,
  readV1Plugin,
  resolvePathPluginTarget,
  resolvePluginEntrypoint,
  resolvePluginId,
} from "../../src/plugin/shared"

describe("plugin.shared", () => {
  test("parses plugin specifiers and source kinds", () => {
    expect(parsePluginSpecifier("@scope/pkg@1.2.3")).toEqual({ pkg: "@scope/pkg", version: "1.2.3" })
    expect(parsePluginSpecifier("pkg")).toEqual({ pkg: "pkg", version: "latest" })
    expect(pluginSource("file://x")).toBe("file")
    expect(pluginSource("pkg")).toBe("npm")
    expect(isPathPluginSpec("./x")).toBe(true)
    expect(isPathPluginSpec("/x")).toBe(true)
    expect(isDeprecatedPlugin("symbolic-copilot-auth")).toBe(true)
  })

  test("resolves path plugins and package entrypoints", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const root = path.join(dir, "demo")
        await Filesystem.write(
          path.join(root, "package.json"),
          JSON.stringify(
            {
              name: "demo",
              type: "module",
              main: "./dist/index.js",
              exports: {
                "./tui": "./dist/tui.js",
              },
            },
            null,
            2,
          ),
        )
        await Filesystem.write(path.join(root, "dist", "index.js"), "export default {}\n")
        await Filesystem.write(path.join(root, "dist", "tui.js"), "export default {}\n")
        await Filesystem.write(path.join(root, "dist", "outside.js"), "export default {}\n")
      },
    })

    const dir = path.join(tmp.path, "demo")
    const file = path.join(dir, "dist", "index.js")

    expect(await resolvePathPluginTarget(dir)).toBe(pathToFileURL(path.join(dir, "dist", "index.js")).href)
    expect(await resolvePathPluginTarget(pathToFileURL(file).href)).toBe(pathToFileURL(file).href)

    const pkg = await readPluginPackage(pathToFileURL(file).href)
    expect(pkg.dir).toBe(dir)
    expect(pkg.pkg).toBe(path.join(dir, "package.json"))

    const tui = await resolvePluginEntrypoint("demo", pathToFileURL(file).href, "tui")
    expect(tui).toBe(pathToFileURL(path.join(dir, "dist", "tui.js")).href)

    await expect(resolvePluginEntrypoint("demo", pathToFileURL(file).href, "server")).resolves.toBe(
      pathToFileURL(file).href,
    )

    await Filesystem.write(path.join(dir, "package.json"), JSON.stringify({ exports: { "./tui": "../outside.js" } }))
    await expect(resolvePluginEntrypoint("demo", pathToFileURL(file).href, "tui")).rejects.toThrow(
      /outside plugin directory/,
    )
  })

  test("falls back to index files for path plugin directories without package.json", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const root = path.join(dir, "demo")
        await Filesystem.write(path.join(root, "index.ts"), "export default {}\n")
      },
    })

    const dir = path.join(tmp.path, "demo")
    const file = path.join(dir, "index.ts")
    expect(await resolvePathPluginTarget(dir)).toBe(pathToFileURL(file).href)
    expect(await resolvePluginEntrypoint("demo", pathToFileURL(file).href, "tui")).toBe(pathToFileURL(file).href)
  })

  test("resolves package server exports without a leading dot", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const root = path.join(dir, "demo")
        await Filesystem.write(
          path.join(root, "package.json"),
          JSON.stringify(
            {
              name: "demo",
              type: "module",
              main: "dist/index.js",
              exports: {
                "./server": "dist/server.js",
              },
            },
            null,
            2,
          ),
        )
        await Filesystem.write(path.join(root, "dist", "index.js"), "export default {}\n")
        await Filesystem.write(path.join(root, "dist", "server.js"), "export default {}\n")
      },
    })

    const dir = path.join(tmp.path, "demo")
    const file = path.join(dir, "dist", "index.js")

    expect(await resolvePluginEntrypoint("demo", pathToFileURL(file).href, "server")).toBe(
      pathToFileURL(path.join(dir, "dist", "server.js")).href,
    )
  })

  test("resolves package tui exports without a leading dot", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const root = path.join(dir, "demo")
        await Filesystem.write(
          path.join(root, "package.json"),
          JSON.stringify(
            {
              name: "demo",
              type: "module",
              main: "dist/index.js",
              exports: {
                "./tui": "dist/tui.js",
              },
            },
            null,
            2,
          ),
        )
        await Filesystem.write(path.join(root, "dist", "index.js"), "export default {}\n")
        await Filesystem.write(path.join(root, "dist", "tui.js"), "export default {}\n")
      },
    })

    const dir = path.join(tmp.path, "demo")
    const file = path.join(dir, "dist", "index.js")

    expect(await resolvePluginEntrypoint("demo", pathToFileURL(file).href, "tui")).toBe(
      pathToFileURL(path.join(dir, "dist", "tui.js")).href,
    )
  })

  test("resolves package main without a leading dot", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const root = path.join(dir, "demo")
        await Filesystem.write(
          path.join(root, "package.json"),
          JSON.stringify(
            {
              name: "demo",
              type: "module",
              main: "dist/index.js",
            },
            null,
            2,
          ),
        )
        await Filesystem.write(path.join(root, "dist", "index.js"), "export default {}\n")
      },
    })

    const dir = path.join(tmp.path, "demo")
    const file = path.join(dir, "dist", "index.js")

    expect(await resolvePluginEntrypoint("demo", pathToFileURL(file).href, "server")).toBe(
      pathToFileURL(path.join(dir, "dist", "index.js")).href,
    )
  })

  test("validates v1 plugin shapes", () => {
    const ok = {
      default: {
        id: "demo",
        tui: () => undefined,
      },
    }
    const bad = {
      default: {
        server: () => undefined,
        tui: () => undefined,
      },
    }
    expect(readV1Plugin(ok, "demo", "tui")).toEqual(ok.default)
    expect(readV1Plugin({ default: {} }, "demo", "tui", "detect")).toBeUndefined()
    expect(() => readV1Plugin(bad, "demo", "tui")).toThrow(/either server\(\) or tui\(\)/)
  })

  test("resolves plugin ids and checks compatibility", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Filesystem.write(
          path.join(dir, "package.json"),
          JSON.stringify({
            name: "@scope/demo",
            version: "1.0.0",
            engines: { opencode: "^1.0.0" },
          }),
        )
      },
    })

    const file = path.join(tmp.path, "index.js")
    await Filesystem.write(file, "export default {}\n")

    expect(await resolvePluginId("npm", "demo", path.join(tmp.path, "package.json"), undefined)).toBe("@scope/demo")
    expect(await resolvePluginId("file", "file:///demo", file, "demo.id")).toBe("demo.id")
    await expect(resolvePluginId("file", "file:///demo", file, undefined)).rejects.toThrow(/must export id/)
    await expect(checkPluginCompatibility(path.join(tmp.path, "package.json"), "1.0.1")).resolves.toBeUndefined()
    await expect(checkPluginCompatibility(path.join(tmp.path, "package.json"), "2.0.0")).rejects.toThrow(
      /requires opencode/,
    )
  })
})
