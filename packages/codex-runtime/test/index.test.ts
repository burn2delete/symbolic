import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { CodexRuntimePlugin } from "../src/index"
import type { ChatRuntime, PluginInput, RuntimeEvent, RuntimeInput } from "@symbolic-ai/plugin"

async function fixture(source: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-runtime-"))
  const file = path.join(dir, "server.mjs")
  await Bun.write(file, source)
  return {
    dir,
    file,
    async [Symbol.asyncDispose]() {
      await fs.rm(dir, { recursive: true, force: true })
    },
  }
}

async function runtime(input: RuntimeInput) {
  const hooks = await CodexRuntimePlugin({} as PluginInput)
  const output: {
    runtime?: ChatRuntime
  } = {
    runtime: undefined,
  }
  await hooks["experimental.chat.runtime"]?.(input, output)
  return output.runtime as ChatRuntime
}

async function collect(input: RuntimeInput) {
  const match = await runtime(input)
  const stream = await Promise.resolve(match.run(input))
  const result: RuntimeEvent[] = []
  for await (const event of stream) {
    result.push(event)
  }
  return result
}

function model() {
  return {
    id: "gpt-5",
    providerID: "openai",
  } as RuntimeInput["model"]
}

function input(file: string, extra?: Partial<RuntimeInput>): RuntimeInput {
  const user = {
    id: "message_user",
    sessionID: "session_test",
    role: "user",
    time: {
      created: 0,
    },
    agent: "build",
    model: {
      providerID: "openai",
      modelID: "gpt-5",
    },
    parts: [
      {
        id: "part_user",
        sessionID: "session_test",
        messageID: "message_user",
        type: "text",
        text: "hello",
      },
    ],
  } as RuntimeInput["user"]
  return {
    sessionID: "session_test",
    directory: process.cwd(),
    worktree: process.cwd(),
    abort: new AbortController().signal,
    session: {
      id: "session_test",
    } as RuntimeInput["session"],
    user,
    assistant: {
      id: "message_assistant",
      sessionID: "session_test",
      role: "assistant",
      parentID: "message_user",
      mode: "build",
      agent: "build",
      path: {
        cwd: process.cwd(),
        root: process.cwd(),
      },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
      modelID: "gpt-5",
      providerID: "openai",
      time: {
        created: 0,
      },
    } as RuntimeInput["assistant"],
    agent: {
      name: "build",
      mode: "primary",
      options: {
        runtime: "codex-app-server",
        codex_app_server: {
          command: "node",
          args: [file],
        },
      },
    },
    model: model(),
    messages: [
      {
        info: user,
        parts: user.parts,
      },
    ],
    system: ["system"],
    permission: [],
    ask: async () => {},
    question: async () => [],
    ...extra,
  }
}

function server(body: string) {
  return [
    "let seq = 0",
    "const wait = new Map()",
    "let buf = Buffer.alloc(0)",
    "const thread = { id: 'thread_1' }",
    "const turn = { id: 'turn_1', status: 'inProgress', error: null, items: [] }",
    "function send(msg) {",
    "  const json = JSON.stringify({ jsonrpc: '2.0', ...msg })",
    "  process.stdout.write(`Content-Length: ${Buffer.byteLength(json)}\\r\\n\\r\\n${json}`)",
    "}",
    "function note(method, params) { send({ method, params }) }",
    "function ok(id, result) { send({ id, result }) }",
    "function req(method, params) {",
    "  const id = ++seq",
    "  send({ id, method, params })",
    "  return new Promise((resolve) => wait.set(String(id), resolve))",
    "}",
    "function parse() {",
    "  while (true) {",
    "    const head = buf.indexOf('\\r\\n\\r\\n')",
    "    if (head < 0) return",
    "    const raw = buf.slice(0, head).toString()",
    "    const match = /Content-Length: (\\d+)/i.exec(raw)",
    "    if (!match) throw new Error('missing content length')",
    "    const len = Number(match[1])",
    "    const size = head + 4 + len",
    "    if (buf.length < size) return",
    "    const msg = JSON.parse(buf.slice(head + 4, size).toString())",
    "    buf = buf.slice(size)",
    "    if (msg.method) { void on(msg) }",
    "    else if (Object.prototype.hasOwnProperty.call(msg, 'id')) {",
    "      const next = wait.get(String(msg.id))",
    "      if (!next) continue",
    "      wait.delete(String(msg.id))",
    "      next(msg.result)",
    "    }",
    "  }",
    "}",
    "process.stdin.on('data', (chunk) => {",
    "  buf = Buffer.concat([buf, chunk])",
    "  parse()",
    "})",
    "async function on(msg) {",
    "  if (msg.method === 'initialize') return ok(msg.id, { userAgent: 'test' })",
    "  if (msg.method === 'thread/start') return ok(msg.id, { thread, model: 'gpt-5', modelProvider: 'openai', cwd: process.cwd(), approvalPolicy: 'on-request', sandbox: { type: 'dangerFullAccess' }, reasoningEffort: null })",
    "  if (msg.method === 'turn/start') {",
    "    queueMicrotask(async () => {",
    body,
    "    })",
    "    return ok(msg.id, { turn })",
    "  }",
    "}",
    "process.stdin.resume()",
  ].join("\n")
}

const basic = server([
  "note('turn/started', { threadId: thread.id, turn })",
  "note('item/started', { threadId: thread.id, turnId: turn.id, item: { type: 'agentMessage', id: 'item_msg', text: '' } })",
  `note('item/agentMessage/delta', { threadId: thread.id, turnId: turn.id, itemId: 'item_msg', delta: ${JSON.stringify('{"ok":true}')} })`,
  `note('item/completed', { threadId: thread.id, turnId: turn.id, item: { type: 'agentMessage', id: 'item_msg', text: ${JSON.stringify('{"ok":true}')} } })`,
  "note('thread/tokenUsage/updated', { threadId: thread.id, turnId: turn.id, tokenUsage: { last: { inputTokens: 3, cachedInputTokens: 1, outputTokens: 2, reasoningOutputTokens: 0 } } })",
  "note('turn/completed', { threadId: thread.id, turn: { id: turn.id, status: 'completed', error: null, items: [] } })",
].join("\n"))

const bridge = server([
  "note('turn/started', { threadId: thread.id, turn })",
  "note('item/started', { threadId: thread.id, turnId: turn.id, item: { type: 'commandExecution', id: 'item_cmd', command: 'echo hi', cwd: process.cwd(), status: 'inProgress', aggregatedOutput: null, exitCode: null, durationMs: null } })",
  "await req('item/commandExecution/requestApproval', { threadId: thread.id, turnId: turn.id, itemId: 'item_cmd', command: 'echo hi', cwd: process.cwd() })",
  "note('item/completed', { threadId: thread.id, turnId: turn.id, item: { type: 'commandExecution', id: 'item_cmd', command: 'echo hi', cwd: process.cwd(), status: 'completed', aggregatedOutput: 'hi', exitCode: 0, durationMs: 1 } })",
  "await req('item/tool/requestUserInput', { threadId: thread.id, turnId: turn.id, itemId: 'item_cmd', questions: [{ id: 'q1', header: 'Pick', question: 'Pick one', isOther: false, isSecret: false, options: [{ label: 'A', description: 'alpha' }] }] })",
  "note('item/started', { threadId: thread.id, turnId: turn.id, item: { type: 'agentMessage', id: 'item_msg', text: '' } })",
  "note('item/agentMessage/delta', { threadId: thread.id, turnId: turn.id, itemId: 'item_msg', delta: 'done' })",
  "note('item/completed', { threadId: thread.id, turnId: turn.id, item: { type: 'agentMessage', id: 'item_msg', text: 'done' } })",
  "note('thread/tokenUsage/updated', { threadId: thread.id, turnId: turn.id, tokenUsage: { last: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, reasoningOutputTokens: 0 } } })",
  "note('turn/completed', { threadId: thread.id, turn: { id: turn.id, status: 'completed', error: null, items: [] } })",
].join("\n"))

const unsupported = server([
  "note('turn/started', { threadId: thread.id, turn })",
  "await req('item/tool/call', { threadId: thread.id, turnId: turn.id, callId: 'call_1', tool: 'custom_tool', arguments: { value: 1 } })",
].join("\n"))

describe("codex runtime", () => {
  test("maps app-server notifications into runtime events", async () => {
    await using server = await fixture(basic)
    const result = await collect(
      input(server.file, {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
          },
        },
      }),
    )

    expect(result.map((item) => item.type)).toEqual([
      "start",
      "start-step",
      "text-start",
      "text-delta",
      "text-end",
      "finish-step",
      "finish",
    ])
    expect(result[5]).toMatchObject({
      type: "finish-step",
      usage: {
        totalTokens: 6,
        inputTokens: 3,
        cachedInputTokens: 1,
        outputTokens: 2,
        reasoningTokens: 0,
      },
    })
  })

  test("bridges approval and question requests", async () => {
    await using server = await fixture(bridge)
    const asked: Array<Parameters<RuntimeInput["ask"]>[0]> = []
    const questions: Array<Parameters<RuntimeInput["question"]>[0]> = []
    const result = await collect(
      input(server.file, {
        ask: async (value) => {
          asked.push(value)
        },
        question: async (value) => {
          questions.push(value)
          return [["A"]]
        },
      }),
    )

    expect(asked).toEqual([
      expect.objectContaining({
        permission: "bash",
        patterns: ["echo hi"],
        callID: "item_cmd",
      }),
    ])
    expect(questions).toEqual([
      expect.objectContaining({
        callID: "item_cmd",
      }),
    ])
    expect(result.map((item) => item.type)).toContain("tool-call")
    expect(result.map((item) => item.type)).toContain("tool-result")
  })

  test("surfaces unsupported dynamic tool calls as errors", async () => {
    await using server = await fixture(unsupported)
    const match = await runtime(input(server.file))

    await expect((async () => {
      const stream = await Promise.resolve(match.run(input(server.file)))
      for await (const event of stream) {
        if (event.type === "error") throw event.error
      }
    })()).rejects.toThrow("Unsupported Codex dynamic tool call: custom_tool")
  })
})
