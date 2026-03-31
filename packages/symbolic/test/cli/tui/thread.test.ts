import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import * as Consumers from "node:stream/consumers"
import * as Network from "../../../src/cli/network"
import { TuiConfig } from "@/config/tui"
import { Instance } from "@/project/instance"
import { Rpc } from "@/util/rpc"
import { UI } from "@/cli/ui"
import * as Timeout from "@/util/timeout"
import * as Win32 from "../../../src/cli/cmd/tui/win32"
import { tmpdir } from "../../fixture/fixture"

const stop = new Error("stop")
const seen = {
  tui: [] as string[],
  inst: [] as string[],
  prompt: [] as string[],
}

let piped = ""

mock.module("../../../src/cli/cmd/tui/app", () => ({
  tui: async (input: { directory: string; args?: { prompt?: string } }) => {
    seen.tui.push(input.directory)
    if (input.args?.prompt !== undefined) seen.prompt.push(input.args.prompt)
    throw stop
  },
}))

async function setup() {
  spyOn(Consumers, "text").mockImplementation(async () => piped)
  spyOn(Consumers, "buffer").mockImplementation(async () => Buffer.alloc(0))
  spyOn(Rpc, "client").mockImplementation(() => ({
    call: async () => ({ url: "http://127.0.0.1" }) as never,
    on: () => () => undefined,
  }))
  spyOn(UI, "error").mockImplementation(() => {})
  spyOn(Timeout, "withTimeout").mockImplementation((input) => input)
  spyOn(Network, "resolveNetworkOptions").mockResolvedValue({
    mdns: false,
    port: 0,
    hostname: "127.0.0.1",
    mdnsDomain: "symbolic.local",
    cors: [],
  })
  spyOn(Win32, "win32DisableProcessedInput").mockImplementation(() => {})
  spyOn(Win32, "win32InstallCtrlCGuard").mockReturnValue(undefined)
  spyOn(TuiConfig, "get").mockImplementation(async () => ({}))
  spyOn(Instance, "provide").mockImplementation(async (input) => {
    seen.inst.push(input.directory)
    return input.fn()
  })
}

describe("tui thread", () => {
  afterEach(() => {
    mock.restore()
  })

  async function call(project?: string) {
    await setup()
    const { TuiThreadCommand } = await import("../../../src/cli/cmd/tui/thread")
    const args: Parameters<NonNullable<typeof TuiThreadCommand.handler>>[0] = {
      _: [],
      $0: "symbolic",
      project,
      prompt: "hi",
      model: undefined,
      agent: undefined,
      session: undefined,
      continue: false,
      fork: false,
      port: 0,
      hostname: "127.0.0.1",
      mdns: false,
      "mdns-domain": "symbolic.local",
      mdnsDomain: "symbolic.local",
      cors: [],
    }
    return TuiThreadCommand.handler(args)
  }

  async function check(project?: string) {
    await using tmp = await tmpdir({ git: true })
    const cwd = process.cwd()
    const pwd = process.env.PWD
    const worker = globalThis.Worker
    const tty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY")
    const link = path.join(path.dirname(tmp.path), path.basename(tmp.path) + "-link")
    const type = process.platform === "win32" ? "junction" : "dir"
    seen.tui.length = 0
    seen.inst.length = 0
    seen.prompt.length = 0
    await fs.symlink(tmp.path, link, type)

    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    })
    globalThis.Worker = class extends EventTarget {
      onerror = null
      onmessage = null
      onmessageerror = null
      postMessage() {}
      terminate() {}
    } as unknown as typeof Worker

    try {
      process.chdir(tmp.path)
      process.env.PWD = link
      await expect(call(project)).rejects.toBe(stop)
      expect(seen.inst[0]).toBe(tmp.path)
      expect(seen.tui[0]).toBe(tmp.path)
    } finally {
      process.chdir(cwd)
      if (pwd === undefined) delete process.env.PWD
      else process.env.PWD = pwd
      if (tty) Object.defineProperty(process.stdin, "isTTY", tty)
      else delete (process.stdin as { isTTY?: boolean }).isTTY
      globalThis.Worker = worker
      await fs.rm(link, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  test("uses the real cwd when PWD points at a symlink", async () => {
    await check()
  })

  test("uses the real cwd after resolving a relative project from PWD", async () => {
    await check(".")
  })

  test("prepends piped stdin to the prompt", async () => {
    await using tmp = await tmpdir({ git: true })
    const cwd = process.cwd()
    const worker = globalThis.Worker
    const tty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY")
    seen.tui.length = 0
    seen.inst.length = 0
    seen.prompt.length = 0
    piped = "from-stdin"

    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: false,
    })
    globalThis.Worker = class extends EventTarget {
      onerror = null
      onmessage = null
      onmessageerror = null
      postMessage() {}
      terminate() {}
    } as unknown as typeof Worker

    try {
      process.chdir(tmp.path)
      await expect(call()).rejects.toBe(stop)
      expect(seen.prompt[0]).toBe("from-stdin\nhi")
    } finally {
      piped = ""
      process.chdir(cwd)
      if (tty) Object.defineProperty(process.stdin, "isTTY", tty)
      else delete (process.stdin as { isTTY?: boolean }).isTTY
      globalThis.Worker = worker
    }
  })
})
