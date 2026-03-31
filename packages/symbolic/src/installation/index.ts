import { NodeChildProcessSpawner, NodeFileSystem, NodePath } from "@effect/platform-node"
import { BusEvent } from "@/bus/bus-event"
import { Effect, Layer, Schema, ServiceMap, Stream } from "effect"
import { makeRunPromise } from "@/effect/run-service"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { withTransientReadRetry } from "@/util/effect-http-client"
import path from "path"
import z from "zod"
import { NamedError } from "@symbolic-agent/util/error"
import { Log } from "../util/log"
import { Flag } from "../flag/flag"

declare global {
  const SYMBOLIC_VERSION: string
  const SYMBOLIC_CHANNEL: string
}

export namespace Installation {
  const log = Log.create({ service: "installation" })

  export type Method = "curl" | "npm" | "yarn" | "pnpm" | "bun" | "brew" | "scoop" | "choco" | "unknown"

  const GitHubRelease = Schema.Struct({ tag_name: Schema.String })
  const NpmPackage = Schema.Struct({ version: Schema.String })
  const BrewFormula = Schema.Struct({
    versions: Schema.Struct({ stable: Schema.String }),
  })
  const BrewInfo = Schema.Struct({
    formulae: Schema.Array(
      Schema.Struct({
        versions: Schema.Struct({ stable: Schema.String }),
      }),
    ),
  })
  const ChocoPackage = Schema.Struct({
    d: Schema.Struct({
      results: Schema.Array(Schema.Struct({ Version: Schema.String })),
    }),
  })
  const ScoopManifest = NpmPackage

  type Result = {
    code: ChildProcessSpawner.ExitCode
    stdout: string
    stderr: string
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

  export const VERSION = typeof SYMBOLIC_VERSION === "string" ? SYMBOLIC_VERSION : "local"
  export const CHANNEL = typeof SYMBOLIC_CHANNEL === "string" ? SYMBOLIC_CHANNEL : "local"
  export const USER_AGENT = `symbolic/${CHANNEL}/${VERSION}/${Flag.SYMBOLIC_CLIENT}`

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
      const http = HttpClient.filterStatusOk(withTransientReadRetry(yield* HttpClient.HttpClient))
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

      const text = (cmd: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) =>
        Effect.gen(function* () {
          const proc = ChildProcess.make(cmd[0]!, cmd.slice(1), {
            cwd: opts.cwd,
            env: opts.env,
            extendEnv: true,
          })
          const handle = yield* spawner.spawn(proc)
          const out = yield* Stream.mkString(Stream.decodeText(handle.stdout))
          yield* handle.exitCode
          return out
        }).pipe(
          Effect.scoped,
          Effect.catch(() => Effect.succeed("")),
        )

      const run = (cmd: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) =>
        Effect.gen(function* () {
          const proc = ChildProcess.make(cmd[0]!, cmd.slice(1), {
            cwd: opts.cwd,
            env: opts.env,
            extendEnv: true,
          })
          const handle = yield* spawner.spawn(proc)
          const out = yield* Effect.all(
            [Stream.mkString(Stream.decodeText(handle.stdout)), Stream.mkString(Stream.decodeText(handle.stderr))],
            { concurrency: 2 },
          )
          return {
            code: yield* handle.exitCode,
            stdout: out[0],
            stderr: out[1],
          } satisfies Result
        }).pipe(
          Effect.scoped,
          Effect.catch(() =>
            Effect.succeed({
              code: ChildProcessSpawner.ExitCode(1),
              stdout: "",
              stderr: "",
            }),
          ),
        )

      const getBrewFormula = Effect.fn("Installation.brew.formula")(function* () {
        const tap = yield* text(["brew", "list", "--formula", "anomalyco/tap/symbolic"])
        if (tap.includes("symbolic")) return "anomalyco/tap/symbolic"
        const core = yield* text(["brew", "list", "--formula", "symbolic"])
        if (core.includes("symbolic")) return "symbolic"
        return "symbolic"
      })

      const upgradeCurl = Effect.fnUntraced(
        function* (target: string) {
          const res = yield* http.execute(HttpClientRequest.get("https://symbolic.computer/install"))
          const body = yield* res.text
          const proc = ChildProcess.make("bash", [], {
            stdin: Stream.make(new TextEncoder().encode(body)),
            env: { VERSION: target },
            extendEnv: true,
          })
          const handle = yield* spawner.spawn(proc)
          const out = yield* Effect.all(
            [Stream.mkString(Stream.decodeText(handle.stdout)), Stream.mkString(Stream.decodeText(handle.stderr))],
            { concurrency: 2 },
          )
          return {
            code: yield* handle.exitCode,
            stdout: out[0],
            stderr: out[1],
          } satisfies Result
        },
        Effect.scoped,
        Effect.orDie,
      )

      const method = Effect.fn("Installation.method")(function* () {
        if (process.execPath.includes(path.join(".symbolic", "bin"))) return "curl"
        if (process.execPath.includes(path.join(".local", "bin"))) return "curl"
        const exec = process.execPath.toLowerCase()

        const checks = [
          { name: "npm" as const, command: () => text(["npm", "list", "-g", "--depth=0"]) },
          { name: "yarn" as const, command: () => text(["yarn", "global", "list"]) },
          { name: "pnpm" as const, command: () => text(["pnpm", "list", "-g", "--depth=0"]) },
          { name: "bun" as const, command: () => text(["bun", "pm", "ls", "-g"]) },
          { name: "brew" as const, command: () => text(["brew", "list", "--formula", "symbolic"]) },
          { name: "scoop" as const, command: () => text(["scoop", "list", "symbolic"]) },
          { name: "choco" as const, command: () => text(["choco", "list", "--limit-output", "symbolic"]) },
        ]

        checks.sort((a, b) => {
          const left = exec.includes(a.name)
          const right = exec.includes(b.name)
          if (left && !right) return -1
          if (!left && right) return 1
          return 0
        })

        for (const check of checks) {
          const out = yield* check.command()
          if (out.includes("symbolic")) return check.name
        }

        return "unknown"
      })

      const latest = Effect.fn("Installation.latest")(function* (input?: Method) {
        const detected = input || (yield* method())

        if (detected === "brew") {
          const formula = yield* getBrewFormula()
          if (formula.includes("/")) {
            const info = yield* text(["brew", "info", "--json=v2", formula]).pipe(
              Effect.flatMap((raw) => Schema.decodeUnknownEffect(Schema.fromJsonString(BrewInfo))(raw)),
            )
            return info.formulae[0]!.versions.stable
          }

          const res = yield* http.execute(
            HttpClientRequest.get("https://formulae.brew.sh/api/formula/symbolic.json").pipe(
              HttpClientRequest.acceptJson,
            ),
          )
          const data = yield* HttpClientResponse.schemaBodyJson(BrewFormula)(res)
          return data.versions.stable
        }

        if (detected === "npm" || detected === "bun" || detected === "pnpm") {
          const value = (yield* text(["npm", "config", "get", "registry"])).trim()
          const reg = value || "https://registry.npmjs.org"
          const registry = reg.endsWith("/") ? reg.slice(0, -1) : reg
          const res = yield* http.execute(
            HttpClientRequest.get(`${registry}/symbolic/${CHANNEL}`).pipe(HttpClientRequest.acceptJson),
          )
          const data = yield* HttpClientResponse.schemaBodyJson(NpmPackage)(res)
          return data.version
        }

        if (detected === "choco") {
          const res = yield* http.execute(
            HttpClientRequest.get(
              "https://community.chocolatey.org/api/v2/Packages?$filter=Id%20eq%20%27symbolic%27%20and%20IsLatestVersion&$select=Version",
            ).pipe(HttpClientRequest.setHeaders({ Accept: "application/json;odata=verbose" })),
          )
          const data = yield* HttpClientResponse.schemaBodyJson(ChocoPackage)(res)
          return data.d.results[0]!.Version
        }

        if (detected === "scoop") {
          const res = yield* http.execute(
            HttpClientRequest.get("https://raw.githubusercontent.com/ScoopInstaller/Main/master/bucket/symbolic.json").pipe(
              HttpClientRequest.setHeaders({ Accept: "application/json" }),
            ),
          )
          const data = yield* HttpClientResponse.schemaBodyJson(ScoopManifest)(res)
          return data.version
        }

        const res = yield* http.execute(
          HttpClientRequest.get("https://api.github.com/repos/SymbolicOS/symbolic/releases/latest").pipe(
            HttpClientRequest.acceptJson,
          ),
        )
        const data = yield* HttpClientResponse.schemaBodyJson(GitHubRelease)(res)
        return data.tag_name.replace(/^v/, "")
      }, Effect.orDie)

      const upgrade = Effect.fn("Installation.upgrade")(function* (
        method: Method,
        target: string,
      ) {
        let result: Result | undefined

        switch (method) {
          case "curl":
            result = yield* upgradeCurl(target)
            break
          case "npm":
            result = yield* run(["npm", "install", "-g", `symbolic@${target}`])
            break
          case "pnpm":
            result = yield* run(["pnpm", "install", "-g", `symbolic@${target}`])
            break
          case "bun":
            result = yield* run(["bun", "install", "-g", `symbolic@${target}`])
            break
          case "brew": {
            const formula = yield* getBrewFormula()
            const env = { HOMEBREW_NO_AUTO_UPDATE: "1" }
            if (formula.includes("/")) {
              const tap = yield* run(["brew", "tap", "anomalyco/tap"], { env })
              if (tap.code !== 0) {
                result = tap
                break
              }

              const dir = (yield* text(["brew", "--repo", "anomalyco/tap"])).trim()
              if (dir) {
                const pull = yield* run(["git", "pull", "--ff-only"], { cwd: dir, env })
                if (pull.code !== 0) {
                  result = pull
                  break
                }
              }
            }

            result = yield* run(["brew", "upgrade", formula], { env })
            break
          }
          case "choco":
            result = yield* run(["choco", "upgrade", "symbolic", `--version=${target}`, "-y"])
            break
          case "scoop":
            result = yield* run(["scoop", "install", `symbolic@${target}`])
            break
          default:
            throw new Error(`Unknown method: ${method}`)
        }

        if (!result || result.code !== 0) {
          const stderr = method === "choco" ? "not running from an elevated command shell" : (result?.stderr ?? "")
          return yield* Effect.fail(new UpgradeFailedError({ stderr }))
        }

        log.info("upgraded", {
          method,
          target,
          stdout: result.stdout,
          stderr: result.stderr,
        })
        yield* text([process.execPath, "--version"])
      })

      const info = Effect.fn("Installation.info")(function* () {
        return {
          version: VERSION,
          latest: yield* latest(),
        }
      })

      return Service.of({ info, method, latest, upgrade })
    }),
  )

  export const defaultLayer = layer.pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(NodeChildProcessSpawner.layer),
    Layer.provide(NodeFileSystem.layer),
    Layer.provide(NodePath.layer),
  )

  const runPromise = makeRunPromise(Service, defaultLayer)

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
