import type {
  Event,
  createSymbolicClient,
  Project,
  Model,
  Provider,
  Permission,
  UserMessage,
  Message,
  Part,
  Session,
  AssistantMessage,
  Auth,
  Config,
} from "@symbolic-ai/sdk"
import type {
  OutputFormat,
  UserMessage as UserMessageV2,
  Message as MessageV2,
  Part as PartV2,
  Session as SessionV2,
  AssistantMessage as AssistantMessageV2,
} from "@symbolic-ai/sdk/v2"

import type { BunShell } from "./shell.js"
import { type ToolDefinition } from "./tool.js"

export * from "./tool.js"

export type ProviderContext = {
  source: "env" | "config" | "custom" | "api"
  info: Provider
  options: Record<string, any>
}

export type PluginInput = {
  client: ReturnType<typeof createSymbolicClient>
  project: Project
  directory: string
  worktree: string
  serverUrl: URL
  $: BunShell
}

export type Plugin = (input: PluginInput) => Promise<Hooks>

export type RuntimeRule = {
  permission: string
  pattern: string
  action: "allow" | "deny" | "ask"
}

export type RuntimeQuestion = {
  header: string
  question: string
  options: Array<{
    label: string
    description: string
  }>
  multiple?: boolean
  custom?: boolean
}

export type RuntimeUsage = {
  totalTokens: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cachedInputTokens: number
}

export type RuntimeFile = Extract<PartV2, { type: "file" }>

export type RuntimeOutput = {
  title: string
  output: string
  metadata: Record<string, unknown>
  attachments?: RuntimeFile[]
}

export type RuntimeEvent =
  | {
      type: "start"
    }
  | {
      type: "start-step"
    }
  | {
      type: "finish-step"
      finishReason: string
      usage: RuntimeUsage
      providerMetadata?: Record<string, unknown>
    }
  | {
      type: "finish"
    }
  | {
      type: "text-start"
      providerMetadata?: Record<string, unknown>
    }
  | {
      type: "text-delta"
      text: string
      providerMetadata?: Record<string, unknown>
    }
  | {
      type: "text-end"
      providerMetadata?: Record<string, unknown>
    }
  | {
      type: "reasoning-start"
      id: string
      providerMetadata?: Record<string, unknown>
    }
  | {
      type: "reasoning-delta"
      id: string
      text: string
      providerMetadata?: Record<string, unknown>
    }
  | {
      type: "reasoning-end"
      id: string
      providerMetadata?: Record<string, unknown>
    }
  | {
      type: "tool-input-start"
      id: string
      toolName: string
    }
  | {
      type: "tool-input-delta"
      id: string
      delta: string
    }
  | {
      type: "tool-input-end"
      id: string
    }
  | {
      type: "tool-call"
      toolCallId: string
      toolName: string
      input: Record<string, unknown>
      providerMetadata?: Record<string, unknown>
    }
  | {
      type: "tool-result"
      toolCallId: string
      input?: Record<string, unknown>
      output: RuntimeOutput
    }
  | {
      type: "tool-error"
      toolCallId: string
      input?: Record<string, unknown>
      error: unknown
    }
  | {
      type: "error"
      error: unknown
    }

export type RuntimeAgent = {
  name: string
  mode: "subagent" | "primary" | "all"
  description?: string
  native?: boolean
  hidden?: boolean
  topP?: number
  temperature?: number
  color?: string
  variant?: string
  prompt?: string
  steps?: number
  options: Record<string, unknown>
}

export type RuntimeInput = {
  sessionID: string
  directory: string
  worktree: string
  abort: AbortSignal
  session: SessionV2
  user: UserMessageV2 & {
    parts: PartV2[]
  }
  assistant: AssistantMessageV2
  agent: RuntimeAgent
  model: Model
  messages: {
    info: MessageV2
    parts: PartV2[]
  }[]
  system: string[]
  format?: OutputFormat
  permission: RuntimeRule[]
  ask(input: {
    permission: string
    patterns: string[]
    metadata: Record<string, unknown>
    always?: string[]
    callID?: string
  }): Promise<void>
  question(input: {
    questions: RuntimeQuestion[]
    callID?: string
  }): Promise<string[][]>
}

export type ChatRuntime = {
  name: string
  run(input: RuntimeInput): AsyncIterable<RuntimeEvent> | Promise<AsyncIterable<RuntimeEvent>>
}

export type AuthHook = {
  provider: string
  loader?: (auth: () => Promise<Auth>, provider: Provider) => Promise<Record<string, any>>
  methods: (
    | {
        type: "oauth"
        label: string
        prompts?: Array<
          | {
              type: "text"
              key: string
              message: string
              placeholder?: string
              validate?: (value: string) => string | undefined
              condition?: (inputs: Record<string, string>) => boolean
            }
          | {
              type: "select"
              key: string
              message: string
              options: Array<{
                label: string
                value: string
                hint?: string
              }>
              condition?: (inputs: Record<string, string>) => boolean
            }
        >
        authorize(inputs?: Record<string, string>): Promise<AuthOuathResult>
      }
    | {
        type: "api"
        label: string
        prompts?: Array<
          | {
              type: "text"
              key: string
              message: string
              placeholder?: string
              validate?: (value: string) => string | undefined
              condition?: (inputs: Record<string, string>) => boolean
            }
          | {
              type: "select"
              key: string
              message: string
              options: Array<{
                label: string
                value: string
                hint?: string
              }>
              condition?: (inputs: Record<string, string>) => boolean
            }
        >
        authorize?(inputs?: Record<string, string>): Promise<
          | {
              type: "success"
              key: string
              provider?: string
              enterpriseUrl?: string
            }
          | {
              type: "failed"
            }
        >
      }
  )[]
}

export type AuthOuathResult = { url: string; instructions: string } & (
  | {
      method: "auto"
      callback(): Promise<
        | ({
            type: "success"
            provider?: string
            enterpriseUrl?: string
          } & (
            | {
                refresh: string
                access: string
                expires: number
                accountId?: string
              }
            | { key: string }
          ))
        | {
            type: "failed"
          }
      >
    }
  | {
      method: "code"
      callback(code: string): Promise<
        | ({
            type: "success"
            provider?: string
            enterpriseUrl?: string
          } & (
            | {
                refresh: string
                access: string
                expires: number
                accountId?: string
              }
            | { key: string }
          ))
        | {
            type: "failed"
          }
      >
    }
)

export interface Hooks {
  event?: (input: { event: Event }) => Promise<void>
  config?: (input: Config) => Promise<void>
  tool?: {
    [key: string]: ToolDefinition
  }
  auth?: AuthHook
  /**
   * Called when a new message is received
   */
  "chat.message"?: (
    input: {
      sessionID: string
      agent?: string
      model?: { providerID: string; modelID: string }
      messageID?: string
      variant?: string
    },
    output: { message: UserMessage; parts: Part[] },
  ) => Promise<void>
  /**
   * Modify parameters sent to LLM
   */
  "chat.params"?: (
    input: { sessionID: string; agent: string; model: Model; provider: ProviderContext; message: UserMessage },
    output: { temperature: number; topP: number; topK: number; options: Record<string, any> },
  ) => Promise<void>
  "chat.headers"?: (
    input: { sessionID: string; agent: string; model: Model; provider: ProviderContext; message: UserMessage },
    output: { headers: Record<string, string> },
  ) => Promise<void>
  "permission.ask"?: (input: Permission, output: { status: "ask" | "deny" | "allow" }) => Promise<void>
  "command.execute.before"?: (
    input: { command: string; sessionID: string; arguments: string },
    output: { parts: Part[] },
  ) => Promise<void>
  "tool.execute.before"?: (
    input: { tool: string; sessionID: string; callID: string },
    output: { args: any },
  ) => Promise<void>
  "shell.env"?: (
    input: { cwd: string; sessionID?: string; callID?: string },
    output: { env: Record<string, string> },
  ) => Promise<void>
  "tool.execute.after"?: (
    input: { tool: string; sessionID: string; callID: string; args: any },
    output: {
      title: string
      output: string
      metadata: any
    },
  ) => Promise<void>
  "experimental.chat.messages.transform"?: (
    input: {},
    output: {
      messages: {
        info: Message
        parts: Part[]
      }[]
    },
  ) => Promise<void>
  "experimental.chat.system.transform"?: (
    input: { sessionID?: string; model: Model },
    output: {
      system: string[]
    },
  ) => Promise<void>
  "experimental.chat.runtime"?: (
    input: RuntimeInput,
    output: {
      runtime?: ChatRuntime
    },
  ) => Promise<void>
  /**
   * Called before session compaction starts. Allows plugins to customize
   * the compaction prompt.
   *
   * - `context`: Additional context strings appended to the default prompt
   * - `prompt`: If set, replaces the default compaction prompt entirely
   */
  "experimental.session.compacting"?: (
    input: { sessionID: string },
    output: { context: string[]; prompt?: string },
  ) => Promise<void>
  "experimental.text.complete"?: (
    input: { sessionID: string; messageID: string; partID: string },
    output: { text: string },
  ) => Promise<void>
  /**
   * Modify tool definitions (description and parameters) sent to LLM
   */
  "tool.definition"?: (input: { toolID: string }, output: { description: string; parameters: any }) => Promise<void>
}
