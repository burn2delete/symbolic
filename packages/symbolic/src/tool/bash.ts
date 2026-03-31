import z from "zod"
import os from "os"
import { spawn } from "child_process"
import { Tool } from "./tool"
import path from "path"
import DESCRIPTION from "./bash.txt"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { lazy } from "@/util/lazy"
import { Language } from "web-tree-sitter"
import fs from "fs/promises"

import { Filesystem } from "@/util/filesystem"
import { fileURLToPath } from "url"
import { Flag } from "@/flag/flag.ts"
import { Shell } from "@/shell/shell"

import { BashArity } from "@/permission/arity"
import { Truncate } from "./truncation"
import { Plugin } from "@/plugin"

const MAX_METADATA_LENGTH = 30_000
const DEFAULT_TIMEOUT = Flag.SYMBOLIC_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS || 2 * 60 * 1000
const PS = new Set(["powershell", "pwsh"])
const CWD = new Set(["cd", "push-location", "set-location", "chdir", "pushd", "sl"])
const FILES = new Set([
  ...CWD,
  "rm",
  "cp",
  "mv",
  "mkdir",
  "touch",
  "chmod",
  "chown",
  "cat",
  "ls",
  "dir",
  "gci",
  "gc",
  "gi",
  "del",
  "copy",
  "move",
  "md",
  "type",
  "get-content",
  "set-content",
  "add-content",
  "copy-item",
  "move-item",
  "remove-item",
  "new-item",
  "rename-item",
])
const FLAGS = new Set(["-destination", "-literalpath", "-path"])
const SWITCHES = new Set(["-confirm", "-debug", "-force", "-nonewline", "-recurse", "-verbose", "-whatif"])

export const log = Log.create({ service: "bash-tool" })

const resolveWasm = (asset: string) => {
  if (asset.startsWith("file://")) return fileURLToPath(asset)
  if (asset.startsWith("/") || /^[a-z]:/i.test(asset)) return asset
  const url = new URL(asset, import.meta.url)
  return fileURLToPath(url)
}

type Scan = {
  dirs: Set<string>
  patterns: Set<string>
  always: Set<string>
}

function inside(file: string, cwd: string) {
  try {
    return Instance.containsPath(file)
  } catch {
    return Filesystem.contains(cwd, file)
  }
}

function unquote(text: string) {
  if (text.length < 2) return text
  const first = text[0]
  const last = text[text.length - 1]
  if ((first === '"' || first === "'") && first === last) return text.slice(1, -1)
  return text
}

function home(text: string) {
  if (text === "~") return os.homedir()
  if (text.startsWith("~/") || text.startsWith("~\\")) return path.join(os.homedir(), text.slice(2))
  return text
}

function envValue(key: string) {
  if (process.platform !== "win32") return process.env[key]
  const name = Object.keys(process.env).find((item) => item.toLowerCase() === key.toLowerCase())
  return name ? process.env[name] : undefined
}

function expand(text: string) {
  return home(unquote(text))
    .replace(/\$\{env:([^}]+)\}/gi, (_, key: string) => envValue(key) || "")
    .replace(/\$env:([A-Za-z_][A-Za-z0-9_]*)/gi, (_, key: string) => envValue(key) || "")
}

function provider(text: string) {
  const match = text.match(/^([A-Za-z]+)::(.*)$/)
  if (match) {
    if (match[1].toLowerCase() !== "filesystem") return
    return match[2]
  }

  const prefix = text.match(/^([A-Za-z]+):(.*)$/)
  if (!prefix) return text
  if (prefix[1].length === 1) return text
  return
}

function dynamic(text: string, ps: boolean) {
  if (text.startsWith("(") || text.startsWith("@(")) return true
  if (text.includes("$(") || text.includes("${") || text.includes("`")) return true
  return ps ? /\$(?!env:)/i.test(text) : text.includes("$")
}

function prefix(text: string) {
  const match = /[?*\[]/.exec(text)
  if (!match) return text
  if (match.index === 0) return
  return text.slice(0, match.index)
}

function split(text: string) {
  const out: string[] = []
  let cur = ""
  let quote: string | undefined

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (quote) {
      cur += char
      if (char === quote && text[i - 1] !== "\\") quote = undefined
      continue
    }

    if (char === "'" || char === '"') {
      quote = char
      cur += char
      continue
    }

    if (char === "&" && text[i + 1] === "&") {
      if (cur.trim()) out.push(cur.trim())
      cur = ""
      i += 1
      continue
    }

    if (char === "|" && text[i + 1] === "|") {
      if (cur.trim()) out.push(cur.trim())
      cur = ""
      i += 1
      continue
    }

    if (char === "|" || char === ";" || char === "\n") {
      if (cur.trim()) out.push(cur.trim())
      cur = ""
      continue
    }

    cur += char
  }

  if (cur.trim()) out.push(cur.trim())
  return out
}

function words(text: string) {
  const out: string[] = []
  let cur = ""
  let quote: string | undefined

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (quote) {
      cur += char
      if (char === quote && text[i - 1] !== "\\") quote = undefined
      continue
    }

    if (char === "'" || char === '"') {
      quote = char
      cur += char
      continue
    }

    if (/\s/.test(char)) {
      if (cur) out.push(cur)
      cur = ""
      continue
    }

    cur += char
  }

  if (cur) out.push(cur)
  return out
}

async function resolvePath(text: string, cwd: string) {
  const resolved = process.platform === "win32" ? Filesystem.windowsPath(text) : text
  const base = path.isAbsolute(resolved) ? resolved : path.resolve(cwd, resolved)
  const file = await fs.realpath(base).catch(() => base)
  return process.platform === "win32" ? Filesystem.normalizePath(file) : file
}

async function resolveArg(arg: string, cwd: string, ps: boolean) {
  let text = ps ? expand(arg) : home(unquote(arg))
  if (process.platform === "win32") {
    text = Filesystem.windowsPath(text)
  }

  const file = prefix(text)
  if (!file || dynamic(file, ps)) return

  const next = provider(file)
  if (!next) return

  return resolvePath(next, cwd)
}

async function scanBash(command: string, cwd: string) {
  const tree = await parser().then((p) => p.parse(command))
  if (!tree) {
    throw new Error("Failed to parse command")
  }

  const scan: Scan = {
    dirs: new Set<string>(),
    patterns: new Set<string>(),
    always: new Set<string>(),
  }

  for (const node of tree.rootNode.descendantsOfType("command")) {
    if (!node) continue

    const commandText = (node.parent?.type === "redirected_statement" ? node.parent.text : node.text) || node.text

    const command: string[] = []
    for (let i = 0; i < node.childCount; i += 1) {
      const child = node.child(i)
      if (!child) continue
      if (
        child.type !== "command_name" &&
        child.type !== "word" &&
        child.type !== "string" &&
        child.type !== "raw_string" &&
        child.type !== "concatenation"
      ) {
        continue
      }
      command.push(child.text)
    }

    const name = command[0]
    if (name && FILES.has(name)) {
      for (const arg of command.slice(1)) {
        if (arg.startsWith("-") || (name === "chmod" && arg.startsWith("+"))) continue
        const resolved = await resolveArg(arg, cwd, false)
        log.info("resolved path", { arg, resolved })
        if (!resolved || inside(resolved, cwd)) continue
        const dir = CWD.has(name) || (await Filesystem.isDir(resolved)) ? resolved : path.dirname(resolved)
        scan.dirs.add(dir)
      }
    }

    if (command.length && name !== "cd") {
      scan.patterns.add(commandText)
      scan.always.add(BashArity.prefix(command).join(" ") + " *")
    }
  }

  return scan
}

async function scanPowerShell(command: string, cwd: string) {
  const scan: Scan = {
    dirs: new Set<string>(),
    patterns: new Set<string>(),
    always: new Set<string>(),
  }

  for (const segment of split(command)) {
    const command = words(segment)
    if (command.length === 0) continue

    const parts = command[0] === "&" ? command.slice(1) : command
    const name = parts[0]?.toLowerCase()
    if (!name) continue

    if (FILES.has(name)) {
      let want = false
      for (const arg of parts.slice(1)) {
        if (want) {
          want = false
        } else if (arg.startsWith("-")) {
          const flag = arg.toLowerCase()
          if (SWITCHES.has(flag)) continue
          want = FLAGS.has(flag)
          continue
        }

        if (arg.startsWith("-") || (name === "chmod" && arg.startsWith("+"))) continue
        const resolved = await resolveArg(arg, cwd, true)
        log.info("resolved path", { arg, resolved })
        if (!resolved || inside(resolved, cwd)) continue
        const dir = CWD.has(name) || (await Filesystem.isDir(resolved)) ? resolved : path.dirname(resolved)
        scan.dirs.add(dir)
      }
    }

    scan.patterns.add(segment.trim())
    scan.always.add(BashArity.prefix(parts).join(" ") + " *")
  }

  return scan
}

export async function scanCommand(command: string, cwd: string, shell: string) {
  return PS.has(Shell.name(shell)) ? scanPowerShell(command, cwd) : scanBash(command, cwd)
}

const parser = lazy(async () => {
  const { Parser } = await import("web-tree-sitter")
  const { default: treeWasm } = await import("web-tree-sitter/tree-sitter.wasm" as string, {
    with: { type: "wasm" },
  })
  const treePath = resolveWasm(treeWasm)
  await Parser.init({
    locateFile() {
      return treePath
    },
  })
  const { default: bashWasm } = await import("tree-sitter-bash/tree-sitter-bash.wasm" as string, {
    with: { type: "wasm" },
  })
  const bashPath = resolveWasm(bashWasm)
  const bashLanguage = await Language.load(bashPath)
  const p = new Parser()
  p.setLanguage(bashLanguage)
  return p
})

// TODO: we may wanna rename this tool so it works better on other shells
export const BashTool = Tool.define("bash", async () => {
  const shell = Shell.acceptable()
  log.info("bash tool using shell", { shell })

  return {
    description: DESCRIPTION.replaceAll("${directory}", Instance.directory)
      .replaceAll("${maxLines}", String(Truncate.MAX_LINES))
      .replaceAll("${maxBytes}", String(Truncate.MAX_BYTES)),
    parameters: z.object({
      command: z.string().describe("The command to execute"),
      timeout: z.number().describe("Optional timeout in milliseconds").optional(),
      workdir: z
        .string()
        .describe(
          `The working directory to run the command in. Defaults to ${Instance.directory}. Use this instead of 'cd' commands.`,
        )
        .optional(),
      description: z
        .string()
        .describe(
          "Clear, concise description of what this command does in 5-10 words. Examples:\nInput: ls\nOutput: Lists files in current directory\n\nInput: git status\nOutput: Shows working tree status\n\nInput: npm install\nOutput: Installs package dependencies\n\nInput: mkdir foo\nOutput: Creates directory 'foo'",
        ),
    }),
    async execute(params, ctx) {
      const cwd = params.workdir
        ? await resolvePath(params.workdir, Instance.directory)
        : process.platform === "win32"
          ? Filesystem.normalizePath(Instance.directory)
          : Instance.directory
      if (params.timeout !== undefined && params.timeout < 0) {
        throw new Error(`Invalid timeout value: ${params.timeout}. Timeout must be a positive number.`)
      }
      const timeout = params.timeout ?? DEFAULT_TIMEOUT
      const scan = await scanCommand(params.command, cwd, shell)
      if (!Instance.containsPath(cwd)) scan.dirs.add(cwd)

      if (scan.dirs.size > 0) {
        const globs = Array.from(scan.dirs).map((dir) =>
          process.platform === "win32" ? Filesystem.normalizePathPattern(path.join(dir, "*")) : path.join(dir, "*"),
        )
        await ctx.ask({
          permission: "external_directory",
          patterns: globs,
          always: globs,
          metadata: {},
        })
      }

      if (scan.patterns.size > 0) {
        await ctx.ask({
          permission: "bash",
          patterns: Array.from(scan.patterns),
          always: Array.from(scan.always),
          metadata: {},
        })
      }

      const shellEnv = await Plugin.trigger(
        "shell.env",
        { cwd, sessionID: ctx.sessionID, callID: ctx.callID },
        { env: {} },
      )
      const proc = spawn(params.command, {
        shell,
        cwd,
        env: {
          ...process.env,
          ...shellEnv.env,
        },
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
        windowsHide: process.platform === "win32",
      })

      let output = ""

      // Initialize metadata with empty output
      ctx.metadata({
        metadata: {
          output: "",
          description: params.description,
        },
      })

      const append = (chunk: Buffer) => {
        output += chunk.toString()
        ctx.metadata({
          metadata: {
            // truncate the metadata to avoid GIANT blobs of data (has nothing to do w/ what agent can access)
            output: output.length > MAX_METADATA_LENGTH ? output.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : output,
            description: params.description,
          },
        })
      }

      proc.stdout?.on("data", append)
      proc.stderr?.on("data", append)

      let timedOut = false
      let aborted = false
      let exited = false

      const kill = () => Shell.killTree(proc, { exited: () => exited })

      if (ctx.abort.aborted) {
        aborted = true
        await kill()
      }

      const abortHandler = () => {
        aborted = true
        void kill()
      }

      ctx.abort.addEventListener("abort", abortHandler, { once: true })

      const timeoutTimer = setTimeout(() => {
        timedOut = true
        void kill()
      }, timeout + 100)

      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timeoutTimer)
          ctx.abort.removeEventListener("abort", abortHandler)
        }

        proc.once("exit", () => {
          exited = true
          cleanup()
          resolve()
        })

        proc.once("error", (error) => {
          exited = true
          cleanup()
          reject(error)
        })
      })

      const resultMetadata: string[] = []

      if (timedOut) {
        resultMetadata.push(`bash tool terminated command after exceeding timeout ${timeout} ms`)
      }

      if (aborted) {
        resultMetadata.push("User aborted the command")
      }

      if (resultMetadata.length > 0) {
        output += "\n\n<bash_metadata>\n" + resultMetadata.join("\n") + "\n</bash_metadata>"
      }

      return {
        title: params.description,
        metadata: {
          output: output.length > MAX_METADATA_LENGTH ? output.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : output,
          exit: proc.exitCode,
          description: params.description,
        },
        output,
      }
    },
  }
})
