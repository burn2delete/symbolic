import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@symbolic-agent/plugin/tui"
import { RGBA } from "@opentui/core"
import { createMemo, For, Show, createSignal } from "solid-js"
import { TodoItem } from "../../component/todo-item"

const id = "internal:sidebar-todo"

function col(c: { r: number; g: number; b: number; a: number }) {
  return RGBA.fromInts(c.r, c.g, c.b, c.a)
}

function View(props: { api: TuiPluginApi; sessionID: string }) {
  const [open, setOpen] = createSignal(true)
  const list = createMemo(() => props.api.state.session.todo(props.sessionID))
  const show = createMemo(() => list().length > 0 && list().some((item) => item.status !== "completed"))
  const theme = () => props.api.theme.current

  return (
    <Show when={show()}>
      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => list().length > 2 && setOpen((x) => !x)}>
          <Show when={list().length > 2}>
            <text fg={col(theme().text)}>{open() ? "▼" : "▶"}</text>
          </Show>
          <text fg={col(theme().text)}>
            <b>Todo</b>
          </text>
        </box>
        <Show when={list().length <= 2 || open()}>
          <For each={list()}>{(item) => <TodoItem status={item.status} content={item.content} />}</For>
        </Show>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 400,
    slots: {
      sidebar_content(props) {
        return <View api={api} sessionID={props.session_id} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
