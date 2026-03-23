import { afterEach, describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { SessionStatus } from "../../src/session/status"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await resetDatabase()
})

describe("session status endpoint", () => {
  test("serializes map-backed status as a plain object", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await SessionStatus.set(session.id, { type: "busy" })

        const res = await Server.Default().request("/session/status", {
          headers: {
            "x-symbolic-directory": tmp.path,
          },
        })
        expect(res.status).toBe(200)
        const body = (await res.json()) as Record<string, SessionStatus.Info>

        expect(body[session.id]).toEqual({ type: "busy" })
      },
    })
  })
})
