import { Installation } from "@/installation"
import { Locale } from "@/util/locale"
import type { TuiPlugin, TuiPluginModule } from "@symbolic-agent/plugin/tui"
import { createMemo, Match, Show, Switch } from "solid-js"
import { useDirectory } from "../../context/directory"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"

const id = "internal:home-footer"

function View() {
  const sync = useSync()
  const { theme } = useTheme()
  const directory = useDirectory()
  const mcp = createMemo(() => Object.keys(sync.data.mcp).length > 0)
  const err = createMemo(() => Object.values(sync.data.mcp).some((item) => item.status === "failed"))
  const count = createMemo(() => Object.values(sync.data.mcp).filter((item) => item.status === "connected").length)

  return (
    <box paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2} flexDirection="row" flexShrink={0} gap={2}>
      <text fg={theme.textMuted}>{directory()}</text>
      <box gap={1} flexDirection="row" flexShrink={0}>
        <Show when={mcp()}>
          <text fg={theme.text}>
            <Switch>
              <Match when={err()}>
                <span style={{ fg: theme.error }}>⊙ </span>
              </Match>
              <Match when={true}>
                <span style={{ fg: count() > 0 ? theme.success : theme.textMuted }}>⊙ </span>
              </Match>
            </Switch>
            {Locale.pluralize(count(), "{} MCP", "{} MCP")}
          </text>
          <text fg={theme.textMuted}>/status</text>
        </Show>
      </box>
      <box flexGrow={1} />
      <box flexShrink={0}>
        <text fg={theme.textMuted}>{Installation.VERSION}</text>
      </box>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      home_footer() {
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
