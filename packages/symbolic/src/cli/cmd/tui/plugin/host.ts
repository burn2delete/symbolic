import { createSignal, type JSX } from "solid-js"

export type SlotMode = "all" | "replace" | "single_winner"
export type SlotSource = "internal" | "external"

export type SlotMap = {
  app: {}
  home_logo: {}
  home_prompt: {
    workspace_id?: string
  }
  home_bottom: {}
  home_footer: {}
  sidebar_title: {
    session_id: string
    title: string
    share_url?: string
  }
  sidebar_content: {
    session_id: string
  }
  sidebar_footer: {
    session_id: string
  }
}

type Name = keyof SlotMap
type View<K extends Name> = (props: SlotMap[K]) => JSX.Element
type Entry<K extends Name = Name> = {
  order: number
  source: SlotSource
  render: View<K>
}

export type SlotHost = ReturnType<typeof createSlotHost>

export function createSlotHost() {
  const rows: Record<Name, Entry[]> = {
    app: [],
    home_logo: [],
    home_prompt: [],
    home_bottom: [],
    home_footer: [],
    sidebar_title: [],
    sidebar_content: [],
    sidebar_footer: [],
  }
  const [tick, setTick] = createSignal(0)

  function list<K extends Name>(name: K, source?: SlotSource) {
    tick()
    const list = rows[name] as Entry<K>[]
    if (!source) return list
    return list.filter((item) => item.source === source)
  }

  function add(source: SlotSource, input: {
    order?: number
    slots: Partial<{
      [K in Name]: View<K>
    }>
  }) {
    const refs: Array<readonly [Name, View<Name>]> = []
    const order = input.order ?? 0

    for (const [name, render] of Object.entries(input.slots) as Array<[Name, View<Name> | undefined]>) {
      if (!render) continue
      rows[name].push({
        order,
        source,
        render,
      })
      rows[name].sort((a, b) => b.order - a.order || (a.source === b.source ? 0 : a.source === "external" ? -1 : 1))
      refs.push([name, render])
    }

    setTick((x) => x + 1)

    return () => {
      for (const [name, render] of refs) {
        rows[name] = rows[name].filter((item) => item.render !== render)
      }
      setTick((x) => x + 1)
    }
  }

  function register(input: Parameters<typeof add>[1]) {
    return add("external", input)
  }

  function registerInternal(input: Parameters<typeof add>[1]) {
    return add("internal", input)
  }

  function registerExternal(input: Parameters<typeof add>[1]) {
    return add("external", input)
  }

  function clear(source?: SlotSource) {
    for (const name of Object.keys(rows) as Name[]) {
      rows[name] = source ? rows[name].filter((item) => item.source !== source) : []
    }
    setTick((x) => x + 1)
  }

  return {
    clear,
    list,
    register,
    registerExternal,
    registerInternal,
  }
}
