import { beforeEach, expect, mock, test } from "bun:test"

let hang = false
let fail = false
let closeCount = 0

class MockClient {
  async connect(transport: { start: () => Promise<void> }) {
    await transport.start()
  }
}

class MockStdioTransport {
  stderr: null = null
  constructor(_opts: unknown) {}
  async start() {
    if (hang) return new Promise<void>(() => {})
    if (fail) throw new Error("Mock stdio transport cannot connect")
  }
  async close() {
    closeCount++
  }
}

class MockStreamableHTTPTransport {
  constructor(_url: URL, _opts?: unknown) {}
  async start() {
    if (hang) return new Promise<void>(() => {})
    if (fail) throw new Error("Mock streamable transport cannot connect")
  }
  async close() {
    closeCount++
  }
}

class MockSseTransport {
  constructor(_url: URL, _opts?: unknown) {}
  async start() {
    if (hang) return new Promise<void>(() => {})
    if (fail) throw new Error("Mock sse transport cannot connect")
  }
  async close() {
    closeCount++
  }
}

mock.module("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: MockClient,
}))

mock.module("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: MockStdioTransport,
}))

mock.module("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: MockStreamableHTTPTransport,
}))

mock.module("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: MockSseTransport,
}))

beforeEach(() => {
  hang = false
  fail = false
  closeCount = 0
})

const { MCP } = await import("../../src/mcp/index")
const { Instance } = await import("../../src/project/instance")
const { tmpdir } = await import("../fixture/fixture")

test("closes a local transport when connect times out", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      hang = true

      const result = await MCP.add("local", {
        type: "local",
        command: ["node", "fake.js"],
        timeout: 100,
      })

      const status = (result.status as Record<string, { status: string; error?: string }>).local ?? result.status
      expect(status.status).toBe("failed")
      expect(closeCount).toBeGreaterThanOrEqual(1)
    },
  })
})

test("closes failed remote transports before moving to the next fallback", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      fail = true

      const result = await MCP.add("remote", {
        type: "remote",
        url: "https://example.com/mcp",
        oauth: false,
      })

      const status = (result.status as Record<string, { status: string; error?: string }>).remote ?? result.status
      expect(status.status).toBe("failed")
      expect(closeCount).toBeGreaterThanOrEqual(2)
    },
  })
})
