import { describe, expect, test } from "bun:test"
import type { JSX } from "solid-js"
import { createSlotHost } from "../../../src/cli/cmd/tui/plugin/host"

function view(label: string) {
  return () => label as unknown as JSX.Element
}

describe("tui.plugin.slots", () => {
  test("orders slot registrations by descending order", () => {
    const host = createSlotHost()
    const low = view("low")
    const high = view("high")

    host.register({
      order: 10,
      slots: {
        home_footer: low,
      },
    })
    host.register({
      order: 20,
      slots: {
        home_footer: high,
      },
    })

    expect(host.list("home_footer").map((item) => item.render)).toEqual([high, low])
  })

  test("unregister removes only the registered slot views", () => {
    const host = createSlotHost()
    const keep = view("keep")
    const drop = view("drop")

    host.registerExternal({
      order: 10,
      slots: {
        home_footer: keep,
      },
    })
    const stop = host.registerExternal({
      order: 20,
      slots: {
        home_footer: drop,
      },
    })

    stop()

    expect(host.list("home_footer").map((item) => item.render)).toEqual([keep])
  })

  test("keeps internal slots separate from external slots", () => {
    const host = createSlotHost()
    const internal = view("internal")
    const external = view("external")

    host.registerInternal({
      order: 5,
      slots: {
        home_footer: internal,
      },
    })
    host.registerExternal({
      order: 5,
      slots: {
        home_footer: external,
      },
    })

    expect(host.list("home_footer").map((item) => item.render)).toEqual([external, internal])
    expect(host.list("home_footer", "internal").map((item) => item.render)).toEqual([internal])
    expect(host.list("home_footer", "external").map((item) => item.render)).toEqual([external])
  })

  test("clear removes only the requested source", () => {
    const host = createSlotHost()
    const internal = view("internal")
    const external = view("external")

    host.registerInternal({
      order: 5,
      slots: {
        home_footer: internal,
      },
    })
    host.registerExternal({
      order: 5,
      slots: {
        home_footer: external,
      },
    })

    host.clear("external")

    expect(host.list("home_footer").map((item) => item.render)).toEqual([internal])
  })
})
