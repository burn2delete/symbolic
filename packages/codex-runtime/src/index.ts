import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from "vscode-jsonrpc/node"
import type { ChatRuntime, Hooks, PluginInput, RuntimeEvent, RuntimeInput } from "@symbolic/plugin"

type Dict = Record<string, unknown>

type Turn = {
  id: string
  status: "completed" | "interrupted" | "failed" | "inProgress"
  error: { message: string } | null
}

type Thread = {
  id: string
}

type ThreadStart = {
  thread: Thread
}

type TurnStart = {
  turn: Turn
}

type AgentItem = {
  type: "agentMessage"
  id: string
  text: string
}

type ReasonItem = {
  type: "reasoning"
  id: string
  summary: string[]
  content: string[]
}

type CommandItem = {
  type: "commandExecution"
  id: string
  command: string
  cwd: string
  status: "inProgress" | "completed" | "failed" | "declined"
  aggregatedOutput: string | null
  exitCode: number | null
  durationMs: number | null
}

type ChangeItem = {
  type: "fileChange"
  id: string
  changes: Array<{
    path: string
    kind: string
    diff: string
  }>
  status: "inProgress" | "completed" | "failed" | "declined"
}

type McpItem = {
  type: "mcpToolCall"
  id: string
  server: string
  tool: string
  status: "inProgress" | "completed" | "failed"
  arguments: unknown
  result: unknown
  error: { message: string } | null
  durationMs: number | null
}

type DynamicItem = {
  type: "dynamicToolCall"
  id: string
  tool: string
  arguments: unknown
  status: "inProgress" | "completed" | "failed"
  contentItems: Array<{ type: string; text?: string; imageUrl?: string }> | null
  success: boolean | null
  durationMs: number | null
}

type WebItem = {
  type: "webSearch"
  id: string
  query: string
  action: unknown
}

type ViewItem = {
  type: "imageView"
  id: string
  path: string
}

type TaskItem = {
  type: "collabAgentToolCall"
  id: string
  tool: string
  status: string
  prompt: string | null
  senderThreadId: string
  receiverThreadIds: string[]
  agentsStates?: Dict
}

type PlanItem = {
  type: "plan"
  id: string
  text: string
}

type Item =
  | AgentItem
  | ReasonItem
  | CommandItem
  | ChangeItem
  | McpItem
  | DynamicItem
  | WebItem
  | ViewItem
  | TaskItem
  | PlanItem

type ItemNote = {
  item: Item
  threadId: string
  turnId: string
}

type Delta = {
  itemId: string
  delta: string
  threadId: string
  turnId: string
}

type Token = {
  threadId: string
  turnId: string
  tokenUsage: {
    last: {
      inputTokens: number
      cachedInputTokens: number
      outputTokens: number
      reasoningOutputTokens: number
    }
  }
}

type Approve = {
  threadId: string
  turnId: string
  itemId: string
  approvalId?: string | null
  reason?: string | null
  command?: string | null
  cwd?: string | null
}

type Edit = {
  threadId: string
  turnId: string
  itemId: string
  reason?: string | null
  grantRoot?: string | null
}

type Ask = {
  threadId: string
  turnId: string
  itemId: string
  questions: Array<{
    id: string
    header: string
    question: string
    isOther: boolean
    isSecret: boolean
    options: Array<{
      label: string
      description: string
    }> | null
  }>
}

type Tool = {
  threadId: string
  turnId: string
  callId: string
  tool: string
  arguments: unknown
}

type Done = {
  threadId: string
  turn: Turn
}

type Start = {
  threadId: string
  turn: Turn
}

type Err = {
  message: string
}

type Cfg = {
  command?: string
  args?: string[]
  model?: string
  approval_policy?: "untrusted" | "on-failure" | "on-request" | "never"
  sandbox?: "read-only" | "workspace-write" | "danger-full-access"
  effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh"
  summary?: "auto" | "concise" | "detailed" | "none"
  personality?: "none" | "friendly" | "pragmatic"
}

function clip(text: string, max = 8_000) {
  if (text.length <= max) return text
  return text.slice(0, max) + "\n...[truncated]"
}

function text(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function list(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined
}

function rec(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  return value as Dict
}

function cfg(input: RuntimeInput): Cfg {
  const value = rec(input.agent.options["codex_app_server"])
  if (!value) return {}
  return {
    command: text(value.command),
    args: list(value.args),
    model: text(value.model),
    approval_policy: text(value.approval_policy) as Cfg["approval_policy"],
    sandbox: text(value.sandbox) as Cfg["sandbox"],
    effort: text(value.effort) as Cfg["effort"],
    summary: text(value.summary) as Cfg["summary"],
    personality: text(value.personality) as Cfg["personality"],
  }
}

function fmt(value: unknown) {
  if (typeof value === "string") return value
  return JSON.stringify(value, null, 2)
}

function tool(item: Item) {
  switch (item.type) {
    case "commandExecution":
      return "bash"
    case "fileChange":
      return "apply_patch"
    case "mcpToolCall":
      return `mcp:${item.server}:${item.tool}`
    case "dynamicToolCall":
      return `dynamic:${item.tool}`
    case "webSearch":
      return "websearch"
    case "imageView":
      return "view_image"
    case "collabAgentToolCall":
      return "task"
    case "plan":
      return "plan"
    default:
      return item.type
  }
}

function call(item: Exclude<Item, AgentItem | ReasonItem>) {
  switch (item.type) {
    case "commandExecution":
      return {
        command: item.command,
        workdir: item.cwd,
      }
    case "fileChange":
      return {
        changes: item.changes.map((change) => ({
          path: change.path,
          kind: change.kind,
        })),
      }
    case "mcpToolCall":
      return {
        server: item.server,
        tool: item.tool,
        arguments: item.arguments,
      }
    case "dynamicToolCall":
      return {
        tool: item.tool,
        arguments: item.arguments,
      }
    case "webSearch":
      return {
        query: item.query,
        action: item.action,
      }
    case "imageView":
      return {
        path: item.path,
      }
    case "collabAgentToolCall":
      return {
        tool: item.tool,
        prompt: item.prompt,
        sender: item.senderThreadId,
        receivers: item.receiverThreadIds,
      }
    case "plan":
      return {
        text: item.text,
      }
  }
}

function done(item: Exclude<Item, AgentItem | ReasonItem>): RuntimeEvent {
  switch (item.type) {
    case "commandExecution":
      if (item.status === "completed") {
        return {
          type: "tool-result",
          toolCallId: item.id,
          input: call(item),
          output: {
            title: item.command,
            output: item.aggregatedOutput ?? "",
            metadata: {
              exitCode: item.exitCode,
              durationMs: item.durationMs,
              status: item.status,
            },
          },
        }
      }
      return {
        type: "tool-error",
        toolCallId: item.id,
        input: call(item),
        error: new Error(
          item.status === "declined"
            ? "Command execution was rejected"
            : item.aggregatedOutput || `Command failed with exit code ${item.exitCode ?? "unknown"}`,
        ),
      }
    case "fileChange":
      if (item.status === "completed") {
        return {
          type: "tool-result",
          toolCallId: item.id,
          input: call(item),
          output: {
            title: `Applied ${item.changes.length} change${item.changes.length === 1 ? "" : "s"}`,
            output: clip(item.changes.map((change) => `${change.path}\n${change.diff}`).join("\n\n")),
            metadata: {
              status: item.status,
            },
          },
        }
      }
      return {
        type: "tool-error",
        toolCallId: item.id,
        input: call(item),
        error: new Error(item.status === "declined" ? "File change was rejected" : "File change failed"),
      }
    case "mcpToolCall":
      if (item.status === "completed") {
        return {
          type: "tool-result",
          toolCallId: item.id,
          input: call(item),
          output: {
            title: `${item.server}:${item.tool}`,
            output: clip(fmt(item.result ?? "")),
            metadata: {
              durationMs: item.durationMs,
            },
          },
        }
      }
      return {
        type: "tool-error",
        toolCallId: item.id,
        input: call(item),
        error: new Error(item.error?.message ?? `${item.server}:${item.tool} failed`),
      }
    case "dynamicToolCall":
      if (item.status === "completed" && item.success !== false) {
        return {
          type: "tool-result",
          toolCallId: item.id,
          input: call(item),
          output: {
            title: item.tool,
            output: clip(
              (item.contentItems ?? [])
                .map((entry) => {
                  if (entry.type === "inputText") return entry.text ?? ""
                  if (entry.type === "inputImage") return entry.imageUrl ?? ""
                  return ""
                })
                .filter(Boolean)
                .join("\n"),
            ),
            metadata: {
              durationMs: item.durationMs,
              success: item.success,
            },
          },
        }
      }
      return {
        type: "tool-error",
        toolCallId: item.id,
        input: call(item),
        error: new Error(`Dynamic tool call failed: ${item.tool}`),
      }
    case "webSearch":
      return {
        type: "tool-result",
        toolCallId: item.id,
        input: call(item),
        output: {
          title: item.query,
          output: fmt(item.action ?? ""),
          metadata: {},
        },
      }
    case "imageView":
      return {
        type: "tool-result",
        toolCallId: item.id,
        input: call(item),
        output: {
          title: item.path,
          output: item.path,
          metadata: {},
        },
      }
    case "collabAgentToolCall":
      if (item.status === "completed") {
        return {
          type: "tool-result",
          toolCallId: item.id,
          input: call(item),
          output: {
            title: item.tool,
            output: fmt(item.agentsStates ?? {}),
            metadata: {
              status: item.status,
            },
          },
        }
      }
      return {
        type: "tool-error",
        toolCallId: item.id,
        input: call(item),
        error: new Error(`Collaboration call ended with status ${item.status}`),
      }
    case "plan":
      return {
        type: "tool-result",
        toolCallId: item.id,
        input: call(item),
        output: {
          title: "Plan",
          output: item.text,
          metadata: {},
        },
      }
  }
}

function item(part: RuntimeInput["user"]["parts"][number]) {
  if (part.type === "text") {
    return {
      type: "text",
      text: part.text,
      text_elements: [],
    }
  }
  if (part.type === "file") {
    if (part.url.startsWith("file://")) {
      const path = fileURLToPath(part.url)
      if (part.mime.startsWith("image/")) {
        return {
          type: "localImage",
          path,
        }
      }
      return {
        type: "mention",
        name: part.filename,
        path,
      }
    }
    return {
      type: "text",
      text: `${part.filename}: ${part.url}`,
      text_elements: [],
    }
  }
  if (part.type === "agent") {
    return {
      type: "text",
      text: `@${part.name}`,
      text_elements: [],
    }
  }
  return
}

function history(input: RuntimeInput) {
  const rows = input.messages.filter((msg) => msg.info.id < input.user.id)
  if (!rows.length) return ""
  return rows
    .map((msg) =>
      [
        `<message role="${msg.info.role}">`,
        ...msg.parts.flatMap((part) => {
          if (part.type === "text") return [part.text]
          if (part.type === "file") return [`[file] ${part.filename} ${part.url}`]
          if (part.type === "agent") return [`[agent] ${part.name}`]
          if (part.type === "reasoning") return [`[reasoning]\n${clip(part.text, 2_000)}`]
          if (part.type === "patch") return [`[patch]\n${part.files.join("\n")}`]
          if (part.type === "tool") {
            return [
              [
                `[tool:${part.tool}] status=${part.state.status}`,
                fmt(part.state.input),
                "output" in part.state ? clip(fmt(part.state.output), 2_000) : "",
                "error" in part.state ? String(part.state.error) : "",
              ]
                .filter(Boolean)
                .join("\n"),
            ]
          }
          return []
        }),
        `</message>`,
      ].join("\n"),
    )
    .join("\n\n")
}

function prompt(input: RuntimeInput) {
  const past = history(input)
  const base = input.system.join("\n\n").trim()
  if (!past) return base
  return [
    base,
    "The following transcript was imported from the host application. Treat it as authoritative prior context.",
    "<history>",
    past,
    "</history>",
  ]
    .filter(Boolean)
    .join("\n\n")
}

function queue<T>() {
  const list: T[] = []
  const wait: Array<(value: IteratorResult<T>) => void> = []
  let err: unknown
  let done = false
  return {
    push(value: T) {
      if (done) return
      const next = wait.shift()
      if (next) {
        next({ done: false, value })
        return
      }
      list.push(value)
    },
    fail(value: unknown) {
      err = value
      done = true
      while (wait.length) {
        const next = wait.shift()
        if (next) next({ done: true, value: undefined as T })
      }
    },
    end() {
      done = true
      while (wait.length) {
        const next = wait.shift()
        if (next) next({ done: true, value: undefined as T })
      }
    },
    async *stream() {
      while (true) {
        if (list.length) {
          yield list.shift() as T
          continue
        }
        if (err) throw err
        if (done) return
        const next = await new Promise<IteratorResult<T>>((resolve) => wait.push(resolve))
        if (next.done) {
          if (err) throw err
          return
        }
        yield next.value
      }
    },
  }
}

function runtime(): ChatRuntime {
  return {
    name: "codex-app-server",
    async *run(input) {
      const q = queue<RuntimeEvent>()
      const conf = cfg(input)
      const cmd = [conf.command ?? "codex", ...(conf.args ?? ["app-server", "--listen", "stdio://"])]
      const proc = spawn(cmd[0], cmd.slice(1), {
        cwd: input.directory,
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
      })
      let err = ""
      proc.stderr.on("data", (chunk) => {
        if (err.length > 16_000) return
        err += chunk.toString()
      })
      const con = createMessageConnection(new StreamMessageReader(proc.stdout), new StreamMessageWriter(proc.stdin))
      const seen = new Map<string, string>()
      const think = new Map<string, string>()
      let thread = ""
      let turn = ""
      let tokens = {
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
      }
      let step = false
      let closed = false
      const stop = () => {
        con.end()
        con.dispose()
        if (!proc.killed) proc.kill()
      }
      const fail = (value: unknown) => {
        q.fail(value)
        stop()
      }
      proc.once("exit", (code, signal) => {
        if (closed) return
        fail(
          new Error(
            `Codex app-server exited before the turn started (${signal ?? code ?? "unknown"})${err ? `\n${clip(err)}` : ""}`,
          ),
        )
      })
      input.abort.addEventListener(
        "abort",
        () => {
          if (thread && turn) {
            void con
              .sendRequest("turn/interrupt", {
                threadId: thread,
                turnId: turn,
              })
              .catch(() => undefined)
          }
          stop()
        },
        { once: true },
      )
      con.onNotification("error", (params: Err) => {
        q.push({
          type: "error",
          error: new Error(params.message),
        })
      })
      con.onNotification("turn/started", (params: Start) => {
        turn = params.turn.id
        if (step) return
        step = true
        q.push({
          type: "start-step",
        })
      })
      con.onNotification("thread/tokenUsage/updated", (params: Token) => {
        if (params.turnId !== turn) return
        tokens = params.tokenUsage.last
      })
      con.onNotification("item/started", (params: ItemNote) => {
        if (params.turnId !== turn) return
        if (params.item.type === "agentMessage") {
          seen.set(params.item.id, "")
          q.push({
            type: "text-start",
          })
          return
        }
        if (params.item.type === "reasoning") {
          think.set(params.item.id, "")
          q.push({
            type: "reasoning-start",
            id: params.item.id,
          })
          return
        }
        if (
          params.item.type === "commandExecution" ||
          params.item.type === "fileChange" ||
          params.item.type === "mcpToolCall" ||
          params.item.type === "dynamicToolCall" ||
          params.item.type === "webSearch" ||
          params.item.type === "imageView" ||
          params.item.type === "collabAgentToolCall" ||
          params.item.type === "plan"
        ) {
          q.push({
            type: "tool-input-start",
            id: params.item.id,
            toolName: tool(params.item),
          })
          q.push({
            type: "tool-call",
            toolCallId: params.item.id,
            toolName: tool(params.item),
            input: call(params.item),
          })
        }
      })
      con.onNotification("item/agentMessage/delta", (params: Delta) => {
        if (params.turnId !== turn) return
        const prev = seen.get(params.itemId) ?? ""
        seen.set(params.itemId, prev + params.delta)
        q.push({
          type: "text-delta",
          text: params.delta,
        })
      })
      con.onNotification("item/reasoning/textDelta", (params: Delta) => {
        if (params.turnId !== turn) return
        const prev = think.get(params.itemId) ?? ""
        think.set(params.itemId, prev + params.delta)
        q.push({
          type: "reasoning-delta",
          id: params.itemId,
          text: params.delta,
        })
      })
      con.onNotification("item/reasoning/summaryTextDelta", (params: Delta) => {
        if (params.turnId !== turn) return
        const prev = think.get(params.itemId) ?? ""
        think.set(params.itemId, prev + params.delta)
        q.push({
          type: "reasoning-delta",
          id: params.itemId,
          text: params.delta,
        })
      })
      con.onNotification("item/completed", (params: ItemNote) => {
        if (params.turnId !== turn) return
        if (params.item.type === "agentMessage") {
          const prev = seen.get(params.item.id) ?? ""
          const next = params.item.text.startsWith(prev) ? params.item.text.slice(prev.length) : params.item.text
          if (next) {
            q.push({
              type: "text-delta",
              text: next,
            })
          }
          q.push({
            type: "text-end",
          })
          seen.delete(params.item.id)
          return
        }
        if (params.item.type === "reasoning") {
          const full = [...params.item.summary, ...params.item.content].join("\n")
          const prev = think.get(params.item.id) ?? ""
          const next = full.startsWith(prev) ? full.slice(prev.length) : full
          if (next) {
            q.push({
              type: "reasoning-delta",
              id: params.item.id,
              text: next,
            })
          }
          q.push({
            type: "reasoning-end",
            id: params.item.id,
          })
          think.delete(params.item.id)
          return
        }
        q.push(done(params.item))
      })
      con.onNotification("turn/completed", (params: Done) => {
        if (params.threadId !== thread) return
        if (params.turn.status === "failed") {
          q.push({
            type: "error",
            error: new Error(params.turn.error?.message ?? "Codex turn failed"),
          })
          return
        }
        q.push({
          type: "finish-step",
          finishReason: "stop",
          usage: {
            totalTokens:
              tokens.inputTokens + tokens.cachedInputTokens + tokens.outputTokens + tokens.reasoningOutputTokens,
            inputTokens: tokens.inputTokens,
            cachedInputTokens: tokens.cachedInputTokens,
            outputTokens: tokens.outputTokens,
            reasoningTokens: tokens.reasoningOutputTokens,
          },
          providerMetadata: {
            codex: {
              threadId: params.threadId,
              turnId: params.turn.id,
              status: params.turn.status,
            },
          },
        })
        q.push({
          type: "finish",
        })
        thread = params.threadId
        turn = params.turn.id
        closed = true
        q.end()
        stop()
      })
      con.onRequest("item/commandExecution/requestApproval", (params: Approve) =>
        input
          .ask({
            permission: "bash",
            patterns: [params.command ?? "command"],
            always: params.command ? [params.command] : undefined,
            callID: params.itemId,
            metadata: {
              threadId: params.threadId,
              turnId: params.turnId,
              approvalId: params.approvalId,
              reason: params.reason,
              command: params.command,
              cwd: params.cwd,
            },
          })
          .then(
            () => ({ decision: "accept" }),
            () => ({ decision: "decline" }),
          ),
      )
      con.onRequest("item/fileChange/requestApproval", (params: Edit) =>
        input
          .ask({
            permission: params.grantRoot ? "external_directory" : "edit",
            patterns: [params.grantRoot ? `${params.grantRoot}/*` : input.directory],
            always: params.grantRoot ? [`${params.grantRoot}/*`] : undefined,
            callID: params.itemId,
            metadata: {
              threadId: params.threadId,
              turnId: params.turnId,
              reason: params.reason,
              grantRoot: params.grantRoot,
            },
          })
          .then(
            () => ({ decision: "accept" }),
            () => ({ decision: "decline" }),
          ),
      )
      con.onRequest("item/tool/requestUserInput", async (params: Ask) => {
        const answers = await input.question({
          callID: params.itemId,
          questions: params.questions.map((item) => ({
            header: item.header,
            question: item.question,
            options: item.options ?? [],
            custom: item.isOther,
          })),
        })
        return {
          answers: Object.fromEntries(params.questions.map((item, ix) => [item.id, { answers: answers[ix] ?? [] }])),
        }
      })
      con.onRequest("item/tool/call", async (params: Tool) => {
        q.push({
          type: "error",
          error: new Error(`Unsupported Codex dynamic tool call: ${params.tool}`),
        })
        return {
          contentItems: [
            {
              type: "inputText",
              text: `Unsupported Codex dynamic tool call: ${params.tool}`,
            },
          ],
          success: false,
        }
      })
      con.listen()
      q.push({
        type: "start",
      })
      void con
        .sendRequest("initialize", {
          clientInfo: {
            name: "symbolic",
            title: "Symbolic",
            version: "1.2.24",
          },
          capabilities: {
            experimentalApi: true,
          },
        })
        .then(() =>
          con.sendRequest("thread/start", {
            model: conf.model ?? input.model.id,
            modelProvider: input.model.providerID,
            cwd: input.directory,
            approvalPolicy: conf.approval_policy ?? "on-request",
            sandbox: conf.sandbox ?? "workspace-write",
            config: null,
            serviceName: "symbolic",
            baseInstructions: null,
            developerInstructions: prompt(input),
            personality: conf.personality ?? "pragmatic",
            experimentalRawEvents: false,
            persistExtendedHistory: false,
          }),
        )
        .then((res) => {
          const value = res as ThreadStart
          thread = value.thread.id
          return con.sendRequest("turn/start", {
            threadId: thread,
            input: input.user.parts.flatMap((part) => {
              const value = item(part)
              return value ? [value] : []
            }),
            cwd: input.directory,
            approvalPolicy: conf.approval_policy ?? "on-request",
            sandboxPolicy: null,
            model: conf.model ?? input.model.id,
            effort: conf.effort ?? null,
            summary: conf.summary ?? "concise",
            personality: conf.personality ?? "pragmatic",
            outputSchema: input.format?.type === "json_schema" ? input.format.schema : null,
            collaborationMode: null,
          })
        })
        .then((res) => {
          const value = res as TurnStart
          turn = value.turn.id
        })
        .catch((value) => fail(value))
      try {
        for await (const event of q.stream()) {
          yield event
        }
      } finally {
        stop()
      }
    },
  }
}

export async function CodexRuntimePlugin(_input: PluginInput): Promise<Hooks> {
  return {
    async "experimental.chat.runtime"(input, output) {
      if (input.agent.options.runtime !== "codex-app-server") return
      output.runtime = runtime()
    },
  }
}

export default CodexRuntimePlugin
