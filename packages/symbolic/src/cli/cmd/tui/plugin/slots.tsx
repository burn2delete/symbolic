import { For, Show, type JSX } from "solid-js"
import { createSimpleContext } from "../context/helper"
import { createSlotHost, type SlotMap, type SlotMode } from "./host"

type Name = keyof SlotMap

export const { use: usePluginSlots, provider: PluginSlotProvider } = createSimpleContext({
  name: "PluginSlots",
  init: createSlotHost,
})

export function Slot<K extends Name>(props: {
  name: K
  mode?: SlotMode
  data?: SlotMap[K]
  children?: JSX.Element
}) {
  const host = usePluginSlots()
  const list = () => host.list(props.name)
  const data = () => (props.data ?? {}) as SlotMap[K]

  if (props.mode === "single_winner") {
    return <Show when={list()[0]} fallback={props.children}>{(item) => item().render(data())}</Show>
  }

  if (props.mode === "replace") {
    return (
      <Show when={list().length > 0} fallback={props.children}>
        <For each={list()}>{(item) => item.render(data())}</For>
      </Show>
    )
  }

  return (
    <>
      {props.children}
      <For each={list()}>{(item) => item.render(data())}</For>
    </>
  )
}
