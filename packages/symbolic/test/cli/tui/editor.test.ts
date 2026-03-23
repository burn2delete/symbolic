import { describe, expect, test } from "bun:test"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import type { CliRenderer } from "@opentui/core"
import { Editor } from "../../../src/cli/cmd/tui/util/editor"
import { tmpdir } from "../../fixture/fixture"

describe("cli.tui.editor", () => {
  test("opens the editor and restores the renderer", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "editor.mjs")
    await writeFile(
      file,
      [
        'import fs from "node:fs"',
        'const file = process.argv[2]',
        'fs.writeFileSync(file, "edited")',
      ].join("\n"),
    )

    let suspend = 0
    let resume = 0
    let render = 0
    let clear = 0
    const renderer = {
      suspend: () => {
        suspend += 1
      },
      resume: () => {
        resume += 1
      },
      requestRender: () => {
        render += 1
      },
      currentRenderBuffer: {
        clear: () => {
          clear += 1
        },
      },
    } as unknown as CliRenderer

    const prev = process.env.VISUAL
    process.env.VISUAL = `${process.execPath} ${file}`

    try {
      const out = await Editor.open({ value: "start", renderer })
      expect(out).toBe("edited")
      expect(suspend).toBe(1)
      expect(resume).toBe(1)
      expect(render).toBe(1)
      expect(clear).toBeGreaterThanOrEqual(2)
    } finally {
      if (prev === undefined) delete process.env.VISUAL
      else process.env.VISUAL = prev
    }
  })
})
