import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@symbolic-agent/plugin/tui"
import { RGBA } from "@opentui/core"
import { createMemo, For, Show, createSignal } from "solid-js"

const id = "internal:sidebar-lsp"

function col(c: { r: number; g: number; b: number; a: number }) {
  return RGBA.fromInts(c.r, c.g, c.b, c.a)
}

function View(props: { api: TuiPluginApi }) {
  const [open, setOpen] = createSignal(true)
  const list = createMemo(() => props.api.state.lsp())
  const off = createMemo(() => props.api.state.config.lsp === false)
  const theme = () => props.api.theme.current

  return (
    <box>
        <box flexDirection="row" gap={1} onMouseDown={() => list().length > 2 && setOpen((x) => !x)}>
          <Show when={list().length > 2}>
            <text fg={col(theme().text)}>{open() ? "▼" : "▶"}</text>
          </Show>
          <text fg={col(theme().text)}>
            <b>LSP</b>
          </text>
        </box>
      <Show when={list().length <= 2 || open()}>
        <Show when={list().length === 0}>
          <text fg={col(theme().textMuted)}>
            {off() ? "LSPs have been disabled in settings" : "LSPs will activate as files are read"}
          </text>
        </Show>
        <For each={list()}>
          {(item) => (
            <box flexDirection="row" gap={1}>
              <text flexShrink={0} style={{ fg: item.status === "connected" ? col(theme().success) : col(theme().error) }}>
                •
              </text>
              <text fg={col(theme().textMuted)}>
                {item.id} {item.root}
              </text>
            </box>
          )}
        </For>
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 300,
    slots: {
      sidebar_content() {
        return <View api={api} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
