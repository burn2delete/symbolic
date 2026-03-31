import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionRevert } from "../../src/session/revert"
import { Server } from "../../src/server/server"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await resetDatabase()
})

describe("server error handling", () => {
  test("serializes busy session errors as a 400 response", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const app = Server.Default()
        const spy = spyOn(SessionRevert, "unrevert").mockImplementation(async () => {
          throw new Session.BusyError("ses_busy")
        })

        try {
          const res = await app.request(`/session/${session.id}/unrevert`, {
            method: "POST",
            headers: {
              "x-symbolic-directory": tmp.path,
            },
          })
          expect(res.status).toBe(400)

          const body = await res.json()
          expect(body).toMatchObject({
            name: "UnknownError",
            data: {
              message: "Session ses_busy is busy",
            },
          })
        } finally {
          spy.mockRestore()
        }
      },
    })
  })
})
