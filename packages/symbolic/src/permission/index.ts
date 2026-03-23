import { Deferred, Effect, Layer, ServiceMap } from "effect"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { SessionID, MessageID } from "@/session/schema"
import z from "zod"
import { Log } from "../util/log"
import { Plugin } from "../plugin"
import { Wildcard } from "../util/wildcard"
import { PermissionID } from "./schema"
import { InstanceState } from "@/effect/instance-state"
import { makeRunPromise } from "@/effect/run-service"

export namespace Permission {
  const log = Log.create({ service: "permission" })

  function keys(pattern: Info["pattern"], type: string) {
    return pattern === undefined ? [type] : Array.isArray(pattern) ? pattern : [pattern]
  }

  function covered(input: string[], approved: Map<string, boolean>) {
    return input.every((key) => {
      for (const pattern of approved.keys()) {
        if (Wildcard.match(key, pattern)) return true
      }
      return false
    })
  }

  export const Info = z
    .object({
      id: PermissionID.zod,
      type: z.string(),
      pattern: z.union([z.string(), z.array(z.string())]).optional(),
      sessionID: SessionID.zod,
      messageID: MessageID.zod,
      callID: z.string().optional(),
      message: z.string(),
      metadata: z.record(z.string(), z.any()),
      time: z.object({
        created: z.number(),
      }),
    })
    .meta({
      ref: "Permission",
    })
  export type Info = z.infer<typeof Info>

  interface PendingEntry {
    info: Info
    deferred: Deferred.Deferred<void, RejectedError>
  }

  interface State {
    pending: Map<SessionID, Map<PermissionID, PendingEntry>>
    approved: Map<SessionID, Map<string, boolean>>
  }

  export const Event = {
    Updated: BusEvent.define("permission.updated", Info),
    Replied: BusEvent.define(
      "permission.replied",
      z.object({
        sessionID: SessionID.zod,
        permissionID: PermissionID.zod,
        response: z.string(),
      }),
    ),
  }

  export const Response = z.enum(["once", "always", "reject"])
  export type Response = z.infer<typeof Response>

  export interface Interface {
    readonly pending: () => Effect.Effect<Map<SessionID, Map<PermissionID, PendingEntry>>>
    readonly list: () => Effect.Effect<Info[]>
    readonly ask: (input: {
      type: Info["type"]
      message: Info["message"]
      pattern?: Info["pattern"]
      callID?: Info["callID"]
      sessionID: Info["sessionID"]
      messageID: Info["messageID"]
      metadata: Info["metadata"]
    }) => Effect.Effect<void, RejectedError>
    readonly respond: (input: {
      sessionID: Info["sessionID"]
      permissionID: Info["id"]
      response: Response
    }) => Effect.Effect<void>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@symbolic-agent/Permission") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const state = yield* InstanceState.make<State>(
        Effect.fn("Permission.state")(function* () {
          const state = {
            pending: new Map<SessionID, Map<PermissionID, PendingEntry>>(),
            approved: new Map<SessionID, Map<string, boolean>>(),
          }

          yield* Effect.addFinalizer(() =>
            Effect.gen(function* () {
              for (const session of state.pending.values()) {
                for (const item of session.values()) {
                  yield* Deferred.fail(
                    item.deferred,
                    new RejectedError(item.info.sessionID, item.info.id, item.info.callID, item.info.metadata),
                  )
                }
              }
              state.pending.clear()
              state.approved.clear()
            }),
          )

          return state
        }),
      )

      const pending = Effect.fn("Permission.pending")(function* () {
        return (yield* InstanceState.get(state)).pending
      })

      const list = Effect.fn("Permission.list")(function* () {
        const { pending } = yield* InstanceState.get(state)
        const result: Info[] = []
        for (const session of pending.values()) {
          for (const item of session.values()) {
            result.push(item.info)
          }
        }
        return result.sort((a, b) => a.id.localeCompare(b.id))
      })

      const ask = Effect.fn("Permission.ask")(function* (input: {
        type: Info["type"]
        message: Info["message"]
        pattern?: Info["pattern"]
        callID?: Info["callID"]
        sessionID: Info["sessionID"]
        messageID: Info["messageID"]
        metadata: Info["metadata"]
      }) {
        const { pending, approved } = yield* InstanceState.get(state)
        log.info("asking", {
          sessionID: input.sessionID,
          messageID: input.messageID,
          toolCallID: input.callID,
          pattern: input.pattern,
        })
        const approvedForSession = approved.get(input.sessionID)
        const inputKeys = keys(input.pattern, input.type)
        if (approvedForSession && covered(inputKeys, approvedForSession)) return

        const info: Info = {
          id: PermissionID.ascending(),
          type: input.type,
          pattern: input.pattern,
          sessionID: input.sessionID,
          messageID: input.messageID,
          callID: input.callID,
          message: input.message,
          metadata: input.metadata,
          time: {
            created: Date.now(),
          },
        }

        const result = yield* Effect.promise(() =>
          Plugin.trigger("permission.ask", info, {
            status: "ask",
          }).then((x) => x.status),
        )
        if (result === "deny") {
          return yield* Effect.fail(new RejectedError(info.sessionID, info.id, info.callID, info.metadata))
        }
        if (result === "allow") return

        if (!pending.has(input.sessionID)) pending.set(input.sessionID, new Map())
        const deferred = yield* Deferred.make<void, RejectedError>()
        pending.get(input.sessionID)!.set(info.id, {
          info,
          deferred,
        })
        void Bus.publish(Event.Updated, info)

        return yield* Effect.ensuring(
          Deferred.await(deferred),
          Effect.sync(() => {
            const session = pending.get(input.sessionID)
            session?.delete(info.id)
            if (session && session.size === 0) pending.delete(input.sessionID)
          }),
        )
      })

      const respond: Interface["respond"] = Effect.fn("Permission.respond")(function* (input: {
        sessionID: Info["sessionID"]
        permissionID: Info["id"]
        response: Response
      }) {
        log.info("response", input)
        const { pending, approved } = yield* InstanceState.get(state)
        const session = pending.get(input.sessionID)
        const match = session?.get(input.permissionID)
        if (!session || !match) return
        session.delete(input.permissionID)
        if (session.size === 0) pending.delete(input.sessionID)
        void Bus.publish(Event.Replied, {
          sessionID: input.sessionID,
          permissionID: input.permissionID,
          response: input.response,
        })
        if (input.response === "reject") {
          yield* Deferred.fail(
            match.deferred,
            new RejectedError(input.sessionID, input.permissionID, match.info.callID, match.info.metadata),
          )
          return
        }

        yield* Deferred.succeed(match.deferred, undefined)
        if (input.response !== "always") return

        if (!approved.has(input.sessionID)) approved.set(input.sessionID, new Map())
        const approvedForSession = approved.get(input.sessionID)!
        for (const key of keys(match.info.pattern, match.info.type)) {
          approvedForSession.set(key, true)
        }

        const items = pending.get(input.sessionID)
        if (!items) return
        const next: Info[] = []
        for (const item of items.values()) {
          if (!covered(keys(item.info.pattern, item.info.type), approvedForSession)) continue
          next.push(item.info)
        }
        for (const item of next) {
          yield* respond({
            sessionID: item.sessionID,
            permissionID: item.id,
            response: input.response,
          })
        }
      })

      return Service.of({ pending, list, ask, respond })
    }),
  )

  const runPromise = makeRunPromise(Service, layer)

  export async function pending() {
    return runPromise((svc) => svc.pending())
  }

  export async function list() {
    return runPromise((svc) => svc.list())
  }

  export async function ask(input: {
    type: Info["type"]
    message: Info["message"]
    pattern?: Info["pattern"]
    callID?: Info["callID"]
    sessionID: Info["sessionID"]
    messageID: Info["messageID"]
    metadata: Info["metadata"]
  }) {
    return runPromise((svc) => svc.ask(input))
  }

  export async function respond(input: { sessionID: Info["sessionID"]; permissionID: Info["id"]; response: Response }) {
    return runPromise((svc) => svc.respond(input))
  }

  export class RejectedError extends Error {
    constructor(
      public readonly sessionID: SessionID,
      public readonly permissionID: PermissionID,
      public readonly toolCallID?: string,
      public readonly metadata?: Record<string, any>,
      public readonly reason?: string,
    ) {
      super(
        reason !== undefined
          ? reason
          : `The user rejected permission to use this specific tool call. You may try again with different parameters.`,
      )
    }
  }
}
