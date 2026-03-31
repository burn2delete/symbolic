import type { JSX } from "solid-js"
import { createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "./helper"
import type { PromptInfo } from "../component/prompt/history"

export type HomeRoute = {
  type: "home"
  initialPrompt?: PromptInfo
  workspaceID?: string
}

export type SessionRoute = {
  type: "session"
  sessionID: string
  initialPrompt?: PromptInfo
}

export type PluginRoute = {
  type: "plugin"
  name: string
  params?: Record<string, unknown>
}

export type PluginView = {
  name: string
  render: (input: { params?: Record<string, unknown> }) => JSX.Element
}

export type Route = HomeRoute | SessionRoute | PluginRoute

export const { use: useRoute, provider: RouteProvider } = createSimpleContext({
  name: "Route",
  init: () => {
    const [list, setList] = createSignal<Array<{ key: symbol; routes: PluginView[] }>>([])
    const [store, setStore] = createStore<Route>(
      process.env["SYMBOLIC_ROUTE"]
        ? JSON.parse(process.env["SYMBOLIC_ROUTE"])
        : {
            type: "home",
          },
    )

    return {
      get data() {
        return store
      },
      navigate(route: Route) {
        setStore(route)
      },
      register(input: PluginView[]) {
        const key = Symbol()
        setList((arr) => [...arr, { key, routes: input }])
        const off = () => {
          setList((arr) => arr.filter((item) => item.key !== key))
        }
        return off
      },
      render() {
        if (store.type !== "plugin") return
        const hit = list()
          .flatMap((item) => item.routes)
          .toReversed()
          .find((item) => item.name === store.name)
        return hit?.render({
          params: store.params,
        })
      },
    }
  },
})

export type RouteContext = ReturnType<typeof useRoute>

export function useRouteData<T extends Route["type"]>(type: T) {
  const route = useRoute()
  return route.data as Extract<Route, { type: typeof type }>
}
