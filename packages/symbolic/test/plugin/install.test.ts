import { describe, expect, spyOn, test } from "bun:test"
import path from "path"
import { parse as parseJsonc } from "jsonc-parser"
import { installPlugin, patchPluginConfig, readPluginManifest } from "../../src/plugin/install"
import { BunProc } from "../../src/bun"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

describe("plugin.install", () => {
  test("preserves JSONC comments when adding a plugin", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "symbolic.jsonc")
    await Bun.write(
      file,
      `{
  // head
  "plugin": [
    // keep
    "seed@1.0.0"
  ],
  // tail
  "model": "openai/gpt-5.2"
}
`,
    )

    const out = await patchPluginConfig({
      spec: "acme@1.2.3",
      directory: tmp.path,
      worktree: tmp.path,
    })

    expect(out).toEqual({
      ok: true,
      file,
      mode: "add",
    })

    const text = await Filesystem.readText(file)
    expect(text).toContain("// head")
    expect(text).toContain("// keep")
    expect(text).toContain("// tail")
    expect(parseJsonc(text)).toEqual({
      plugin: ["seed@1.0.0", "acme@1.2.3"],
      model: "openai/gpt-5.2",
    })
  })

  test("preserves JSONC comments when force replacing a plugin version", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "symbolic.jsonc")
    await Bun.write(
      file,
      `{
  "plugin": [
    // keep this note
    "acme@1.0.0"
  ]
}
`,
    )

    const out = await patchPluginConfig({
      spec: "acme@2.0.0",
      force: true,
      directory: tmp.path,
      worktree: tmp.path,
    })

    expect(out).toEqual({
      ok: true,
      file,
      mode: "replace",
    })

    const text = await Filesystem.readText(file)
    expect(text).toContain("// keep this note")
    expect(parseJsonc(text)).toEqual({
      plugin: ["acme@2.0.0"],
    })
  })

  test("prefers an existing .symbolic config over the root config", async () => {
    await using tmp = await tmpdir()
    await Filesystem.write(
      path.join(tmp.path, "symbolic.jsonc"),
      JSON.stringify({
        plugin: ["root@1.0.0"],
      }),
    )
    const file = path.join(tmp.path, ".symbolic", "symbolic.jsonc")
    await Filesystem.write(
      file,
      JSON.stringify({
        plugin: ["local@1.0.0"],
      }),
    )

    const out = await patchPluginConfig({
      spec: "acme@1.2.3",
      directory: tmp.path,
      worktree: tmp.path,
    })

    expect(out).toEqual({
      ok: true,
      file,
      mode: "add",
    })
    expect(parseJsonc(await Filesystem.readText(file))).toEqual({
      plugin: ["local@1.0.0", "acme@1.2.3"],
    })
    expect(parseJsonc(await Filesystem.readText(path.join(tmp.path, "symbolic.jsonc")))).toEqual({
      plugin: ["root@1.0.0"],
    })
  })

  test("writes tuple options from server targets into config", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "symbolic.jsonc")

    const out = await patchPluginConfig({
      spec: "acme@1.2.3",
      kind: "server",
      item: ["acme@1.2.3", { compact: true }],
      directory: tmp.path,
      worktree: tmp.path,
    })

    expect(out).toEqual({
      ok: true,
      file,
      mode: "add",
    })
    expect(parseJsonc(await Filesystem.readText(file))).toEqual({
      plugin: [["acme@1.2.3", { compact: true }]],
    })
  })

  test("writes server and tui targets to their own config files", async () => {
    await using tmp = await tmpdir()
    const server = path.join(tmp.path, "symbolic.jsonc")
    const tui = path.join(tmp.path, "tui.jsonc")

    await Bun.write(
      server,
      `{
  // server
  "plugin": []
}
`,
    )
    await Bun.write(
      tui,
      `{
  // tui
  "plugin": []
}
`,
    )

    const serverOut = await patchPluginConfig({
      spec: "acme@1.2.3",
      kind: "server",
      item: ["acme@1.2.3", { compact: true }],
      directory: tmp.path,
      worktree: tmp.path,
    })
    const tuiOut = await patchPluginConfig({
      spec: "acme@1.2.3",
      kind: "tui",
      item: ["acme@1.2.3", { compact: true }],
      directory: tmp.path,
      worktree: tmp.path,
    })

    expect(serverOut).toEqual({
      ok: true,
      file: server,
      mode: "add",
    })
    expect(tuiOut).toEqual({
      ok: true,
      file: tui,
      mode: "add",
    })

    const serverText = await Filesystem.readText(server)
    const tuiText = await Filesystem.readText(tui)
    expect(serverText).toContain("// server")
    expect(tuiText).toContain("// tui")
    expect(parseJsonc(serverText)).toEqual({
      plugin: [["acme@1.2.3", { compact: true }]],
    })
    expect(parseJsonc(tuiText)).toEqual({
      plugin: [["acme@1.2.3", { compact: true }]],
    })
  })

  test("reads oc-plugin targets from package.json", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Filesystem.write(
          path.join(dir, "package.json"),
          JSON.stringify({
            name: "acme",
            version: "1.0.0",
            "oc-plugin": ["server", ["tui", { compact: true }]],
          }),
        )
      },
    })

    const out = await readPluginManifest(tmp.path)
    expect(out).toEqual({
      ok: true,
      targets: [
        { kind: "server" },
        { kind: "tui", opts: { compact: true } },
      ],
    })
  })

  test("installs plugins with lifecycle scripts disabled", async () => {
    using install = spyOn(BunProc, "install").mockResolvedValue("/tmp/acme")

    const out = await installPlugin("seed@1.0.0")

    expect(out).toEqual({
      ok: true,
      target: "/tmp/acme",
    })
    expect(install.mock.calls).toEqual([["seed", "1.0.0", { ignoreScripts: true }]])
  })
})
