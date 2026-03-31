import type { AssistantMessage } from "@symbolic-agent/sdk/v2"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@symbolic-agent/plugin/tui"
import { RGBA } from "@opentui/core"
import { createMemo } from "solid-js"

const id = "internal:sidebar-context"

function col(c: { r: number; g: number; b: number; a: number }) {
  return RGBA.fromInts(c.r, c.g, c.b, c.a)
}

function View(props: { sessionID: string; api: TuiPluginApi }) {
  const msg = createMemo(() => props.api.state.session.messages(props.sessionID))
  const cost = createMemo(() => msg().reduce((sum, item) => sum + (item.role === "assistant" ? item.cost : 0), 0))

  const state = createMemo(() => {
    const last = msg().findLast((item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0)
    if (!last) {
      return { tokens: 0, percent: null as number | null }
    }

    const tokens =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const model = props.api.state.provider.find((item) => item.id === last.providerID)?.models[last.modelID]
    return {
      tokens,
      percent: model?.limit.context ? Math.round((tokens / model.limit.context) * 100) : null,
    }
  })

  const theme = () => props.api.theme.current

  return (
    <box>
      <text fg={col(theme().text)}>
        <b>Context</b>
      </text>
      <text fg={col(theme().textMuted)}>{state().tokens.toLocaleString()} tokens</text>
      <text fg={col(theme().textMuted)}>{state().percent ?? 0}% used</text>
      <text fg={col(theme().textMuted)}>
        {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cost())} spent
      </text>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
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
