import type { Hooks, PluginInput, Plugin as PluginInstance } from "@symbolic-agent/plugin"
import { Config } from "../config/config"
import { Bus } from "../bus"
import { Log } from "../util/log"
import { createSymbolicClient } from "@symbolic-agent/sdk"
import { Server } from "../server/server"
import { BunProc } from "../bun"
import { Flag } from "../flag/flag"
import { CodexAuthPlugin } from "./codex"
import { CodexRuntimePlugin } from "@symbolic-agent/codex-runtime"
import { Session } from "../session"
import { NamedError } from "@symbolic-agent/util/error"
import { CopilotAuthPlugin } from "./copilot"
import { gitlabAuthPlugin as GitlabAuthPlugin } from "opencode-gitlab-auth"
import { Effect, Layer, ServiceMap } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { makeRunPromise } from "@/effect/run-service"

export namespace Plugin {
  const log = Log.create({ service: "plugin" })

  const BUILTIN = ["symbolic-anthropic-auth@0.0.13"]
  const DEPRECATED_PLUGIN_PACKAGES = ["symbolic-openai-codex-auth", "symbolic-copilot-auth"]

  const INTERNAL_PLUGINS: PluginInstance[] = [
    CodexAuthPlugin,
    CodexRuntimePlugin,
    CopilotAuthPlugin,
    GitlabAuthPlugin as unknown as PluginInstance,
  ]

  type State = {
    hooks: Hooks[]
  }

  type TriggerName = {
    [K in keyof Hooks]-?: NonNullable<Hooks[K]> extends (input: any, output: any) => Promise<void> ? K : never
  }[keyof Hooks]

  export interface Interface {
    readonly trigger: <
      Name extends TriggerName,
      Input = Parameters<Required<Hooks>[Name]>[0],
      Output = Parameters<Required<Hooks>[Name]>[1],
    >(
      name: Name,
      input: Input,
      output: Output,
    ) => Effect.Effect<Output>
    readonly list: () => Effect.Effect<Hooks[]>
    readonly init: () => Effect.Effect<void>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@symbolic-agent/Plugin") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const cache = yield* InstanceState.make<State>(
        Effect.fn("Plugin.state")(function* (ctx) {
          const hooks: Hooks[] = []

          const client = createSymbolicClient({
            baseUrl: "http://localhost:4096",
            directory: ctx.directory,
            headers: Flag.SYMBOLIC_SERVER_PASSWORD
              ? {
                  Authorization: `Basic ${Buffer.from(`${Flag.SYMBOLIC_SERVER_USERNAME ?? "symbolic"}:${Flag.SYMBOLIC_SERVER_PASSWORD}`).toString("base64")}`,
                }
              : undefined,
            fetch: async (...args) => Server.Default().fetch(...args),
          })
          const cfg = yield* Effect.promise(() => Config.get())
          const input: PluginInput = {
            client,
            project: ctx.project,
            worktree: ctx.worktree,
            directory: ctx.directory,
            get serverUrl(): URL {
              return Server.url ?? new URL("http://localhost:4096")
            },
            $: Bun.$,
          }

          for (const plugin of INTERNAL_PLUGINS) {
            log.info("loading internal plugin", { name: plugin.name })
            const init = yield* Effect.tryPromise({
              try: () => plugin(input),
              catch: (err) => {
                log.error("failed to load internal plugin", { name: plugin.name, error: err })
                return err
              },
            }).pipe(Effect.option)
            if (init._tag === "Some") hooks.push(init.value)
          }

          let plugins = cfg.plugin ?? []
          if (plugins.length) yield* Effect.promise(() => Config.waitForDependencies())
          if (!Flag.SYMBOLIC_DISABLE_DEFAULT_PLUGINS) {
            plugins = [...BUILTIN, ...plugins]
          }

          for (const item of plugins) {
            let plugin = Config.pluginSpec(item)
            const opts = Config.pluginOptions(item)
            if (DEPRECATED_PLUGIN_PACKAGES.some((pkg) => plugin.includes(pkg))) continue
            log.info("loading plugin", { path: plugin })
            if (!plugin.startsWith("file://")) {
              const idx = plugin.lastIndexOf("@")
              const pkg = idx > 0 ? plugin.substring(0, idx) : plugin
              const version = idx > 0 ? plugin.substring(idx + 1) : "latest"
              plugin = yield* Effect.tryPromise({
                try: () => BunProc.install(pkg, version, { ignoreScripts: true }),
                catch: (err) => {
                  const cause = err instanceof Error ? err.cause : err
                  const detail = cause instanceof Error ? cause.message : String(cause ?? err)
                  log.error("failed to install plugin", { pkg, version, error: detail })
                  return detail
                },
              }).pipe(
                Effect.catch((detail) =>
                  Effect.promise(() =>
                    Bus.publish(Session.Event.Error, {
                      error: new NamedError.Unknown({
                        message: `Failed to install plugin ${pkg}@${version}: ${detail}`,
                      }).toObject(),
                    }),
                  ).pipe(Effect.map(() => "")),
                ),
              )
              if (!plugin) continue
            }

            const mod = yield* Effect.tryPromise({
              try: () => import(plugin),
              catch: (err) => {
                const message = err instanceof Error ? err.message : String(err)
                log.error("failed to load plugin", { path: plugin, error: message })
                return message
              },
            }).pipe(
              Effect.catch((message) =>
                Effect.promise(() =>
                  Bus.publish(Session.Event.Error, {
                    error: new NamedError.Unknown({
                      message: `Failed to load plugin ${plugin}: ${message}`,
                    }).toObject(),
                  }),
                ).pipe(Effect.map(() => undefined)),
              ),
            )
            if (!mod) continue

            const seen = new Set<PluginInstance>()
            for (const [_name, fn] of Object.entries<PluginInstance>(mod)) {
              if (seen.has(fn)) continue
              seen.add(fn)
              const hook = yield* Effect.tryPromise({
                try: () => fn(input, opts),
                catch: (err) => {
                  const message = err instanceof Error ? err.message : String(err)
                  log.error("failed to load plugin", { path: plugin, error: message })
                  return message
                },
              }).pipe(
                Effect.catch((message) =>
                  Effect.promise(() =>
                    Bus.publish(Session.Event.Error, {
                      error: new NamedError.Unknown({
                        message: `Failed to load plugin ${plugin}: ${message}`,
                      }).toObject(),
                  }),
                  ).pipe(Effect.map(() => undefined)),
                ),
              )
              if (hook) hooks.push(hook)
            }
          }

          for (const hook of hooks) {
            yield* Effect.tryPromise({
              try: () => Promise.resolve((hook as any).config?.(cfg)),
              catch: (err) => {
                log.error("plugin config hook failed", { error: err })
                return err
              },
            }).pipe(Effect.ignore)
          }

          yield* Effect.acquireRelease(
            Effect.sync(() =>
              Bus.subscribeAll(async (input) => {
                for (const hook of hooks) {
                  hook["event"]?.({
                    event: input,
                  })
                }
              }),
            ),
            (unsub) => Effect.sync(unsub),
          )

          return { hooks }
        }),
      )

      const trigger = Effect.fn("Plugin.trigger")(function* <
        Name extends TriggerName,
        Input = Parameters<Required<Hooks>[Name]>[0],
        Output = Parameters<Required<Hooks>[Name]>[1],
      >(name: Name, input: Input, output: Output) {
        if (!name) return output
        const state = yield* InstanceState.get(cache)
        for (const hook of state.hooks) {
          const fn = hook[name] as any
          if (!fn) continue
          yield* Effect.promise(() => Promise.resolve(fn(input, output)))
        }
        return output
      })

      const list = Effect.fn("Plugin.list")(function* () {
        const state = yield* InstanceState.get(cache)
        return state.hooks
      })

      const init = Effect.fn("Plugin.init")(function* () {
        yield* InstanceState.get(cache)
      })

      return Service.of({ trigger, list, init })
    }),
  )

  export const defaultLayer = layer

  const runPromise = makeRunPromise(Service, defaultLayer)

  export async function trigger<
    Name extends TriggerName,
    Input = Parameters<Required<Hooks>[Name]>[0],
    Output = Parameters<Required<Hooks>[Name]>[1],
  >(name: Name, input: Input, output: Output): Promise<Output> {
    return runPromise((svc) => svc.trigger(name, input, output))
  }

  export async function list(): Promise<Hooks[]> {
    return runPromise((svc) => svc.list())
  }

  export async function init() {
    return runPromise((svc) => svc.init())
  }
}
