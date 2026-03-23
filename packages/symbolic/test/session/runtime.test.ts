import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Instance } from "../../src/project/instance"
import { PermissionNext } from "../../src/permission/next"
import { Question } from "../../src/question"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageV2 } from "../../src/session/message-v2"
import type { SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"
import { setTimeout as sleep } from "node:timers/promises"

type Hit = {
  url: URL
  headers: Headers
  body: Record<string, unknown>
}

async function plug(dir: string, body: string[]) {
  const root = path.join(dir, ".symbolic", "plugin")
  await fs.mkdir(root, { recursive: true })
  await Bun.write(
    path.join(root, "runtime.ts"),
    [
      "export default async () => ({",
      '  "experimental.chat.runtime": async (input, output) => {',
      '    if (input.agent.options.runtime !== "dummy-runtime") return',
      "    output.runtime = {",
      '      name: "dummy-runtime",',
      "      async *run(input) {",
      ...body.map((line) => `        ${line}`),
      "      },",
      "    }",
      "  },",
      "})",
      "",
    ].join("\n"),
  )
}

async function wait<T>(fn: () => Promise<T | undefined>, timeout = 15_000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const item = await fn()
    if (item !== undefined) return item
    await sleep(25)
  }
  throw new Error("Timed out")
}

function text(parts: { type: string; text?: string }[]) {
  return parts.flatMap((part) => (part.type === "text" && part.text ? [part.text] : []))
}

async function done(sessionID: SessionID) {
  const items = await Session.messages({ sessionID })
  return [...items].reverse().find((item) => item.info.role === "assistant" && item.info.time.completed)
}

function defer<T>() {
  const value = {} as { promise: Promise<T>; resolve: (value: T) => void }
  value.promise = new Promise((resolve) => {
    value.resolve = resolve
  })
  return value
}

function sse(chunks: unknown[], done = false) {
  const lines = chunks.map((chunk) => `data: ${typeof chunk === "string" ? chunk : JSON.stringify(chunk)}`)
  if (done) lines.push("data: [DONE]")
  const body = lines.join("\n\n") + "\n\n"
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(body))
      controller.close()
    },
  })
}

function resp(chunks: unknown[], done = false) {
  return new Response(sse(chunks, done), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  })
}

describe("session.runtime", () => {
  test("selects an alternate runtime and parses structured output", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            model: "symbolic/kimi-k2.5-free",
            permission: {
              external_directory: "ask",
            },
            options: {
              runtime: "dummy-runtime",
            },
          },
        },
      },
      init: (dir) =>
        plug(dir, [
          'yield { type: "start" }',
          'yield { type: "start-step" }',
          'yield { type: "text-start" }',
          'yield { type: "text-delta", text: "{\\"ok\\":true}" }',
          'yield { type: "text-end" }',
          'yield { type: "finish-step", finishReason: "stop", usage: { totalTokens: 2, inputTokens: 1, outputTokens: 1, reasoningTokens: 0, cachedInputTokens: 0 } }',
          'yield { type: "finish" }',
        ]),
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const message = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          format: {
            type: "json_schema",
            retryCount: 0,
            schema: {
              type: "object",
              properties: {
                ok: {
                  type: "boolean",
                },
              },
              required: ["ok"],
            },
          },
          parts: [
            {
              type: "text",
              text: "say hi",
            },
          ],
        })

        if (message.info.role !== "assistant") throw new Error("expected assistant reply")
        expect(message.info.structured).toEqual({ ok: true })

        const stored = await MessageV2.get({
          sessionID: session.id,
          messageID: message.info.id,
        })
        const text = stored.parts.flatMap((part) => (part.type === "text" ? [part.text] : []))
        expect(text).toEqual(['{"ok":true}'])
      },
    })
  })

  test("falls back to the default loop when no runtime claims the turn", async () => {
    const req = defer<Hit>()
    const srv = Bun.serve({
      port: 0,
      async fetch(input) {
        req.resolve({
          url: new URL(input.url),
          headers: input.headers,
          body: (await input.json()) as Record<string, unknown>,
        })
        return resp(
          [
            {
              type: "response.created",
              response: {
                id: "resp_1",
                created_at: Math.floor(Date.now() / 1_000),
                model: "gpt-5.2",
                service_tier: null,
              },
            },
            {
              type: "response.output_item.added",
              output_index: 0,
              item: {
                type: "message",
                id: "item_1",
              },
            },
            {
              type: "response.output_text.delta",
              item_id: "item_1",
              delta: "fallback",
              logprobs: null,
            },
            {
              type: "response.output_item.done",
              output_index: 0,
              item: {
                type: "message",
                id: "item_1",
              },
            },
            {
              type: "response.completed",
              response: {
                incomplete_details: null,
                usage: {
                  input_tokens: 1,
                  input_tokens_details: null,
                  output_tokens: 1,
                  output_tokens_details: null,
                },
                service_tier: null,
              },
            },
          ],
          true,
        )
      },
    })

    try {
      await using tmp = await tmpdir({
        git: true,
        config: {
          enabled_providers: ["openai"],
          provider: {
            openai: {
              options: {
                apiKey: "test-openai-key",
                baseURL: `${srv.url.origin}/v1`,
              },
            },
          },
          agent: {
            build: {
              model: "openai/gpt-5.2",
              options: {
                runtime: "unclaimed-runtime",
              },
            },
          },
        },
        init: (dir) =>
          plug(dir, [
            'yield { type: "start" }',
            'yield { type: "start-step" }',
            'yield { type: "text-start" }',
            'yield { type: "text-delta", text: "claimed" }',
            'yield { type: "text-end" }',
            'yield { type: "finish-step", finishReason: "stop", usage: { totalTokens: 2, inputTokens: 1, outputTokens: 1, reasoningTokens: 0, cachedInputTokens: 0 } }',
            'yield { type: "finish" }',
          ]),
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({ title: "runtime fallback" })
          const message = await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            parts: [{ type: "text", text: "say hi" }],
          })

          if (message.info.role !== "assistant") throw new Error("expected assistant reply")
          const stored = await MessageV2.get({
            sessionID: session.id,
            messageID: message.info.id,
          })
          expect(text(stored.parts)).toEqual(["fallback"])

          const hit = await req.promise
          expect(hit.url.pathname).toBe("/v1/responses")
          expect(hit.headers.get("Authorization")).toBe("Bearer test-openai-key")
          expect(hit.body.model).toBe("gpt-5.2")
        },
      })
    } finally {
      srv.stop()
    }
  })

  test("replies to runtime permission requests through the server route", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            model: "symbolic/kimi-k2.5-free",
            permission: {
              external_directory: "ask",
            },
            options: {
              runtime: "dummy-runtime",
            },
          },
        },
      },
      init: (dir) =>
        plug(dir, [
          'yield { type: "start" }',
          'yield { type: "start-step" }',
          'await input.ask({ permission: "external_directory", patterns: ["/tmp/codex-runtime-perm"], metadata: { path: "/tmp/codex-runtime-perm" }, always: ["/tmp/codex-runtime-perm"], callID: "call_perm" })',
          'yield { type: "text-start" }',
          'yield { type: "text-delta", text: "approved" }',
          'yield { type: "text-end" }',
          'yield { type: "finish-step", finishReason: "stop", usage: { totalTokens: 2, inputTokens: 1, outputTokens: 1, reasoningTokens: 0, cachedInputTokens: 0 } }',
          'yield { type: "finish" }',
        ]),
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const run = SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          parts: [{ type: "text", text: "say hi" }],
        })

        const req = await wait(async () => (await PermissionNext.list())[0])
        const app = Server.createApp({})

        expect(req.permission).toBe("external_directory")
        expect(req.tool?.callID).toBe("call_perm")

        const reply = await app.request(`/permission/${req.id}/reply`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-symbolic-directory": tmp.path,
          },
          body: JSON.stringify({ reply: "once" }),
        })

        expect(reply.status).toBe(200)
        expect(await reply.json()).toBe(true)

        const message = await run
        if (message.info.role !== "assistant") throw new Error("expected assistant reply")
        expect(text(message.parts)).toEqual(["approved"])
      },
    })
  }, 30_000)

  test("rejects runtime permission requests through the server route", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            model: "symbolic/kimi-k2.5-free",
            permission: {
              external_directory: "ask",
            },
            options: {
              runtime: "dummy-runtime",
            },
          },
        },
      },
      init: (dir) =>
        plug(dir, [
          'yield { type: "start" }',
          'yield { type: "start-step" }',
          'await input.ask({ permission: "external_directory", patterns: ["/tmp/codex-runtime-perm"], metadata: { path: "/tmp/codex-runtime-perm" }, always: ["/tmp/codex-runtime-perm"], callID: "call_perm" })',
          'yield { type: "finish" }',
        ]),
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        void SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          parts: [{ type: "text", text: "say hi" }],
        })

        const req = await wait(async () => (await PermissionNext.list())[0])
        const app = Server.createApp({})

        const reply = await app.request(`/permission/${req.id}/reply`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-symbolic-directory": tmp.path,
          },
          body: JSON.stringify({ reply: "reject" }),
        })

        expect(reply.status).toBe(200)
        expect(await reply.json()).toBe(true)

        const message = await wait(() => done(session.id))
        if (message.info.role !== "assistant") throw new Error("expected assistant reply")
        expect(message.info.error?.data.message).toContain("rejected")
      },
    })
  }, 30_000)

  test("replies to runtime questions through the server route", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            model: "symbolic/kimi-k2.5-free",
            options: {
              runtime: "dummy-runtime",
            },
          },
        },
      },
      init: (dir) =>
        plug(dir, [
          'yield { type: "start" }',
          'yield { type: "start-step" }',
          'const answers = await input.question({ questions: [{ header: "Pick", question: "Pick one", options: [{ label: "A", description: "alpha" }] }], callID: "call_q" })',
          'yield { type: "text-start" }',
          'yield { type: "text-delta", text: answers[0]?.[0] ?? "none" }',
          'yield { type: "text-end" }',
          'yield { type: "finish-step", finishReason: "stop", usage: { totalTokens: 2, inputTokens: 1, outputTokens: 1, reasoningTokens: 0, cachedInputTokens: 0 } }',
          'yield { type: "finish" }',
        ]),
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const run = SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          parts: [{ type: "text", text: "say hi" }],
        })

        const req = await wait(async () => (await Question.list())[0])
        const app = Server.createApp({})

        expect(req.tool?.callID).toBe("call_q")

        const reply = await app.request(`/question/${req.id}/reply`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-symbolic-directory": tmp.path,
          },
          body: JSON.stringify({ answers: [["A"]] }),
        })

        expect(reply.status).toBe(200)
        expect(await reply.json()).toBe(true)

        const message = await run
        if (message.info.role !== "assistant") throw new Error("expected assistant reply")
        expect(text(message.parts)).toEqual(["A"])
      },
    })
  }, 30_000)

  test("rejects runtime questions through the server route", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            model: "symbolic/kimi-k2.5-free",
            options: {
              runtime: "dummy-runtime",
            },
          },
        },
      },
      init: (dir) =>
        plug(dir, [
          'yield { type: "start" }',
          'yield { type: "start-step" }',
          'await input.question({ questions: [{ header: "Pick", question: "Pick one", options: [{ label: "A", description: "alpha" }] }], callID: "call_q" })',
          'yield { type: "finish" }',
        ]),
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        void SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          parts: [{ type: "text", text: "say hi" }],
        })

        const req = await wait(async () => (await Question.list())[0])
        const app = Server.createApp({})

        const reply = await app.request(`/question/${req.id}/reject`, {
          method: "POST",
          headers: {
            "x-symbolic-directory": tmp.path,
          },
        })

        expect(reply.status).toBe(200)
        expect(await reply.json()).toBe(true)

        const message = await wait(() => done(session.id))
        if (message.info.role !== "assistant") throw new Error("expected assistant reply")
        expect(message.info.error?.data.message).toContain("dismissed this question")
      },
    })
  }, 30_000)
})
