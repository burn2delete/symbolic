import { PlanExitTool } from "./plan"
import { QuestionTool } from "./question"
import { BashTool } from "./bash"
import { EditTool } from "./edit"
import { GlobTool } from "./glob"
import { GrepTool } from "./grep"
import { BatchTool } from "./batch"
import { ReadTool } from "./read"
import { TaskTool } from "./task"
import { TodoWriteTool } from "./todo"
import { WebFetchTool } from "./webfetch"
import { WriteTool } from "./write"
import { InvalidTool } from "./invalid"
import { SkillTool } from "./skill"
import type { Agent } from "../agent/agent"
import { Tool } from "./tool"
import { Config } from "../config/config"
import path from "path"
import { type ToolContext as PluginToolContext, type ToolDefinition } from "@symbolic-agent/plugin"
import z from "zod"
import { Plugin } from "../plugin"
import { ProviderID, type ModelID } from "../provider/schema"
import { WebSearchTool } from "./websearch"
import { CodeSearchTool } from "./codesearch"
import { Flag } from "@/flag/flag"
import { Log } from "@/util/log"
import { LspTool } from "./lsp"
import { Truncate } from "./truncation"
import { ApplyPatchTool } from "./apply_patch"
import { Glob } from "../util/glob"
import { pathToFileURL } from "url"
import { Effect, Layer, ServiceMap } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { makeRunPromise } from "@/effect/run-service"

export namespace ToolRegistry {
  const log = Log.create({ service: "tool.registry" })

  type State = {
    custom: Tool.Info[]
  }

  type Ready = Awaited<ReturnType<Tool.Info["init"]>> & { id: string }

  export interface Interface {
    readonly register: (tool: Tool.Info) => Effect.Effect<void>
    readonly ids: () => Effect.Effect<string[]>
    readonly tools: (model: { providerID: ProviderID; modelID: ModelID }, agent?: Agent.Info) => Effect.Effect<Ready[]>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@symbolic-agent/ToolRegistry") {}

  const load = Effect.fn("ToolRegistry.load")(function* (ctx: { directory: string; worktree: string }) {
      const custom: Tool.Info[] = []

      function fromPlugin(id: string, def: ToolDefinition): Tool.Info {
        return {
          id,
          init: async (initCtx) => ({
            parameters: z.object(def.args),
            description: def.description,
            execute: async (args, toolCtx) => {
              const pluginCtx = {
                ...toolCtx,
                directory: ctx.directory,
                worktree: ctx.worktree,
              } as unknown as PluginToolContext
              const result = await def.execute(args as never, pluginCtx)
              const out = await Truncate.output(result, {}, initCtx?.agent)
              return {
                title: "",
                output: out.truncated ? out.content : result,
                metadata: { truncated: out.truncated, outputPath: out.truncated ? out.outputPath : undefined },
              }
            },
          }),
        }
      }

      const dirs = yield* Effect.promise(() => Config.directories())
      const matches = dirs.flatMap((dir) =>
        Glob.scanSync("{tool,tools}/*.{js,ts}", { cwd: dir, absolute: true, dot: true, symlink: true }),
      )
      if (matches.length) yield* Effect.promise(() => Config.waitForDependencies())
      yield* Effect.forEach(matches, (match) =>
        Effect.gen(function* () {
          const namespace = path.basename(match, path.extname(match))
          const mod = yield* Effect.promise(() => import(process.platform === "win32" ? match : pathToFileURL(match).href))
          for (const [id, def] of Object.entries<ToolDefinition>(mod)) {
            custom.push(fromPlugin(id === "default" ? namespace : `${namespace}_${id}`, def))
          }
        }),
      )

      const plugins = yield* Effect.promise(() => Plugin.list())
      yield* Effect.forEach(plugins, (plugin) =>
        Effect.gen(function* () {
          for (const [id, def] of Object.entries(plugin.tool ?? {})) {
            custom.push(fromPlugin(id, def))
          }
        }),
      )

      return custom
    })

  const all = Effect.fn("ToolRegistry.all")(function* (custom: Tool.Info[]) {
      const cfg = yield* Effect.promise(() => Config.get())
      const question = ["app", "cli", "desktop"].includes(Flag.SYMBOLIC_CLIENT) || Flag.SYMBOLIC_ENABLE_QUESTION_TOOL

      return [
        InvalidTool,
        ...(question ? [QuestionTool] : []),
        BashTool,
        ReadTool,
        GlobTool,
        GrepTool,
        EditTool,
        WriteTool,
        TaskTool,
        WebFetchTool,
        TodoWriteTool,
        WebSearchTool,
        CodeSearchTool,
        SkillTool,
        ApplyPatchTool,
        ...(Flag.SYMBOLIC_EXPERIMENTAL_LSP_TOOL ? [LspTool] : []),
        ...(cfg.experimental?.batch_tool === true ? [BatchTool] : []),
        ...(Flag.SYMBOLIC_EXPERIMENTAL_PLAN_MODE && Flag.SYMBOLIC_CLIENT === "cli" ? [PlanExitTool] : []),
        ...custom,
      ]
    })

  export const layer: Layer.Layer<Service> = Layer.effect(
    Service,
    Effect.gen(function* () {
      const cache = yield* InstanceState.make<State>(
        Effect.fn("ToolRegistry.state")(function* (ctx) {
          return { custom: yield* load(ctx) }
        }),
      )

      const register: Interface["register"] = Effect.fn("ToolRegistry.register")(function* (tool: Tool.Info) {
          const state = yield* InstanceState.get(cache)
          const idx = state.custom.findIndex((item) => item.id === tool.id)
          if (idx >= 0) {
            state.custom.splice(idx, 1, tool)
            return
          }
          state.custom.push(tool)
        })

      const ids: Interface["ids"] = Effect.fn("ToolRegistry.ids")(function* () {
          const state = yield* InstanceState.get(cache)
          const tools = yield* all(state.custom)
          return tools.map((tool) => tool.id)
        })

      const tools: Interface["tools"] = (
        model: {
          providerID: ProviderID
          modelID: ModelID
        },
        agent?: Agent.Info,
      ): Effect.Effect<Ready[]> =>
        Effect.gen(function* () {
          const state = yield* InstanceState.get(cache)
          const list = yield* all(state.custom)
          const filtered = list.filter((tool) => {
            if (tool.id === "codesearch" || tool.id === "websearch") {
              return model.providerID === ProviderID.symbolic || Flag.SYMBOLIC_ENABLE_EXA
            }

            const usePatch =
              model.modelID.includes("gpt-") && !model.modelID.includes("oss") && !model.modelID.includes("gpt-4")
            if (tool.id === "apply_patch") return usePatch
            if (tool.id === "edit" || tool.id === "write") return !usePatch

            return true
          })
          return yield* Effect.forEach(
            filtered,
            (tool: Tool.Info) =>
              Effect.gen(function* () {
                using _ = log.time(tool.id)
                const next = yield* Effect.promise(() => tool.init({ agent }))
                const output = {
                  description: next.description,
                  parameters: next.parameters,
                }
                yield* Effect.promise(() => Plugin.trigger("tool.definition", { toolID: tool.id }, output))
                return {
                  id: tool.id,
                  ...next,
                  description: output.description,
                  parameters: output.parameters,
                } as Ready
              }),
            { concurrency: "unbounded" },
          )
        })

      return Service.of({ register, ids, tools })
    }),
  )

  const runPromise = makeRunPromise(Service, layer)

  export async function register(tool: Tool.Info) {
    return runPromise((svc) => svc.register(tool))
  }

  export async function ids() {
    return runPromise((svc) => svc.ids())
  }

  export async function tools(model: { providerID: ProviderID; modelID: ModelID }, agent?: Agent.Info): Promise<Ready[]> {
    return runPromise((svc) => svc.tools(model, agent))
  }
}
