import type {
  TuiDialogAlertProps,
  TuiDialogConfirmProps,
  TuiDialogPromptProps,
  TuiDialogSelectProps,
  TuiKey,
  TuiKeybindMap,
  TuiPluginApi,
  TuiPluginInstallResult,
  TuiPluginMeta,
  TuiPluginModule,
  TuiPluginStatus,
  TuiRouteCurrent,
  TuiRouteDefinition,
  TuiSlotPlugin,
  TuiTheme,
} from "@symbolic-agent/plugin/tui"
import { createSymbolicClient } from "@symbolic-agent/sdk/v2"
import { useRenderer } from "@opentui/solid"
import path from "path"
import { fileURLToPath } from "url"
import { createEffect, onCleanup, onMount, type JSX, type ParentProps } from "solid-js"
import { mapValues, pipe } from "remeda"
import { Config } from "@/config/config"
import { Global } from "@/global"
import { Installation } from "@/installation"
import { installPlugin as installModulePlugin, patchPluginConfig, readPluginManifest } from "@/plugin/install"
import { PluginLoader } from "@/plugin/loader"
import { PluginMeta } from "@/plugin/meta"
import {
  isPathPluginSpec,
  resolvePluginId,
  readV1Plugin,
  type PluginSource,
} from "@/plugin/shared"
import { Filesystem } from "@/util/filesystem"
import { Keybind } from "@/util/keybind"
import { useCommandDialog } from "../component/dialog-command"
import { Prompt } from "../component/prompt"
import { useKeybind } from "../context/keybind"
import { useKV } from "../context/kv"
import { useRoute } from "../context/route"
import { useSDK } from "../context/sdk"
import { useSync } from "../context/sync"
import { hasTheme, upsertTheme, useTheme } from "../context/theme"
import { useTuiConfig } from "../context/tui-config"
import { DialogAlert } from "../ui/dialog-alert"
import { DialogConfirm } from "../ui/dialog-confirm"
import { useDialog, Dialog } from "../ui/dialog"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogSelect } from "../ui/dialog-select"
import { useToast } from "../ui/toast"
import type { SlotHost } from "./host"
import { internalPlugins } from "./internal"
import { PluginSlotProvider, Slot as SlotView, usePluginSlots } from "./slots"

type TuiPluginMount = (host: SlotHost) => void | (() => void)

type Scope = {
  lifecycle: TuiPluginApi["lifecycle"]
  track: (fn: (() => void) | undefined) => () => void
  dispose: () => Promise<void>
}

type Entry = {
  id: string
  spec: string
  target: string
  root: string
  source: TuiPluginMeta["source"]
  mod: TuiPluginModule
  meta: TuiPluginMeta
  opts: Record<string, unknown> | undefined
  enabled: boolean
  scope?: Scope
  themes: Record<string, PluginMeta.Theme>
}

const DISPOSE_TIMEOUT = 5000
const KV_KEY = "plugin_enabled"

function readId(id: unknown, spec: string) {
  if (id === undefined) return
  if (typeof id !== "string") throw new TypeError(`Plugin ${spec} has invalid id type ${typeof id}`)
  const value = id.trim()
  if (!value) throw new TypeError(`Plugin ${spec} has an empty id`)
  return value
}

function routeCurrent(route: ReturnType<typeof useRoute>["data"]): TuiRouteCurrent {
  if (route.type === "home") {
    return {
      name: "home",
      params: {
        workspaceID: route.workspaceID,
        initialPrompt: route.initialPrompt,
      },
    }
  }

  if (route.type === "session") {
    return {
      name: "session",
      params: {
        sessionID: route.sessionID,
        initialPrompt: route.initialPrompt,
      },
    }
  }

  return {
    name: route.name,
    params: route.params,
  }
}

function pluginMap(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter((item): item is [string, boolean] => typeof item[1] === "boolean"))
}

function isTheme(value: unknown): value is { theme: Record<string, unknown> } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  if (!("theme" in value)) return false
  const theme = (value as { theme?: unknown }).theme
  return !!theme && typeof theme === "object" && !Array.isArray(theme)
}

function resolveRoot(source: PluginSource, spec: string, target: string) {
  const base = source === "file" ? spec : target
  if (base.startsWith("file://")) {
    const file = fileURLToPath(base)
    return base.endsWith("/") ? file : path.dirname(file)
  }
  if (path.isAbsolute(base)) return base
  return path.resolve(process.cwd(), base)
}

function createScope(spec: string, id: string): Scope {
  const ctrl = new AbortController()
  let list: { key: symbol; fn: () => void | Promise<void> }[] = []
  let done = false

  const onDispose = (fn: () => void | Promise<void>) => {
    if (done) return () => {}
    const key = Symbol()
    list.push({ key, fn })
    let drop = false
    return () => {
      if (drop) return
      drop = true
      list = list.filter((item) => item.key !== key)
    }
  }

  const track = (fn: (() => void) | undefined) => {
    if (!fn) return () => {}
    const off = onDispose(fn)
    let drop = false
    return () => {
      if (drop) return
      drop = true
      off()
      fn()
    }
  }

  return {
    lifecycle: {
      signal: ctrl.signal,
      onDispose,
    },
    track,
    async dispose() {
      if (done) return
      done = true
      ctrl.abort()
      const listRev = [...list].reverse()
      list = []
      const until = Date.now() + DISPOSE_TIMEOUT
      for (const item of listRev) {
        const left = until - Date.now()
        if (left <= 0) break
        await Promise.race([
          Promise.resolve(item.fn()),
          new Promise((resolve) => setTimeout(resolve, left)),
        ]).catch(() => {})
      }
      console.error("[tui.plugin] disposed", { spec, id })
    },
  }
}

function createKeybinds(defaults: TuiKeybindMap, overrides?: Record<string, unknown>) {
  const all = Object.freeze({
    ...defaults,
    ...Object.fromEntries(
      Object.entries(overrides ?? {}).filter((item): item is [string, string] => typeof item[1] === "string" && !!item[1].trim()),
    ),
  })
  const parsed = pipe(all, mapValues((value) => Keybind.parse(value)))

  return {
    all,
    get(name: string) {
      return all[name] ?? ""
    },
    match(name: string, evt: TuiKey) {
      const list = parsed[name]
      if (!list) return false
      const key = Keybind.fromParsedKey(evt as unknown as Parameters<typeof Keybind.fromParsedKey>[0], false)
      return list.some((item) => Keybind.match(item, key))
    },
    print(name: string) {
      const first = parsed[name]?.[0]
      if (!first) return ""
      return Keybind.toString(first)
    },
  }
}

async function loadPlugin(item: Config.PluginSpec) {
  const plan = PluginLoader.plan(item)
  if (plan.deprecated) return
  const loaded = await PluginLoader.load(await PluginLoader.resolve(plan, "tui"))
  const mod = readV1Plugin(loaded.mod, loaded.spec, "tui") as TuiPluginModule
  const id = await resolvePluginId(loaded.source, loaded.spec, loaded.target, readId(mod.id, loaded.spec))
  const meta = await PluginMeta.touch(loaded.spec, loaded.target, id)
  return {
    id,
    spec: loaded.spec,
    target: loaded.target,
    root: resolveRoot(loaded.source, loaded.spec, loaded.target),
    source: loaded.source,
    mod,
    meta: {
      state: meta.state,
      ...meta.entry,
    },
    opts: loaded.opts,
    enabled: true as boolean,
    themes: meta.entry.themes ? { ...meta.entry.themes } : {},
  } satisfies Entry
}

function loadInternal(mod: TuiPluginModule & { id?: string }) {
  const id = readId(mod.id, "internal")
  if (!id) throw new TypeError("Internal TUI plugin is missing an id")
  const now = Date.now()
  const spec = id
  return {
    id,
    spec,
    target: spec,
    root: process.cwd(),
    source: "internal" as const,
    mod,
    meta: {
      state: "same" as const,
      id,
      source: "internal" as const,
      spec,
      target: spec,
      first_time: now,
      last_time: now,
      time_changed: now,
      load_count: 1,
      fingerprint: spec,
    },
    opts: undefined,
    enabled: true as boolean,
    themes: {},
  } satisfies Entry
}

function themeInstaller(plugin: Entry, sync: ReturnType<typeof useSync>["data"]) {
  return async (file: string) => {
    const raw = file.startsWith("file://") ? fileURLToPath(file) : file
    const src = path.isAbsolute(raw) ? raw : path.resolve(plugin.root, raw)
    const name = path.basename(src, path.extname(src))
    const stat = Filesystem.stat(src)
    const mtime = stat ? Math.floor(typeof stat.mtimeMs === "bigint" ? Number(stat.mtimeMs) : stat.mtimeMs) : undefined
    const size = stat ? (typeof stat.size === "bigint" ? Number(stat.size) : stat.size) : undefined
    const destDir =
      plugin.source === "file" ? path.join(sync.path.directory || process.cwd(), ".symbolic", "themes") : path.join(Global.Path.config, "themes")
    const dest = path.join(destDir, `${name}.json`)
    const prev = plugin.themes[name]
    if (hasTheme(name) && plugin.meta.state !== "updated") return
    if (prev && prev.dest === dest && prev.mtime === mtime && prev.size === size) return

    const text = await Bun.file(src).text().catch(() => undefined)
    if (!text) return
    const data = JSON.parse(text)
    if (!isTheme(data)) return

    await Bun.write(dest, text)
    upsertTheme(name, data)
    plugin.themes[name] = { src, dest, mtime, size }
    await PluginMeta.setTheme(plugin.id, name, plugin.themes[name]!).catch(() => {})
  }
}

function status(list: Entry[]): TuiPluginStatus[] {
  return list.map((item) => ({
    id: item.id,
    source: item.meta.source,
    spec: item.spec,
    target: item.target,
    enabled: item.enabled,
    active: item.scope !== undefined,
  }))
}

function dialogStack(dialog: ReturnType<typeof useDialog>) {
  return {
    replace: dialog.replace,
    clear: dialog.clear,
    setSize: dialog.setSize,
    get size() {
      return dialog.size
    },
    get depth() {
      return dialog.stack.length
    },
    get open() {
      return dialog.stack.length > 0
    },
  }
}

function Runtime(props: ParentProps<{ plugins?: Array<{ id: string; mount: TuiPluginMount }> }>) {
  const host = usePluginSlots()
  const cmd = useCommandDialog()
  const route = useRoute()
  const dialog = useDialog()
  const toast = useToast()
  const theme = useTheme()
  const keybind = useKeybind()
  const cfg = useTuiConfig()
  const kv = useKV()
  const sync = useSync()
  const sdk = useSDK()
  const renderer = useRenderer()
  const client = new Map<string | undefined, ReturnType<typeof createSymbolicClient>>()
  const list: Entry[] = []
  const map = new Map<string, Entry>()
  const pending = new Map<string, Config.PluginSpec>()

  createEffect(() => {
    const clean = (props.plugins ?? []).flatMap((item) => {
      const stop = item.mount(host)
      return stop ? [stop] : []
    })

    onCleanup(() => {
      for (const item of clean) item()
    })
  })

  function enabledMap() {
    return {
      ...pluginMap(cfg.plugin_enabled),
      ...pluginMap(kv.get(KV_KEY, {})),
    }
  }

  function writeEnabled(id: string, enabled: boolean) {
    kv.set(KV_KEY, {
      ...pluginMap(kv.get(KV_KEY, {})),
      [id]: enabled,
    })
  }

  function currentWorkspace() {
    if (route.data.type === "home") return route.data.workspaceID
    if (route.data.type !== "session") return undefined
    return sync.session.get(route.data.sessionID)?.workspaceID
  }

  function scopedClient(workspaceID?: string) {
    const hit = client.get(workspaceID)
    if (hit) return hit
    const next = createSymbolicClient({
      baseUrl: sdk.url,
      fetch: sdk.fetch,
      directory: sdk.directory,
      experimental_workspaceID: workspaceID,
    })
    client.set(workspaceID, next)
    return next
  }

  function api(plugin: Entry, scope: Scope): TuiPluginApi {
    const stack = dialogStack(dialog)
    const themeApi: TuiTheme = {
      current: theme.theme,
      selected: theme.selected,
      has: hasTheme,
      set: theme.set,
      install: themeInstaller(plugin, sync.data),
      mode: theme.mode,
      ready: theme.ready,
    }

    return {
      app: {
        version: Installation.VERSION,
      },
      command: {
        register(cb) {
          return scope.track(
            cmd.register(() =>
              cb().map((item) => ({
                ...item,
                keybind: item.keybind as Parameters<typeof keybind.match>[0],
                onSelect: item.onSelect
                  ? () => {
                      void item.onSelect?.(stack)
                    }
                  : undefined,
              })),
            ),
          )
        },
        trigger(value) {
          cmd.trigger(value)
        },
      },
      route: {
        register(rows: TuiRouteDefinition[]) {
          const list = rows
            .filter((item) => item.name !== "home" && item.name !== "session")
            .map((item) => ({
              name: item.name,
              render: (input: { params?: Record<string, unknown> }) => item.render(input) as JSX.Element,
            }))
          return scope.track(route.register(list))
        },
        navigate(name, params) {
          if (name === "home") {
            route.navigate({
              type: "home",
              initialPrompt: params?.initialPrompt as typeof route.data extends { initialPrompt?: infer T } ? T : never,
              workspaceID: typeof params?.workspaceID === "string" ? params.workspaceID : undefined,
            })
            return
          }
          if (name === "session") {
            const sessionID = typeof params?.sessionID === "string" ? params.sessionID : ""
            if (!sessionID) return
            route.navigate({
              type: "session",
              sessionID,
              initialPrompt: params?.initialPrompt as typeof route.data extends { initialPrompt?: infer T } ? T : never,
            })
            return
          }
          route.navigate({
            type: "plugin",
            name,
            params,
          })
        },
        get current() {
          return routeCurrent(route.data)
        },
      },
      ui: {
        Dialog: (props) => <Dialog size={props.size} onClose={props.onClose}>{props.children as JSX.Element}</Dialog>,
        DialogAlert: (props: TuiDialogAlertProps) => <DialogAlert {...props} />,
        DialogConfirm: (props: TuiDialogConfirmProps) => <DialogConfirm {...props} />,
        DialogPrompt: (props: TuiDialogPromptProps) => (
          <DialogPrompt
            {...props}
            description={props.description ? () => props.description?.() as JSX.Element : undefined}
          />
        ),
        DialogSelect: <Value,>(props: TuiDialogSelectProps<Value>) => (
          <DialogSelect
            {...props}
            options={props.options.map((item) => ({
              ...item,
              footer: item.footer as JSX.Element | string | undefined,
              onSelect: item.onSelect
                ? () => {
                    item.onSelect?.()
                  }
                : undefined,
            }))}
            onMove={
              props.onMove
                ? (item) =>
                    props.onMove?.({
                      title: item.title,
                      value: item.value,
                      description: item.description,
                      footer: item.footer as JSX.Element | string | undefined,
                      category: item.category,
                      disabled: item.disabled,
                    })
                : undefined
            }
            onSelect={
              props.onSelect
                ? (item) =>
                    props.onSelect?.({
                      title: item.title,
                      value: item.value,
                      description: item.description,
                      footer: item.footer as JSX.Element | string | undefined,
                      category: item.category,
                      disabled: item.disabled,
                    })
                : undefined
            }
          />
        ),
        Prompt: (props) => <Prompt {...props} hint={props.hint as JSX.Element | undefined} />,
        toast(input) {
          toast.show({
            variant: input.variant ?? "info",
            title: input.title,
            message: input.message,
            duration: input.duration,
          })
        },
        dialog: stack,
      },
      keybind: {
        match(key, evt) {
          return !!keybind.match(key as Parameters<typeof keybind.match>[0], evt as unknown as Parameters<typeof keybind.match>[1])
        },
        print(key) {
          return keybind.print(key as Parameters<typeof keybind.print>[0])
        },
        create: createKeybinds,
      },
      tuiConfig: {
        ...cfg,
        keybinds: Object.fromEntries(
          Object.entries(cfg.keybinds ?? {}).filter((item): item is [string, string] => typeof item[1] === "string"),
        ),
      },
      kv: {
        get: kv.get,
        set: kv.set,
        ready: kv.ready,
      },
      state: {
        ready: sync.status !== "loading",
        config: sync.data.config,
        provider: sync.data.provider,
        path: sync.data.path,
        vcs: sync.data.vcs ? { branch: sync.data.vcs.branch } : undefined,
        workspace: {
          list: () => sync.data.workspaceList,
          get: (workspaceID) => sync.data.workspaceList.find((item) => item.id === workspaceID),
        },
        session: {
          count: () => sync.data.session.length,
          diff: (sessionID) => sync.data.session_diff[sessionID] ?? [],
          todo: (sessionID) => sync.data.todo[sessionID] ?? [],
          messages: (sessionID) => sync.data.message[sessionID] ?? [],
          status: (sessionID) => sync.data.session_status[sessionID],
          permission: (sessionID) => sync.data.permission[sessionID] ?? [],
          question: (sessionID) => sync.data.question[sessionID] ?? [],
        },
        part: (messageID) => sync.data.part[messageID] ?? [],
        lsp: () => sync.data.lsp.map((item) => ({ id: item.id, root: item.root, status: item.status })),
        mcp: () =>
          Object.entries(sync.data.mcp)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([name, item]) => ({
              name,
              status: item.status,
              error: "error" in item ? item.error : undefined,
            })),
      },
      theme: themeApi,
      get client() {
        return sdk.client
      },
      scopedClient,
      workspace: {
        current: currentWorkspace,
        set(workspaceID) {
          sdk.setWorkspace(workspaceID)
          if (route.data.type !== "home") return
          route.navigate({
            type: "home",
            initialPrompt: route.data.initialPrompt,
            workspaceID,
          })
        },
      },
      event: {
        on(type, handler) {
          return scope.track(sdk.event.on(type, handler))
        },
      },
      renderer: {
        get currentFocusedRenderable() {
          return renderer.currentFocusedRenderable
        },
        requestRender() {
          renderer.requestRender()
        },
      },
      slots: {
        register(item: TuiSlotPlugin) {
          const id = `${plugin.id}:${crypto.randomUUID()}`
          const register = plugin.source === "internal" ? host.registerInternal : host.registerExternal
          const clean = register({
            order: item.order,
            slots: Object.fromEntries(
              Object.entries(item.slots).map(([name, render]) => [
                name,
                render
                  ? ((props: Record<string, unknown>) => render(props as never, { theme: themeApi }) as JSX.Element)
                  : undefined,
              ]),
            ) as Parameters<typeof host.registerExternal>[0]["slots"],
          })
          scope.track(clean)
          return id
        },
      },
      plugins: {
        list() {
          return status(list)
        },
        async activate(id) {
          const plugin = map.get(id)
          if (!plugin) return false
          if (plugin.scope) return true
          plugin.enabled = true
          writeEnabled(id, true)
          return activate(plugin)
        },
        async deactivate(id) {
          const plugin = map.get(id)
          if (!plugin) return false
          plugin.enabled = false
          writeEnabled(id, false)
          if (!plugin.scope) return true
          const scope = plugin.scope
          plugin.scope = undefined
          await scope.dispose()
          return true
        },
        async add(spec) {
          const next = spec.trim()
          if (!next) return false
          const item = pending.get(next) ?? next
          const hit = await loadPlugin(item).catch(() => undefined)
          if (!hit) return false
          if (map.has(hit.id) || list.some((item) => item.spec === hit.spec)) {
            pending.delete(next)
            return true
          }
          const enabled = enabledMap()[hit.id]
          if (enabled !== undefined) hit.enabled = enabled
          list.push(hit)
          map.set(hit.id, hit)
          if (hit.enabled) {
            const ok = await activate(hit)
            if (!ok) return false
          }
          pending.delete(next)
          return true
        },
        async install(spec, options): Promise<TuiPluginInstallResult> {
          const next = spec.trim()
          if (!next) {
            return {
              ok: false,
              message: "Plugin package name is required",
            }
          }

          const installed = await installModulePlugin(next)
          if (!installed.ok) {
            return {
              ok: false,
              message: installed.error instanceof Error ? installed.error.message : String(installed.error),
            }
          }

          const manifest = await readPluginManifest(installed.target)
          if (!manifest.ok) {
            return {
              ok: false,
              message:
                manifest.code === "manifest_no_targets"
                  ? `\"${next}\" does not declare supported targets in package.json`
                  : `Installed \"${next}\" but failed to read ${manifest.file}`,
            }
          }

          const targets = manifest.targets ?? []
          const rows = [] as string[]
          for (const target of targets) {
            const item = target.opts ? ([next, target.opts] as Config.PluginSpec) : next
            const out = await patchPluginConfig({
              spec: next,
              item,
              kind: target.kind,
              global: Boolean(options?.global),
              vcs: sync.data.path.worktree && sync.data.path.worktree !== "/" ? "git" : undefined,
              worktree: sync.data.path.worktree || process.cwd(),
              directory: sync.data.path.directory || process.cwd(),
            })
            if (!out.ok) {
              if (out.code === "invalid_json") {
                return {
                  ok: false,
                  message: `Invalid JSON in ${out.file} (${out.parse} at line ${out.line}, column ${out.col})`,
                }
              }
              return {
                ok: false,
                message: out.error instanceof Error ? out.error.message : String(out.error),
              }
            }
            rows.push(out.file)
            if (target.kind === "tui") pending.set(next, item)
          }

          return {
            ok: true,
            dir: path.dirname(rows[0] ?? sync.data.path.directory ?? process.cwd()),
            tui: targets.some((item) => item.kind === "tui"),
          }
        },
      },
      lifecycle: scope.lifecycle,
    }
  }

  async function activate(plugin: Entry) {
    if (plugin.scope) return true
    const scope = createScope(plugin.spec, plugin.id)
    const ok = await Promise.resolve(plugin.mod.tui(api(plugin, scope), plugin.opts, plugin.meta))
      .then(() => true)
      .catch((err) => {
        console.error("[tui.plugin] failed to initialize", { spec: plugin.spec, id: plugin.id, err })
        return false
      })
    if (!ok) {
      await scope.dispose()
      return false
    }
    if (!plugin.enabled) {
      await scope.dispose()
      return true
    }
    plugin.scope = scope
    return true
  }

  async function loadWithRetry(item: Config.PluginSpec) {
    const first = await loadPlugin(item).catch((err) => {
      console.error("[tui.plugin] failed to load", { spec: Config.pluginSpec(item), err })
      return undefined
    })
    if (first) return first
    if (!isPathPluginSpec(Config.pluginSpec(item))) return
    await Config.waitForDependencies().catch(() => undefined)
    return loadPlugin(item).catch((err) => {
      console.error("[tui.plugin] failed to load", { spec: Config.pluginSpec(item), retry: true, err })
      return undefined
    })
  }

  onMount(() => {
    const mapEnabled = enabledMap()
    void (async () => {
      for (const mod of internalPlugins()) {
        const plugin = loadInternal(mod)
        if (map.has(plugin.id)) continue
        const enabled = mapEnabled[plugin.id]
        if (enabled !== undefined) plugin.enabled = enabled
        list.push(plugin)
        map.set(plugin.id, plugin)
      }

      for (const item of cfg.plugin ?? []) {
        const plugin = await loadWithRetry(item)
        if (!plugin) continue
        if (map.has(plugin.id)) continue
        const enabled = mapEnabled[plugin.id]
        if (enabled !== undefined) plugin.enabled = enabled
        list.push(plugin)
        map.set(plugin.id, plugin)
      }

      for (const plugin of list) {
        if (!plugin.enabled) continue
        await activate(plugin)
      }
    })()
  })

  onCleanup(() => {
    void (async () => {
      for (const plugin of [...list].reverse()) {
        await plugin.scope?.dispose()
      }
    })()
  })

  return props.children
}

export function RuntimeProvider(props: ParentProps<{ plugins?: Array<{ id: string; mount: TuiPluginMount }> }>) {
  return (
    <PluginSlotProvider>
      <Runtime plugins={props.plugins}>{props.children}</Runtime>
    </PluginSlotProvider>
  )
}

export { SlotView as Slot }
export type { TuiPluginMount }
