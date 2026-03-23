import { afterEach, expect, test } from "bun:test"
import z from "zod"
import { Bus } from "../src/bus"
import { BusEvent } from "../src/bus/bus-event"
import { Instance } from "../src/project/instance"
import { resetDatabase } from "./fixture/db"
import { tmpdir } from "./fixture/fixture"

afterEach(async () => {
  await resetDatabase()
})

const TestEvent = BusEvent.define("bus.test", z.object({}))

test("publish reaches all subscribers even when one unsubscribes during dispatch", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const seen: string[] = []
      const stop = Bus.subscribe(TestEvent, () => {
        seen.push("first")
        stop()
      })
      Bus.subscribe(TestEvent, () => {
        seen.push("second")
      })

      await Bus.publish(TestEvent, {})

      expect(seen).toEqual(["first", "second"])
    },
  })
})
