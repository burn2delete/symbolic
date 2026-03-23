import fs from "fs/promises"
import path from "path"
import { Duration, Effect, Layer, ServiceMap } from "effect"
import type { Agent } from "../agent/agent"
import { Identifier } from "../id/id"
import { PermissionNext } from "../permission/next"
import { Filesystem } from "../util/filesystem"
import { Glob } from "../util/glob"
import { ToolID } from "./schema"
import { TRUNCATION_DIR } from "./truncation-dir"
import { makeRunPromise } from "@/effect/run-service"

export namespace TruncateEffect {
  const day = Duration.days(7)

  export const MAX_LINES = 2000
  export const MAX_BYTES = 50 * 1024
  export const DIR = TRUNCATION_DIR
  export const GLOB = path.join(TRUNCATION_DIR, "*")

  export type Result = { content: string; truncated: false } | { content: string; truncated: true; outputPath: string }

  export interface Options {
    maxLines?: number
    maxBytes?: number
    direction?: "head" | "tail"
  }

  function has(agent?: Agent.Info) {
    if (!agent?.permission) return false
    return PermissionNext.evaluate("task", "*", agent.permission).action !== "deny"
  }

  export interface Interface {
    readonly cleanup: () => Effect.Effect<void>
    readonly output: (text: string, options?: Options, agent?: Agent.Info) => Effect.Effect<Result>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@symbolic-agent/Truncate") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const cleanup = Effect.fn("Truncate.cleanup")(function* () {
        const cutoff = Identifier.timestamp(Identifier.create("tool", false, Date.now() - Duration.toMillis(day)))
        const entries = yield* Effect.promise(() =>
          Glob.scan("tool_*", { cwd: TRUNCATION_DIR, include: "file" }).catch(() => [] as string[]),
        )
        for (const entry of entries) {
          if (Identifier.timestamp(entry) >= cutoff) continue
          yield* Effect.promise(() => fs.unlink(path.join(TRUNCATION_DIR, entry)).catch(() => undefined))
        }
      })

      const output = Effect.fn("Truncate.output")(function* (text: string, options: Options = {}, agent?: Agent.Info) {
        const maxLines = options.maxLines ?? MAX_LINES
        const maxBytes = options.maxBytes ?? MAX_BYTES
        const direction = options.direction ?? "head"
        const lines = text.split("\n")
        const bytes = Buffer.byteLength(text, "utf-8")

        if (lines.length <= maxLines && bytes <= maxBytes) {
          return { content: text, truncated: false } as const
        }

        const out: string[] = []
        let hit = false
        let used = 0

        if (direction === "head") {
          for (let i = 0; i < lines.length && i < maxLines; i++) {
            const size = Buffer.byteLength(lines[i], "utf-8") + (i > 0 ? 1 : 0)
            if (used + size > maxBytes) {
              hit = true
              break
            }
            out.push(lines[i])
            used += size
          }
        } else {
          for (let i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
            const size = Buffer.byteLength(lines[i], "utf-8") + (out.length > 0 ? 1 : 0)
            if (used + size > maxBytes) {
              hit = true
              break
            }
            out.unshift(lines[i])
            used += size
          }
        }

        const removed = hit ? bytes - used : lines.length - out.length
        const unit = hit ? "bytes" : "lines"
        const preview = out.join("\n")

        const file = path.join(TRUNCATION_DIR, ToolID.ascending())
        yield* Effect.promise(() => Filesystem.write(file, text))

        const hint = has(agent)
          ? `The tool call succeeded but the output was truncated. Full output saved to: ${file}\nUse the Task tool to have explore agent process this file with Grep and Read (with offset/limit). Do NOT read the full file yourself - delegate to save context.`
          : `The tool call succeeded but the output was truncated. Full output saved to: ${file}\nUse Grep to search the full content or Read with offset/limit to view specific sections.`

        return {
          content:
            direction === "head"
              ? `${preview}\n\n...${removed} ${unit} truncated...\n\n${hint}`
              : `...${removed} ${unit} truncated...\n\n${hint}\n\n${preview}`,
          truncated: true,
          outputPath: file,
        } as const
      })

      return Service.of({ cleanup, output })
    }),
  )

  const runPromise = makeRunPromise(Service, layer)

  export async function cleanup() {
    return runPromise((svc) => svc.cleanup())
  }

  export async function output(text: string, options: Options = {}, agent?: Agent.Info) {
    return runPromise((svc) => svc.output(text, options, agent))
  }
}
