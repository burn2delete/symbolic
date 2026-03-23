import { Bus } from "../bus"
import { File } from "../file"
import { Log } from "../util/log"
import path from "path"
import z from "zod"

import * as Formatter from "./formatter"
import { Config } from "../config/config"
import { mergeDeep } from "remeda"
import { Effect, Layer, ServiceMap } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { makeRunPromise } from "@/effect/run-service"
import { Instance } from "../project/instance"
import { Process } from "../util/process"

export namespace Format {
  const log = Log.create({ service: "format" })

  export const Status = z
    .object({
      name: z.string(),
      extensions: z.string().array(),
      enabled: z.boolean(),
    })
    .meta({
      ref: "FormatterStatus",
    })
  export type Status = z.infer<typeof Status>

  interface State {
    enabled: Record<string, boolean>
    formatters: Record<string, Formatter.Info>
  }

  interface Interface {
    readonly status: () => Effect.Effect<Status[]>
    readonly formatters: (ext: string) => Effect.Effect<Formatter.Info[]>
    readonly init: () => Effect.Effect<void>
  }

  class Service extends ServiceMap.Service<Service, Interface>()("@symbolic-agent/Format") {}

  const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const state = yield* InstanceState.make<State>(
        Effect.fn("Format.state")(function* () {
          const enabled: Record<string, boolean> = {}
          const cfg = yield* Effect.promise(() => Config.get())

          const formatters: Record<string, Formatter.Info> = {}
          if (cfg.formatter === false) {
            log.info("all formatters are disabled")
            return {
              enabled,
              formatters,
            }
          }

          for (const item of Object.values(Formatter)) {
            formatters[item.name] = item
          }
          for (const [name, item] of Object.entries(cfg.formatter ?? {})) {
            if (item.disabled) {
              delete formatters[name]
              continue
            }
            const result: Formatter.Info = mergeDeep(formatters[name] ?? {}, {
              command: [],
              extensions: [],
              ...item,
            })

            if (result.command.length === 0) continue

            result.enabled = async () => true
            result.name = name
            formatters[name] = result
          }

          return {
            enabled,
            formatters,
          }
        }),
      )

      const isEnabled = Effect.fn("Format.isEnabled")(function* (item: Formatter.Info) {
        const current = yield* InstanceState.get(state)
        let status = current.enabled[item.name]
        if (status === undefined) {
          status = yield* Effect.promise(() => item.enabled())
          current.enabled[item.name] = status
        }
        return status
      })

      const formatters = Effect.fn("Format.formatters")(function* (ext: string) {
        const current = yield* InstanceState.get(state)
        const result: Formatter.Info[] = []
        for (const item of Object.values(current.formatters)) {
          log.info("checking", { name: item.name, ext })
          if (!item.extensions.includes(ext)) continue
          if (!(yield* isEnabled(item))) continue
          log.info("enabled", { name: item.name, ext })
          result.push(item)
        }
        return result
      })

      const status = Effect.fn("Format.status")(function* () {
        const current = yield* InstanceState.get(state)
        const result: Status[] = []
        for (const formatter of Object.values(current.formatters)) {
          const enabled = yield* isEnabled(formatter)
          result.push({
            name: formatter.name,
            extensions: formatter.extensions,
            enabled,
          })
        }
        return result
      })

      const init = Effect.fn("Format.init")(function* () {
        log.info("init")
        Bus.subscribe(File.Event.Edited, async (payload) => {
          const file = payload.properties.file
          log.info("formatting", { file })
          const ext = path.extname(file)

          for (const item of await runPromise((svc) => svc.formatters(ext))) {
            log.info("running", { command: item.command })
            try {
              const proc = Process.spawn(item.command.map((x) => x.replace("$FILE", file)), {
                cwd: Instance.directory,
                env: { ...process.env, ...item.environment },
                stdout: "ignore",
                stderr: "ignore",
              })
              const exit = await proc.exited
              if (exit !== 0)
                log.error("failed", {
                  command: item.command,
                  ...item.environment,
                })
            } catch (error) {
              log.error("failed to format file", {
                error,
                command: item.command,
                ...item.environment,
                file,
              })
            }
          }
        })
      })

      return Service.of({ status, formatters, init })
    }),
  )

  const runPromise = makeRunPromise(Service, layer)

  export async function status() {
    return runPromise((svc) => svc.status())
  }

  export function init() {
    void runPromise((svc) => svc.init())
  }
}
