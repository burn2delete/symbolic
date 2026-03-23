import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { makeRunPromise } from "@/effect/run-service"
import { SessionID, MessageID } from "@/session/schema"
import { PermissionID } from "./schema"
import { Database, eq } from "@/storage/db"
import { PermissionTable } from "@/session/session.sql"
import { Log } from "@/util/log"
import { ProjectID } from "@/project/schema"
import { Wildcard } from "@/util/wildcard"
import { Effect, Layer, ServiceMap } from "effect"
import os from "os"
import z from "zod"

export namespace PermissionNext {
  const log = Log.create({ service: "permission" })

  function expand(pattern: string): string {
    if (pattern.startsWith("~/")) return os.homedir() + pattern.slice(1)
    if (pattern === "~") return os.homedir()
    if (pattern.startsWith("$HOME/")) return os.homedir() + pattern.slice(5)
    if (pattern.startsWith("$HOME")) return os.homedir() + pattern.slice(5)
    return pattern
  }

  export const Action = z.enum(["allow", "deny", "ask"]).meta({
    ref: "PermissionAction",
  })
  export type Action = z.infer<typeof Action>

  export const Rule = z
    .object({
      permission: z.string(),
      pattern: z.string(),
      action: Action,
    })
    .meta({
      ref: "PermissionRule",
    })
  export type Rule = z.infer<typeof Rule>

  export const Ruleset = Rule.array().meta({
    ref: "PermissionRuleset",
  })
  export type Ruleset = z.infer<typeof Ruleset>

  export function fromConfig(permission: Config.Permission) {
    const ruleset: Ruleset = []
    for (const [key, value] of Object.entries(permission)) {
      if (typeof value === "string") {
        ruleset.push({
          permission: key,
          action: value,
          pattern: "*",
        })
        continue
      }
      ruleset.push(
        ...Object.entries(value).map(([pattern, action]) => ({ permission: key, pattern: expand(pattern), action })),
      )
    }
    return ruleset
  }

  export function merge(...rulesets: Ruleset[]): Ruleset {
    return rulesets.flat()
  }

  export const Request = z
    .object({
      id: PermissionID.zod,
      sessionID: SessionID.zod,
      permission: z.string(),
      patterns: z.string().array(),
      metadata: z.record(z.string(), z.any()),
      always: z.string().array(),
      tool: z
        .object({
          messageID: MessageID.zod,
          callID: z.string(),
        })
        .optional(),
    })
    .meta({
      ref: "PermissionRequest",
    })

  export type Request = z.infer<typeof Request>

  export const Reply = z.enum(["once", "always", "reject"])
  export type Reply = z.infer<typeof Reply>

  export const Approval = z.object({
    projectID: ProjectID.zod,
    patterns: z.string().array(),
  })

  export const Event = {
    Asked: BusEvent.define("permission.asked", Request),
    Replied: BusEvent.define(
      "permission.replied",
      z.object({
        sessionID: SessionID.zod,
        requestID: PermissionID.zod,
        reply: Reply,
      }),
    ),
  }

  interface PendingEntry {
    info: Request
    resolve: () => void
    reject: (err: CorrectedError | RejectedError) => void
  }

  interface State {
    pending: Map<PermissionID, PendingEntry>
    approved: Ruleset
  }

  const AskInput = Request.partial({ id: true }).extend({
    ruleset: Ruleset,
  })

  const ReplyInput = z.object({
    requestID: PermissionID.zod,
    reply: Reply,
    message: z.string().optional(),
  })

  interface Api {
    readonly ask: (input: z.infer<typeof AskInput>) => Effect.Effect<void, DeniedError | CorrectedError | RejectedError>
    readonly reply: (input: z.infer<typeof ReplyInput>) => Effect.Effect<void>
    readonly list: () => Effect.Effect<Request[]>
  }

  class Service extends ServiceMap.Service<Service, Api>()("@symbolic-agent/PermissionNext") {}

  const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const state = yield* InstanceState.make<State>(
        Effect.fn("PermissionNext.state")(function* (ctx) {
          const row = Database.use((db) =>
            db.select().from(PermissionTable).where(eq(PermissionTable.project_id, ctx.project.id)).get(),
          )
          const next = {
            pending: new Map<PermissionID, PendingEntry>(),
            approved: row?.data ?? ([] as Ruleset),
          }
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              for (const item of next.pending.values()) {
                item.reject(new RejectedError())
              }
              next.pending.clear()
            }),
          )
          return next
        }),
      )

      const ask = Effect.fn("PermissionNext.ask")(function* (input: z.infer<typeof AskInput>) {
        const next = yield* InstanceState.get(state)
        const { ruleset, ...request } = input
        let pending = false

        for (const pattern of request.patterns ?? []) {
          const rule = evaluate(request.permission, pattern, ruleset, next.approved)
          log.info("evaluated", { permission: request.permission, pattern, action: rule })
          if (rule.action === "deny") {
            return yield* Effect.fail(
              new DeniedError(ruleset.filter((item) => Wildcard.match(request.permission, item.permission))),
            )
          }
          if (rule.action === "ask") pending = true
        }

        if (!pending) return

        const id = input.id ?? PermissionID.ascending()
        const info: Request = {
          id,
          ...request,
        }
        yield* Effect.promise(
          () =>
            new Promise<void>((resolve, reject) => {
              next.pending.set(id, {
                info,
                resolve: () => {
                  next.pending.delete(id)
                  resolve()
                },
                reject: (err) => {
                  next.pending.delete(id)
                  reject(err)
                },
              })
              Bus.publish(Event.Asked, info)
            }),
        )
      })

      const reply = Effect.fn("PermissionNext.reply")(function* (input: z.infer<typeof ReplyInput>) {
        const next = yield* InstanceState.get(state)
        const existing = next.pending.get(input.requestID)
        if (!existing) return

        next.pending.delete(input.requestID)
        Bus.publish(Event.Replied, {
          sessionID: existing.info.sessionID,
          requestID: existing.info.id,
          reply: input.reply,
        })

        if (input.reply === "reject") {
          existing.reject(input.message ? new CorrectedError(input.message) : new RejectedError())
          for (const [id, item] of next.pending.entries()) {
            if (item.info.sessionID !== existing.info.sessionID) continue
            next.pending.delete(id)
            Bus.publish(Event.Replied, {
              sessionID: item.info.sessionID,
              requestID: item.info.id,
              reply: "reject",
            })
            item.reject(new RejectedError())
          }
          return
        }

        if (input.reply === "once") {
          existing.resolve()
          return
        }

        for (const pattern of existing.info.always) {
          next.approved.push({
            permission: existing.info.permission,
            pattern,
            action: "allow",
          })
        }

        existing.resolve()

        for (const [id, item] of next.pending.entries()) {
          if (item.info.sessionID !== existing.info.sessionID) continue
          const ok = item.info.patterns.every(
            (pattern) => evaluate(item.info.permission, pattern, next.approved).action === "allow",
          )
          if (!ok) continue
          next.pending.delete(id)
          Bus.publish(Event.Replied, {
            sessionID: item.info.sessionID,
            requestID: item.info.id,
            reply: "always",
          })
          item.resolve()
        }

        // TODO: we don't save the permission ruleset to disk yet until there's
        // UI to manage it
        // db().insert(PermissionTable).values({ projectID: Instance.project.id, data: next.approved })
        //   .onConflictDoUpdate({ target: PermissionTable.projectID, set: { data: next.approved } }).run()
      })

      const list = Effect.fn("PermissionNext.list")(function* () {
        return Array.from((yield* InstanceState.get(state)).pending.values(), (item) => item.info)
      })

      return Service.of({ ask, reply, list })
    }),
  )

  export function evaluate(permission: string, pattern: string, ...rulesets: Ruleset[]): Rule {
    const merged = merge(...rulesets)
    log.info("evaluate", { permission, pattern, ruleset: merged })
    const match = merged.findLast(
      (rule) => Wildcard.match(permission, rule.permission) && Wildcard.match(pattern, rule.pattern),
    )
    return match ?? { action: "ask", permission, pattern: "*" }
  }

  const EDIT_TOOLS = ["edit", "write", "patch", "apply_patch", "multiedit"]

  export function disabled(tools: string[], ruleset: Ruleset): Set<string> {
    const result = new Set<string>()
    for (const tool of tools) {
      const permission = EDIT_TOOLS.includes(tool) ? "edit" : tool

      const rule = ruleset.findLast((r) => Wildcard.match(permission, r.permission))
      if (!rule) continue
      if (rule.pattern === "*" && rule.action === "deny") result.add(tool)
    }
    return result
  }

  /** User rejected without message - halts execution */
  export class RejectedError extends Error {
    constructor() {
      super(`The user rejected permission to use this specific tool call.`)
    }
  }

  /** User rejected with message - continues with guidance */
  export class CorrectedError extends Error {
    constructor(message: string) {
      super(`The user rejected permission to use this specific tool call with the following feedback: ${message}`)
    }
  }

  /** Auto-rejected by config rule - halts execution */
  export class DeniedError extends Error {
    constructor(public readonly ruleset: Ruleset) {
      super(
        `The user has specified a rule which prevents you from using this specific tool call. Here are some of the relevant rules ${JSON.stringify(ruleset)}`,
      )
    }
  }

  const runPromise = makeRunPromise(Service, layer)

  export async function ask(input: z.infer<typeof AskInput>) {
    return runPromise((svc) => svc.ask(input))
  }

  export async function reply(input: z.infer<typeof ReplyInput>) {
    return runPromise((svc) => svc.reply(input))
  }

  export async function list() {
    return runPromise((svc) => svc.list())
  }
}
