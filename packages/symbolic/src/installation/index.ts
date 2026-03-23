import { BusEvent } from "@/bus/bus-event"
import { Effect, Layer, ServiceMap } from "effect"
import { makeRunPromise } from "@/effect/run-service"
import path from "path"
import z from "zod"
import { NamedError } from "@symbolic-agent/util/error"
import { Log } from "../util/log"
import { iife } from "@/util/iife"
import { Flag } from "../flag/flag"
import { Process } from "@/util/process"
import { buffer } from "node:stream/consumers"

declare global {
  const SYMBOLIC_VERSION: string
  const SYMBOLIC_CHANNEL: string
}

export namespace Installation {
  const log = Log.create({ service: "installation" })

  export type Method = "curl" | "npm" | "yarn" | "pnpm" | "bun" | "brew" | "scoop" | "choco" | "unknown"

  async function text(cmd: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
    return Process.text(cmd, {
      cwd: opts.cwd,
      env: opts.env,
      nothrow: true,
    }).then((x) => x.text)
  }

  async function upgradeCurl(target: string): Promise<Process.Result> {
    const body = await fetch("https://symbolic.computer/install").then((res) => {
      if (!res.ok) throw new Error(res.statusText)
      return res.text()
    })
    const proc = Process.spawn(["bash"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        VERSION: target,
      },
    })
    if (!proc.stdin || !proc.stdout || !proc.stderr) throw new Error("Process output not available")
    proc.stdin.end(body)
    const [code, stdout, stderr] = await Promise.all([proc.exited, buffer(proc.stdout), buffer(proc.stderr)])
    return {
      code,
      stdout,
      stderr,
    }
  }

  export const Event = {
    Updated: BusEvent.define(
      "installation.updated",
      z.object({
        version: z.string(),
      }),
    ),
    UpdateAvailable: BusEvent.define(
      "installation.update-available",
      z.object({
        version: z.string(),
      }),
    ),
  }

  export const Info = z
    .object({
      version: z.string(),
      latest: z.string(),
    })
    .meta({
      ref: "InstallationInfo",
    })
  export type Info = z.infer<typeof Info>

  export function isPreview() {
    return CHANNEL !== "latest"
  }

  export function isLocal() {
    return CHANNEL === "local"
  }

  export const UpgradeFailedError = NamedError.create(
    "UpgradeFailedError",
    z.object({
      stderr: z.string(),
    }),
  )

  async function getBrewFormula() {
    const tap = await text(["brew", "list", "--formula", "anomalyco/tap/symbolic"])
    if (tap.includes("symbolic")) return "anomalyco/tap/symbolic"
    const core = await text(["brew", "list", "--formula", "symbolic"])
    if (core.includes("symbolic")) return "symbolic"
    return "symbolic"
  }

  export const VERSION = typeof SYMBOLIC_VERSION === "string" ? SYMBOLIC_VERSION : "local"
  export const CHANNEL = typeof SYMBOLIC_CHANNEL === "string" ? SYMBOLIC_CHANNEL : "local"
  export const USER_AGENT = `symbolic/${CHANNEL}/${VERSION}/${Flag.SYMBOLIC_CLIENT}`

  async function methodImpl(): Promise<Method> {
    if (process.execPath.includes(path.join(".symbolic", "bin"))) return "curl"
    if (process.execPath.includes(path.join(".local", "bin"))) return "curl"
    const exec = process.execPath.toLowerCase()

    const checks = [
      {
        name: "npm" as const,
        command: () => text(["npm", "list", "-g", "--depth=0"]),
      },
      {
        name: "yarn" as const,
        command: () => text(["yarn", "global", "list"]),
      },
      {
        name: "pnpm" as const,
        command: () => text(["pnpm", "list", "-g", "--depth=0"]),
      },
      {
        name: "bun" as const,
        command: () => text(["bun", "pm", "ls", "-g"]),
      },
      {
        name: "brew" as const,
        command: () => text(["brew", "list", "--formula", "symbolic"]),
      },
      {
        name: "scoop" as const,
        command: () => text(["scoop", "list", "symbolic"]),
      },
      {
        name: "choco" as const,
        command: () => text(["choco", "list", "--limit-output", "symbolic"]),
      },
    ]

    checks.sort((a, b) => {
      const left = exec.includes(a.name)
      const right = exec.includes(b.name)
      if (left && !right) return -1
      if (!left && right) return 1
      return 0
    })

    for (const check of checks) {
      const output = await check.command()
      if (output.includes("symbolic")) return check.name
    }

    return "unknown"
  }

  async function latestImpl(installMethod?: Method) {
    const detected = installMethod || (await methodImpl())

    if (detected === "brew") {
      const formula = await getBrewFormula()
      if (formula.includes("/")) {
        const infoJson = await text(["brew", "info", "--json=v2", formula])
        const info = JSON.parse(infoJson)
        const version = info.formulae?.[0]?.versions?.stable
        if (!version) throw new Error(`Could not detect version for tap formula: ${formula}`)
        return version
      }
      return fetch("https://formulae.brew.sh/api/formula/symbolic.json")
        .then((res) => {
          if (!res.ok) throw new Error(res.statusText)
          return res.json()
        })
        .then((data: any) => data.versions.stable)
    }

    if (detected === "npm" || detected === "bun" || detected === "pnpm") {
      const registry = await iife(async () => {
        const value = (await text(["npm", "config", "get", "registry"])).trim()
        const reg = value || "https://registry.npmjs.org"
        return reg.endsWith("/") ? reg.slice(0, -1) : reg
      })
      return fetch(`${registry}/symbolic/${CHANNEL}`)
        .then((res) => {
          if (!res.ok) throw new Error(res.statusText)
          return res.json()
        })
        .then((data: any) => data.version)
    }

    if (detected === "choco") {
      return fetch(
        "https://community.chocolatey.org/api/v2/Packages?$filter=Id%20eq%20%27symbolic%27%20and%20IsLatestVersion&$select=Version",
        { headers: { Accept: "application/json;odata=verbose" } },
      )
        .then((res) => {
          if (!res.ok) throw new Error(res.statusText)
          return res.json()
        })
        .then((data: any) => data.d.results[0].Version)
    }

    if (detected === "scoop") {
      return fetch("https://raw.githubusercontent.com/ScoopInstaller/Main/master/bucket/symbolic.json", {
        headers: { Accept: "application/json" },
      })
        .then((res) => {
          if (!res.ok) throw new Error(res.statusText)
          return res.json()
        })
        .then((data: any) => data.version)
    }

    return fetch("https://api.github.com/repos/SymbolicOS/symbolic/releases/latest")
      .then((res) => {
        if (!res.ok) throw new Error(res.statusText)
        return res.json()
      })
      .then((data: any) => data.tag_name.replace(/^v/, ""))
  }

  async function infoImpl() {
    return {
      version: VERSION,
      latest: await latestImpl(),
    }
  }

  async function upgradeImpl(method: Method, target: string) {
    let result: Process.Result | undefined
    switch (method) {
      case "curl":
        result = await upgradeCurl(target)
        break
      case "npm":
        result = await Process.run(["npm", "install", "-g", `symbolic@${target}`], { nothrow: true })
        break
      case "pnpm":
        result = await Process.run(["pnpm", "install", "-g", `symbolic@${target}`], { nothrow: true })
        break
      case "bun":
        result = await Process.run(["bun", "install", "-g", `symbolic@${target}`], { nothrow: true })
        break
      case "brew": {
        const formula = await getBrewFormula()
        const env = {
          HOMEBREW_NO_AUTO_UPDATE: "1",
          ...process.env,
        }
        if (formula.includes("/")) {
          const tap = await Process.run(["brew", "tap", "anomalyco/tap"], { env, nothrow: true })
          if (tap.code !== 0) {
            result = tap
            break
          }
          const repo = await Process.text(["brew", "--repo", "anomalyco/tap"], { env, nothrow: true })
          if (repo.code !== 0) {
            result = repo
            break
          }
          const dir = repo.text.trim()
          if (dir) {
            const pull = await Process.run(["git", "pull", "--ff-only"], { cwd: dir, env, nothrow: true })
            if (pull.code !== 0) {
              result = pull
              break
            }
          }
        }
        result = await Process.run(["brew", "upgrade", formula], { env, nothrow: true })
        break
      }
      case "choco":
        result = await Process.run(["choco", "upgrade", "symbolic", `--version=${target}`, "-y"], { nothrow: true })
        break
      case "scoop":
        result = await Process.run(["scoop", "install", `symbolic@${target}`], { nothrow: true })
        break
      default:
        throw new Error(`Unknown method: ${method}`)
    }
    if (!result || result.code !== 0) {
      const stderr =
        method === "choco" ? "not running from an elevated command shell" : result?.stderr.toString("utf8") || ""
      throw new UpgradeFailedError({ stderr })
    }
    log.info("upgraded", {
      method,
      target,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    })
    await Process.text([process.execPath, "--version"], { nothrow: true })
  }

  export interface Interface {
    readonly info: () => Effect.Effect<Info>
    readonly method: () => Effect.Effect<Method>
    readonly latest: (method?: Method) => Effect.Effect<string>
    readonly upgrade: (method: Method, target: string) => Effect.Effect<void, InstanceType<typeof UpgradeFailedError>>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@symbolic-agent/Installation") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const info = Effect.fn("Installation.info")(() => Effect.promise(() => infoImpl()))
      const method = Effect.fn("Installation.method")(() => Effect.promise(() => methodImpl()))
      const latest = Effect.fn("Installation.latest")((input?: Method) => Effect.promise(() => latestImpl(input)))
      const upgrade = Effect.fn("Installation.upgrade")((method: Method, target: string) =>
        Effect.tryPromise({
          try: () => upgradeImpl(method, target),
          catch: (cause) => {
            if (UpgradeFailedError.isInstance(cause)) return cause
            throw cause
          },
        }),
      )

      return Service.of({ info, method, latest, upgrade })
    }),
  )

  const runPromise = makeRunPromise(Service, layer)

  export async function info() {
    return runPromise((svc) => svc.info())
  }

  export async function method() {
    return runPromise((svc) => svc.method())
  }

  export async function latest(installMethod?: Method) {
    return runPromise((svc) => svc.latest(installMethod))
  }

  export async function upgrade(method: Method, target: string) {
    return runPromise((svc) => svc.upgrade(method, target))
  }
}
