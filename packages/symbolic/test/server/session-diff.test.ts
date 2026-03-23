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
  test("returns message diffs when a message id is provided", async () => {
    await using tmp = await tmpdir()
    const app = Server.Default()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const messageID = MessageID.ascending()

        await Session.updateMessage({
          id: messageID,
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

        const res = await app.request(`/session/${session.id}/diff?messageID=${messageID}`, {
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

        const direct = await SessionSummary.diff({
          sessionID: session.id,
          messageID,
        })
        expect(direct).toEqual([
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
