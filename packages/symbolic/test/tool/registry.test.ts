import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { MessageID, SessionID } from "../../src/session/schema"
import { ToolRegistry } from "../../src/tool/registry"

describe("tool.registry", () => {
  test("loads tools from .symbolic/tool (singular)", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const symbolicDir = path.join(dir, ".symbolic")
        await fs.mkdir(symbolicDir, { recursive: true })

        const toolDir = path.join(symbolicDir, "tool")
        await fs.mkdir(toolDir, { recursive: true })

        await Bun.write(
          path.join(toolDir, "hello.ts"),
          [
            "export default {",
            "  description: 'hello tool',",
            "  args: {},",
            "  execute: async () => {",
            "    return 'hello world'",
            "  },",
            "}",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ids = await ToolRegistry.ids()
        expect(ids).toContain("hello")
      },
    })
  })

  test("loads tools from .symbolic/tools (plural)", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const symbolicDir = path.join(dir, ".symbolic")
        await fs.mkdir(symbolicDir, { recursive: true })

        const toolsDir = path.join(symbolicDir, "tools")
        await fs.mkdir(toolsDir, { recursive: true })

        await Bun.write(
          path.join(toolsDir, "hello.ts"),
          [
            "export default {",
            "  description: 'hello tool',",
            "  args: {},",
            "  execute: async () => {",
            "    return 'hello world'",
            "  },",
            "}",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ids = await ToolRegistry.ids()
        expect(ids).toContain("hello")
      },
    })
  })

  test("loads tools with external dependencies without crashing", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const symbolicDir = path.join(dir, ".symbolic")
        await fs.mkdir(symbolicDir, { recursive: true })

        const toolsDir = path.join(symbolicDir, "tools")
        await fs.mkdir(toolsDir, { recursive: true })

        await Bun.write(
          path.join(symbolicDir, "package.json"),
          JSON.stringify({
            name: "custom-tools",
            dependencies: {
              "@symbolic-agent/plugin": "^0.0.0",
              cowsay: "^1.6.0",
            },
          }),
        )

        await Bun.write(
          path.join(toolsDir, "cowsay.ts"),
          [
            "import { say } from 'cowsay'",
            "export default {",
            "  description: 'tool that imports cowsay at top level',",
            "  args: { text: { type: 'string' } },",
            "  execute: async ({ text }: { text: string }) => {",
            "    return say({ text })",
            "  },",
            "}",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ids = await ToolRegistry.ids()
        expect(ids).toContain("cowsay")
      },
    })
  })

  test("executes custom tools with project directory context", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const symbolicDir = path.join(dir, ".symbolic")
        const toolsDir = path.join(symbolicDir, "tools")
        await fs.mkdir(toolsDir, { recursive: true })

        await Bun.write(
          path.join(toolsDir, "context.ts"),
          [
            "export default {",
            "  description: 'context tool',",
            "  args: {},",
            "  execute: async (_args, ctx) => {",
            "    return JSON.stringify({ directory: ctx.directory, worktree: ctx.worktree })",
            "  },",
            "}",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = (await ToolRegistry.tools({
          modelID: "test" as any,
          providerID: "test" as any,
        })).find((item) => item.id === "context")

        expect(tool).toBeTruthy()
        const result = await tool!.execute(
          {},
          {
            sessionID: SessionID.make("ses_tool_context"),
            messageID: MessageID.make("msg_tool_context"),
            agent: "test",
            abort: new AbortController().signal,
            messages: [],
            metadata() {},
            ask: async () => {},
          },
        )

        expect(JSON.parse(result.output)).toEqual({
          directory: tmp.path,
          worktree: tmp.path,
        })
      },
    })
  })
})
