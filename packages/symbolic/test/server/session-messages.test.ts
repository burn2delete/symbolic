import { afterEach, describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await resetDatabase()
})

async function fill(sessionID: SessionID, count: number, time = (i: number) => Date.now() + i) {
  const ids = [] as MessageID[]
  for (let i = 0; i < count; i++) {
    const id = MessageID.ascending()
    ids.push(id)
    await Session.updateMessage({
      id,
      sessionID,
      role: "user",
      time: { created: time(i) },
      agent: "test",
      model: { providerID: "test", modelID: "test" },
      tools: {},
      mode: "",
    } as unknown as MessageV2.Info)
    await Session.updatePart({
      id: PartID.ascending(),
      sessionID,
      messageID: id,
      type: "text",
      text: `m${i}`,
    })
  }
  return ids
}

describe("session messages endpoint", () => {
  test("returns cursor headers for older pages", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const ids = await fill(session.id, 5)
        const app = Server.Default()

        const a = await app.request(`/session/${session.id}/message?limit=2`)
        expect(a.status).toBe(200)
        const aBody = (await a.json()) as MessageV2.WithParts[]
        expect(aBody.map((item) => item.info.id)).toEqual(ids.slice(-2))
        const cursor = a.headers.get("x-next-cursor")
        expect(cursor).toBeTruthy()
        expect(a.headers.get("link")).toContain('rel="next"')

        const b = await app.request(`/session/${session.id}/message?limit=2&before=${encodeURIComponent(cursor!)}`)
        expect(b.status).toBe(200)
        const bBody = (await b.json()) as MessageV2.WithParts[]
        expect(bBody.map((item) => item.info.id)).toEqual(ids.slice(-4, -2))
      },
    })
  })

  test("keeps full-history responses when limit is omitted", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const ids = await fill(session.id, 3)
        const app = Server.Default()

        const res = await app.request(`/session/${session.id}/message`)
        expect(res.status).toBe(200)
        const body = (await res.json()) as MessageV2.WithParts[]
        expect(body.map((item) => item.info.id)).toEqual(ids)
      },
    })
  })

  test("rejects invalid cursors and missing sessions", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const app = Server.Default()

        const bad = await app.request(`/session/${session.id}/message?limit=2&before=bad`)
        expect(bad.status).toBe(400)

        const miss = await app.request(`/session/ses_missing/message?limit=2`)
        expect(miss.status).toBe(404)
      },
    })
  })

  test("does not truncate large legacy limit requests", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await fill(session.id, 520)
        const app = Server.Default()

        const res = await app.request(`/session/${session.id}/message?limit=510`)
        expect(res.status).toBe(200)
        const body = (await res.json()) as MessageV2.WithParts[]
        expect(body).toHaveLength(510)
      },
    })
  })
})

describe("session prompt async", () => {
  test("returns 204 and handles prompt failures asynchronously", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const app = Server.Default()
        const err = new Promise((resolve) => {
          process.once("unhandledRejection", resolve)
        })

        const res = await app.request(`/session/${session.id}/prompt_async`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            agent: "missing-agent",
            parts: [{ type: "text", text: "hello" }],
          }),
        })

        expect(res.status).toBe(204)

        const winner = await Promise.race([
          err.then(() => "rejected"),
          new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 100)),
        ])
        expect(winner).toBe("timeout")
      },
    })
  })
})
