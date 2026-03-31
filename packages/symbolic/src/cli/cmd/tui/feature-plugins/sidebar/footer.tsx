import { Global } from "@/global"
import { Installation } from "@/installation"
import type { TuiPlugin, TuiPluginModule } from "@symbolic-agent/plugin/tui"
import { createMemo, Match, Show, Switch } from "solid-js"
import { useDirectory } from "../../context/directory"
import { useKV } from "../../context/kv"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"

const id = "internal:sidebar-footer"

function View() {
  const sync = useSync()
  const kv = useKV()
  const { theme } = useTheme()
  const directory = useDirectory()
  const has = createMemo(() =>
    sync.data.provider.some(
      (item) => item.id !== "symbolic" || Object.values(item.models).some((model) => model.cost?.input !== 0),
    ),
  )
  const done = createMemo(() => kv.get("dismissed_getting_started", false))
  const show = createMemo(() => !has() && !done())
  const path = createMemo(() => {
    const dir = directory()
    const out = dir.replace(Global.Path.home, "~")
    const text = sync.data.vcs?.branch ? `${out}:${sync.data.vcs.branch}` : out
    const list = text.split("/")
    return {
      parent: list.slice(0, -1).join("/"),
      name: list.at(-1) ?? "",
    }
  })

  return (
    <box gap={1}>
      <Show when={show()}>
        <box
          backgroundColor={theme.backgroundElement}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          paddingRight={2}
          flexDirection="row"
          gap={1}
        >
          <text flexShrink={0} fg={theme.text}>
            ⬖
          </text>
          <box flexGrow={1} gap={1}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={theme.text}>
                <b>Getting started</b>
              </text>
              <text fg={theme.textMuted} onMouseDown={() => kv.set("dismissed_getting_started", true)}>
                ✕
              </text>
            </box>
            <text fg={theme.textMuted}>Symbolic includes free models so you can start immediately.</text>
            <text fg={theme.textMuted}>
              Connect from 75+ providers to use other models, including Claude, GPT, Gemini etc
            </text>
            <box flexDirection="row" gap={1} justifyContent="space-between">
              <text fg={theme.text}>Connect provider</text>
              <text fg={theme.textMuted}>/connect</text>
            </box>
          </box>
        </box>
      </Show>
      <text>
        <span style={{ fg: theme.textMuted }}>{path().parent}/</span>
        <span style={{ fg: theme.text }}>{path().name}</span>
      </text>
      <text fg={theme.textMuted}>
        <span style={{ fg: theme.success }}>•</span> <b>Open</b>
        <span style={{ fg: theme.text }}>
          <b>Code</b>
        </span>{" "}
        <span>{Installation.VERSION}</span>
      </text>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      sidebar_footer() {
        return <View />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
