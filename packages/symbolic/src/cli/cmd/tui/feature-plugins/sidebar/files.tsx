import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@symbolic-agent/plugin/tui"
import { RGBA } from "@opentui/core"
import { createMemo, For, Show, createSignal } from "solid-js"

const id = "internal:sidebar-files"

function col(c: { r: number; g: number; b: number; a: number }) {
  return RGBA.fromInts(c.r, c.g, c.b, c.a)
}

function View(props: { api: TuiPluginApi; sessionID: string }) {
  const [open, setOpen] = createSignal(true)
  const list = createMemo(() => props.api.state.session.diff(props.sessionID))
  const theme = () => props.api.theme.current

  return (
    <Show when={list().length > 0}>
      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => list().length > 2 && setOpen((x) => !x)}>
          <Show when={list().length > 2}>
            <text fg={col(theme().text)}>{open() ? "▼" : "▶"}</text>
          </Show>
          <text fg={col(theme().text)}>
            <b>Modified Files</b>
          </text>
        </box>
        <Show when={list().length <= 2 || open()}>
          <For each={list()}>
            {(item) => (
              <box flexDirection="row" gap={1} justifyContent="space-between">
                <text fg={col(theme().textMuted)} wrapMode="none">
                  {item.file}
                </text>
                <box flexDirection="row" gap={1} flexShrink={0}>
                  <Show when={item.additions}>
                    <text fg={col(theme().diffAdded)}>+{item.additions}</text>
                  </Show>
                  <Show when={item.deletions}>
                    <text fg={col(theme().diffRemoved)}>-{item.deletions}</text>
                  </Show>
                </box>
              </box>
            )}
          </For>
        </Show>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 500,
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
