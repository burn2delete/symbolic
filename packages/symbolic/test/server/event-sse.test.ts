import { afterEach, describe, expect, test } from "bun:test"
import z from "zod"
import { Log } from "../../src/util/log"
import { Server } from "../../src/server/server"
import { parseSSE } from "../../src/control-plane/sse"
import { GlobalBus } from "../../src/bus/global"
import { Bus } from "../../src/bus"
import { BusEvent } from "../../src/bus/bus-event"
import { Instance } from "../../src/project/instance"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await resetDatabase()
})

Log.init({ print: false })

const Event = BusEvent.define(
  "server.event.test",
  z.object({
    seq: z.number(),
  }),
)

describe("server SSE", () => {
  test("streams instance bus events", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.Default()
    const stop = new AbortController()
    const seen: unknown[] = []

    try {
      const response = await app.request("/event", {
        signal: stop.signal,
        headers: {
          "x-symbolic-directory": tmp.path,
        },
      })

      expect(response.status).toBe(200)
      expect(response.body).toBeDefined()

      const done = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("timed out waiting for server.event.test"))
        }, 3000)

        void parseSSE(response.body!, stop.signal, (event) => {
          seen.push(event)
          const next = event as { type?: string; properties?: { seq?: number } }
          if (next.type === "server.connected") {
            void Promise.all(
              [1, 2, 3].map((seq) =>
                Instance.provide({
                  directory: tmp.path,
                  fn: () => Bus.publish(Event, { seq }),
                }),
              ),
            )
            return
          }
          const seqs = seen
            .filter((item): item is { type?: string; properties?: { seq?: number } } => Boolean(item))
            .filter((item) => item.type === Event.type)
            .map((item) => item.properties?.seq)
          if (seqs.length < 3) return
          clearTimeout(timeout)
          resolve()
        }).catch((error) => {
          clearTimeout(timeout)
          reject(error)
        })
      })

      await done

      expect(seen.some((event) => (event as { type?: string }).type === "server.connected")).toBe(true)
      expect(
        seen.filter((event) => (event as { type?: string }).type === Event.type).map((event) => (event as any).properties.seq),
      ).toEqual([1, 2, 3])
    } finally {
      stop.abort()
    }
  })

  test("streams global bus events", async () => {
    await using tmp = await tmpdir()
    const app = Server.Default()
    const stop = new AbortController()
    const seen: unknown[] = []

    try {
      const response = await app.request("/global/event", {
        signal: stop.signal,
      })

      expect(response.status).toBe(200)
      expect(response.body).toBeDefined()

      const done = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("timed out waiting for global bus events"))
        }, 3000)

        void parseSSE(response.body!, stop.signal, (event) => {
          seen.push(event)
          const next = event as { payload?: { type?: string; properties?: { seq?: number } } }
          if (next.payload?.type === "server.connected") {
            for (const seq of [1, 2, 3]) {
              GlobalBus.emit("event", {
                directory: tmp.path,
                payload: {
                  type: Event.type,
                  properties: { seq },
                },
              })
            }
            return
          }

          const seqs = seen
            .map((item) => (item as { payload?: { type?: string; properties?: { seq?: number } } }).payload)
            .filter((item) => item?.type === Event.type)
            .map((item) => item?.properties?.seq)
          if (seqs.length < 3) return
          clearTimeout(timeout)
          resolve()
        }).catch((error) => {
          clearTimeout(timeout)
          reject(error)
        })
      })

      await done

      expect(seen).toContainEqual({
        directory: tmp.path,
        payload: {
          type: Event.type,
          properties: { seq: 1 },
        },
      })
      expect(seen).toContainEqual({
        directory: tmp.path,
        payload: {
          type: Event.type,
          properties: { seq: 2 },
        },
      })
      expect(seen).toContainEqual({
        directory: tmp.path,
        payload: {
          type: Event.type,
          properties: { seq: 3 },
        },
      })
    } finally {
      stop.abort()
    }
  })
})
