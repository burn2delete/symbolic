import { describe, expect, spyOn, test } from "bun:test"
import { Agent } from "../../src/agent/agent"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionPrompt } from "../../src/session/prompt"
import { Session } from "../../src/session"
import { Instance } from "../../src/project/instance"
import { TaskTool } from "../../src/tool/task"
import { MessageID, SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

describe("tool.task", () => {
  test("description sorts subagents by name and is stable across calls", async () => {
    await using tmp = await tmpdir({
      config: {
        agent: {
          zebra: {
            description: "Zebra agent",
            mode: "subagent",
          },
          alpha: {
            description: "Alpha agent",
            mode: "subagent",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const build = await Agent.get("build")
        const first = await TaskTool.init({ agent: build })
        const second = await TaskTool.init({ agent: build })

        expect(first.description).toBe(second.description)

        const alpha = first.description.indexOf("- alpha: Alpha agent")
        const explore = first.description.indexOf("- explore:")
        const general = first.description.indexOf("- general:")
        const zebra = first.description.indexOf("- zebra: Zebra agent")

        expect(alpha).toBeGreaterThan(-1)
        expect(explore).toBeGreaterThan(alpha)
        expect(general).toBeGreaterThan(explore)
        expect(zebra).toBeGreaterThan(general)
      },
    })
  })

  test("respects subagent todowrite permission", async () => {
    await using tmp = await tmpdir({
      config: {
        agent: {
          helper: {
            mode: "subagent",
            permission: {
              todowrite: "allow",
              task: "deny",
            },
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const build = await Agent.get("build")
        const tool = await TaskTool.init({ agent: build })
        const sid = SessionID.make("ses_task_test")
        const mid = MessageID.ascending()
        const abort = new AbortController()
        let create: Parameters<typeof Session.create>[0] | undefined
        let prompt: Parameters<typeof SessionPrompt.prompt>[0] | undefined

        const createMock = Object.assign(
          async (input: Parameters<typeof Session.create>[0]) => {
            create = input
            return { id: sid } as Awaited<ReturnType<typeof Session.create>>
          },
          {
            force: async (input: Parameters<typeof Session.create.force>[0]) => {
              create = input
              return { id: sid } as Awaited<ReturnType<typeof Session.create>>
            },
            schema: Session.create.schema,
          },
        )
        using createSpy = spyOn(Session, "create").mockImplementation(createMock)
        using partsSpy = spyOn(SessionPrompt, "resolvePromptParts").mockResolvedValue([
          {
            type: "text",
            text: "task prompt",
          },
        ] as Awaited<ReturnType<typeof SessionPrompt.resolvePromptParts>>)
        using msgSpy = spyOn(MessageV2, "get").mockResolvedValue({
          info: {
            role: "assistant",
            modelID: "model",
            providerID: "provider",
          },
        } as Awaited<ReturnType<typeof MessageV2.get>>)
        const promptMock = Object.assign(
          async (input: Parameters<typeof SessionPrompt.prompt>[0]) => {
            prompt = input
            return {
              parts: [
                {
                  type: "text",
                  text: "done",
                },
              ],
            } as Awaited<ReturnType<typeof SessionPrompt.prompt>>
          },
          {
            force: async (input: Parameters<typeof SessionPrompt.prompt.force>[0]) => {
              prompt = input
              return {
                parts: [
                  {
                    type: "text",
                    text: "done",
                  },
                ],
              } as Awaited<ReturnType<typeof SessionPrompt.prompt>>
            },
            schema: SessionPrompt.prompt.schema,
          },
        )
        using promptSpy = spyOn(SessionPrompt, "prompt").mockImplementation(promptMock)

        await tool.execute(
          {
            description: "helper task",
            prompt: "do something",
            subagent_type: "helper",
          },
          {
            agent: build?.name ?? "build",
            sessionID: sid,
            messageID: mid,
            abort: abort.signal,
            messages: [],
            extra: {
              bypassAgentCheck: true,
            },
            ask: async () => undefined,
            metadata: () => undefined,
          },
        )

        const todowrite = create?.permission?.find((x) => x.permission === "todowrite" && x.action === "deny")
        const task = create?.permission?.find((x) => x.permission === "task" && x.action === "deny")

        expect(todowrite).toBeUndefined()
        expect(task).toBeDefined()
        expect(prompt?.tools?.todowrite).toBeUndefined()
        expect(prompt?.tools?.task).toBe(false)
      },
    })
  })
})
