import type {
  Event,
  LspStatus,
  McpStatus,
  Todo,
  Message,
  Part,
  Provider,
  PermissionRequest,
  QuestionRequest,
  SessionStatus,
  Workspace,
  Config as SdkConfig,
  AgentPart,
  FilePart,
  TextPart,
} from "@symbolic-agent/sdk/v2"

import type { PluginOptions } from "./index.js"

export type TuiNode = unknown

export type TuiColor = {
  r: number
  g: number
  b: number
  a: number
}

export type TuiKey = {
  name: string
  ctrl: boolean
  meta: boolean
  shift: boolean
  super?: boolean
  leader: boolean
}

export type TuiRenderable = {
  blur?: () => void
  focus?: () => void
  isDestroyed?: boolean
}

export type TuiRenderer = {
  currentFocusedRenderable: TuiRenderable | null
  requestRender: () => void
}

export type TuiSlotMode = "all" | "replace" | "single_winner"

export type SlotMode = TuiSlotMode

export type TuiPromptPart =
  | Omit<FilePart, "id" | "messageID" | "sessionID">
  | Omit<AgentPart, "id" | "messageID" | "sessionID">
  | (Omit<TextPart, "id" | "messageID" | "sessionID"> & {
      source?: {
        text: {
          start: number
          end: number
          value: string
        }
      }
    })

export type TuiPromptInfo = {
  input: string
  mode?: "normal" | "shell"
  parts: TuiPromptPart[]
}

export type TuiRouteCurrent =
  | {
      name: "home"
      params?: {
        workspaceID?: string
        initialPrompt?: TuiPromptInfo
      }
    }
  | {
      name: "session"
      params: {
        sessionID: string
        initialPrompt?: TuiPromptInfo
      }
    }
  | {
      name: string
      params?: Record<string, unknown>
    }

export type TuiRouteDefinition = {
  name: string
  render: (input: { params?: Record<string, unknown> }) => TuiNode
}

export type TuiCommand = {
  title: string
  value: string
  description?: string
  category?: string
  keybind?: string
  suggested?: boolean
  hidden?: boolean
  enabled?: boolean
  slash?: {
    name: string
    aliases?: string[]
  }
  onSelect?: (dialog: TuiDialogStack) => void | Promise<void>
}

export type TuiKeybind = {
  name: string
  ctrl: boolean
  meta: boolean
  shift: boolean
  super?: boolean
  leader: boolean
}

export type TuiKeybindMap = Record<string, string>

export type TuiKeybindSet = {
  readonly all: TuiKeybindMap
  get: (name: string) => string
  match: (name: string, evt: TuiKey) => boolean
  print: (name: string) => string
}

export type TuiDialogProps = {
  size?: "medium" | "large" | "xlarge"
  onClose: () => void
  children?: TuiNode
}

export type TuiDialogStack = {
  replace: (render: () => TuiNode, onClose?: () => void) => void
  clear: () => void
  setSize: (size: "medium" | "large" | "xlarge") => void
  readonly size: "medium" | "large" | "xlarge"
  readonly depth: number
  readonly open: boolean
}

export type TuiDialogAlertProps = {
  title: string
  message: string
  onConfirm?: () => void
}

export type TuiDialogConfirmProps = {
  title: string
  message: string
  onConfirm?: () => void
  onCancel?: () => void
}

export type TuiDialogPromptProps = {
  title: string
  description?: () => TuiNode
  placeholder?: string
  value?: string
  busy?: boolean
  busyText?: string
  onConfirm?: (value: string) => void
  onCancel?: () => void
}

export type TuiDialogSelectOption<Value = unknown> = {
  title: string
  value: Value
  description?: string
  footer?: TuiNode | string
  category?: string
  disabled?: boolean
  onSelect?: () => void
}

export type TuiDialogSelectProps<Value = unknown> = {
  title: string
  placeholder?: string
  options: TuiDialogSelectOption<Value>[]
  flat?: boolean
  onMove?: (option: TuiDialogSelectOption<Value>) => void
  onFilter?: (query: string) => void
  onSelect?: (option: TuiDialogSelectOption<Value>) => void
  skipFilter?: boolean
  current?: Value
}

export type TuiPromptRef = {
  focused: boolean
  current: TuiPromptInfo
  set(prompt: TuiPromptInfo): void
  reset(): void
  blur(): void
  focus(): void
  submit(): void
}

export type TuiPromptProps = {
  sessionID?: string
  workspaceID?: string
  visible?: boolean
  disabled?: boolean
  onSubmit?: () => void
  ref?: (ref: TuiPromptRef) => void
  hint?: TuiNode
  showPlaceholder?: boolean
  placeholders?: {
    normal?: string[]
    shell?: string[]
  }
}

export type TuiToast = {
  variant?: "info" | "success" | "warning" | "error"
  title?: string
  message: string
  duration?: number
}

export type TuiThemeCurrent = {
  readonly primary: TuiColor
  readonly secondary: TuiColor
  readonly accent: TuiColor
  readonly error: TuiColor
  readonly warning: TuiColor
  readonly success: TuiColor
  readonly info: TuiColor
  readonly text: TuiColor
  readonly textMuted: TuiColor
  readonly selectedListItemText: TuiColor
  readonly background: TuiColor
  readonly backgroundPanel: TuiColor
  readonly backgroundElement: TuiColor
  readonly backgroundMenu: TuiColor
  readonly border: TuiColor
  readonly borderActive: TuiColor
  readonly borderSubtle: TuiColor
  readonly diffAdded: TuiColor
  readonly diffRemoved: TuiColor
  readonly diffContext: TuiColor
  readonly diffHunkHeader: TuiColor
  readonly diffHighlightAdded: TuiColor
  readonly diffHighlightRemoved: TuiColor
  readonly diffAddedBg: TuiColor
  readonly diffRemovedBg: TuiColor
  readonly diffContextBg: TuiColor
  readonly diffLineNumber: TuiColor
  readonly diffAddedLineNumberBg: TuiColor
  readonly diffRemovedLineNumberBg: TuiColor
  readonly markdownText: TuiColor
  readonly markdownHeading: TuiColor
  readonly markdownLink: TuiColor
  readonly markdownLinkText: TuiColor
  readonly markdownCode: TuiColor
  readonly markdownBlockQuote: TuiColor
  readonly markdownEmph: TuiColor
  readonly markdownStrong: TuiColor
  readonly markdownHorizontalRule: TuiColor
  readonly markdownListItem: TuiColor
  readonly markdownListEnumeration: TuiColor
  readonly markdownImage: TuiColor
  readonly markdownImageText: TuiColor
  readonly markdownCodeBlock: TuiColor
  readonly syntaxComment: TuiColor
  readonly syntaxKeyword: TuiColor
  readonly syntaxFunction: TuiColor
  readonly syntaxVariable: TuiColor
  readonly syntaxString: TuiColor
  readonly syntaxNumber: TuiColor
  readonly syntaxType: TuiColor
  readonly syntaxOperator: TuiColor
  readonly syntaxPunctuation: TuiColor
  readonly thinkingOpacity: number
}

export type TuiTheme = {
  readonly current: TuiThemeCurrent
  readonly selected: string
  has: (name: string) => boolean
  set: (name: string) => boolean
  install: (jsonPath: string) => Promise<void>
  mode: () => "dark" | "light"
  readonly ready: boolean
}

export type TuiKV = {
  get: <Value = unknown>(key: string, fallback?: Value) => Value
  set: (key: string, value: unknown) => void
  readonly ready: boolean
}

export type TuiState = {
  readonly ready: boolean
  readonly config: SdkConfig
  readonly provider: ReadonlyArray<Provider>
  readonly path: {
    state: string
    config: string
    worktree: string
    directory: string
  }
  readonly vcs: { branch?: string } | undefined
  readonly workspace: {
    list: () => ReadonlyArray<Workspace>
    get: (workspaceID: string) => Workspace | undefined
  }
  session: {
    count: () => number
    diff: (sessionID: string) => ReadonlyArray<TuiSidebarFileItem>
    todo: (sessionID: string) => ReadonlyArray<TuiSidebarTodoItem>
    messages: (sessionID: string) => ReadonlyArray<Message>
    status: (sessionID: string) => SessionStatus | undefined
    permission: (sessionID: string) => ReadonlyArray<PermissionRequest>
    question: (sessionID: string) => ReadonlyArray<QuestionRequest>
  }
  part: (messageID: string) => ReadonlyArray<Part>
  lsp: () => ReadonlyArray<TuiSidebarLspItem>
  mcp: () => ReadonlyArray<TuiSidebarMcpItem>
}

type TuiConfigView = {
  $schema?: string
  theme?: string
  keybinds?: Record<string, string>
  plugin?: ReadonlyArray<string | readonly [string, Record<string, unknown>]>
  plugin_enabled?: Record<string, boolean>
  [key: string]: unknown
}

export type TuiApp = {
  readonly version: string
}

type Frozen<Value> = Value extends (...args: never[]) => unknown
  ? Value
  : Value extends ReadonlyArray<infer Item>
    ? ReadonlyArray<Frozen<Item>>
    : Value extends object
      ? { readonly [Key in keyof Value]: Frozen<Value[Key]> }
      : Value

export type TuiSidebarMcpItem = {
  name: string
  status: McpStatus["status"]
  error?: string
}

export type TuiSidebarLspItem = Pick<LspStatus, "id" | "root" | "status">

export type TuiSidebarTodoItem = Pick<Todo, "content" | "status">

export type TuiSidebarFileItem = {
  file: string
  additions: number
  deletions: number
}

export type TuiSlotMap = {
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

export type TuiSlotContext = {
  theme: TuiTheme
}

export type TuiSlotPlugin = {
  id?: never
  order?: number
  slots: Partial<{
    [K in keyof TuiSlotMap]: (props: TuiSlotMap[K], ctx: TuiSlotContext) => TuiNode
  }>
}

export type TuiSlots = {
  register: (plugin: TuiSlotPlugin) => string
}

export type TuiEventBus = {
  on: <Type extends Event["type"]>(type: Type, handler: (event: Extract<Event, { type: Type }>) => void) => () => void
}

export type TuiDispose = () => void | Promise<void>

export type TuiLifecycle = {
  readonly signal: AbortSignal
  onDispose: (fn: TuiDispose) => () => void
}

export type TuiPluginState = "first" | "updated" | "same"

export type TuiPluginEntry = {
  id: string
  source: "file" | "npm" | "internal"
  spec: string
  target: string
  requested?: string
  version?: string
  modified?: number
  first_time: number
  last_time: number
  time_changed: number
  load_count: number
  fingerprint: string
}

export type TuiPluginMeta = TuiPluginEntry & {
  state: TuiPluginState
}

export type TuiPluginStatus = {
  id: string
  source: TuiPluginEntry["source"]
  spec: string
  target: string
  enabled: boolean
  active: boolean
}

export type TuiPluginInstallOptions = {
  global?: boolean
}

export type TuiPluginInstallResult =
  | {
      ok: true
      dir: string
      tui: boolean
    }
  | {
      ok: false
      message: string
      missing?: boolean
    }

export type TuiWorkspace = {
  current: () => string | undefined
  set: (workspaceID?: string) => void
}

export type TuiPluginApi = {
  app: TuiApp
  command: {
    register: (cb: () => TuiCommand[]) => () => void
    trigger: (value: string) => void
  }
  route: {
    register: (routes: TuiRouteDefinition[]) => () => void
    navigate: (name: string, params?: Record<string, unknown>) => void
    readonly current: TuiRouteCurrent
  }
  ui: {
    Dialog: (props: TuiDialogProps) => TuiNode
    DialogAlert: (props: TuiDialogAlertProps) => TuiNode
    DialogConfirm: (props: TuiDialogConfirmProps) => TuiNode
    DialogPrompt: (props: TuiDialogPromptProps) => TuiNode
    DialogSelect: <Value = unknown>(props: TuiDialogSelectProps<Value>) => TuiNode
    Prompt: (props: TuiPromptProps) => TuiNode
    toast: (input: TuiToast) => void
    dialog: TuiDialogStack
  }
  keybind: {
    match: (key: string, evt: TuiKey) => boolean
    print: (key: string) => string
    create: (defaults: TuiKeybindMap, overrides?: Record<string, unknown>) => TuiKeybindSet
  }
  readonly tuiConfig: Frozen<TuiConfigView>
  kv: TuiKV
  state: TuiState
  theme: TuiTheme
  client: ReturnType<typeof import("@symbolic-agent/sdk/v2").createSymbolicClient>
  scopedClient: (workspaceID?: string) => ReturnType<typeof import("@symbolic-agent/sdk/v2").createSymbolicClient>
  workspace: TuiWorkspace
  event: TuiEventBus
  renderer: TuiRenderer
  slots: TuiSlots
  plugins: {
    list: () => ReadonlyArray<TuiPluginStatus>
    activate: (id: string) => Promise<boolean>
    deactivate: (id: string) => Promise<boolean>
    add: (spec: string) => Promise<boolean>
    install: (spec: string, options?: TuiPluginInstallOptions) => Promise<TuiPluginInstallResult>
  }
  lifecycle: TuiLifecycle
}

export type TuiPlugin = (api: TuiPluginApi, options: PluginOptions | undefined, meta: TuiPluginMeta) => void | Promise<void>

export type TuiPluginModule = {
  id?: string
  tui: TuiPlugin
  server?: never
}
