import { afterEach, describe, expect, test } from "bun:test"
import { Session } from "../../src/session"
import { MessageID } from "../../src/session/schema"
import { SessionSummary } from "../../src/session/summary"
import { Server } from "../../src/server/server"
import { Instance } from "../../src/project/instance"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await resetDatabase()
})

describe("session diff endpoint", () => {
  test("returns session diffs when no message id is provided", async () => {
    await using tmp = await tmpdir()
    const app = Server.Default()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const diffs = [
          {
            file: '"src/app.ts"',
            before: "left",
            after: "right",
            additions: 1,
            deletions: 1,
          },
        ]

        await Session.setSummary({
          sessionID: session.id,
          summary: {
            additions: 1,
            deletions: 1,
            files: 1,
            diffs,
          },
        })

        expect(await Session.diff(session.id)).toEqual([
          {
            file: '"src/app.ts"',
            before: "left",
            after: "right",
            additions: 1,
            deletions: 1,
          },
        ])

        const res = await app.request(`/session/${session.id}/diff`, {
          headers: {
            "x-symbolic-directory": tmp.path,
          },
        })

        expect(res.status).toBe(200)
        expect(await res.json()).toEqual([
          {
            file: "src/app.ts",
            before: "left",
            after: "right",
            additions: 1,
            deletions: 1,
          },
        ])
      },
    })
  })

  test("returns message diffs when an assistant message id is provided", async () => {
    await using tmp = await tmpdir()
    const app = Server.Default()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const userID = MessageID.ascending()
        const assistantID = MessageID.ascending()

        await Session.updateMessage({
          id: userID,
          role: "user",
          sessionID: session.id,
          agent: "build",
          model: {
            providerID: ProviderID.make("openai"),
            modelID: ModelID.make("gpt-4"),
          },
          time: {
            created: Date.now(),
          },
          summary: {
            title: "diff",
            diffs: [
              {
                file: '"src/app.ts"',
                before: "left",
                after: "right",
                additions: 1,
                deletions: 1,
              },
            ],
          },
        })

        await Session.updateMessage({
          id: assistantID,
          role: "assistant",
          sessionID: session.id,
          parentID: userID,
          mode: "build",
          agent: "build",
          path: {
            cwd: tmp.path,
            root: tmp.path,
          },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          modelID: ModelID.make("gpt-4"),
          providerID: ProviderID.make("openai"),
          time: {
            created: Date.now(),
          },
        })

        const res = await app.request(`/session/${session.id}/diff?messageID=${assistantID}`, {
          headers: {
            "x-symbolic-directory": tmp.path,
          },
        })

        expect(res.status).toBe(200)
        expect(await res.json()).toEqual([
          {
            file: "src/app.ts",
            before: "left",
            after: "right",
            additions: 1,
            deletions: 1,
          },
        ])

        expect(
          await SessionSummary.diff({
            sessionID: session.id,
            messageID: assistantID,
          }),
        ).toEqual([
          {
            file: "src/app.ts",
            before: "left",
            after: "right",
            additions: 1,
            deletions: 1,
          },
        ])
      },
    })
  })
})
