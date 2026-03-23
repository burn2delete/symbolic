import type { AuthOuathResult, Hooks } from "@symbolic-agent/plugin"
import { NamedError } from "@symbolic-agent/util/error"
import { Auth } from "@/auth"
import { InstanceState } from "@/effect/instance-state"
import { makeRunPromise } from "@/effect/run-service"
import { Plugin } from "../plugin"
import { ProviderID } from "./schema"
import { Effect, Layer, ServiceMap } from "effect"
import z from "zod"

export namespace ProviderAuth {
  export const Method = z
    .object({
      type: z.union([z.literal("oauth"), z.literal("api")]),
      label: z.string(),
      prompts: z
        .array(
          z.union([
            z.object({
              type: z.literal("text"),
              key: z.string(),
              message: z.string(),
              placeholder: z.string().optional(),
              when: z
                .object({
                  key: z.string(),
                  op: z.union([z.literal("eq"), z.literal("neq")]),
                  value: z.string(),
                })
                .optional(),
            }),
            z.object({
              type: z.literal("select"),
              key: z.string(),
              message: z.string(),
              options: z.array(
                z.object({
                  label: z.string(),
                  value: z.string(),
                  hint: z.string().optional(),
                }),
              ),
              when: z
                .object({
                  key: z.string(),
                  op: z.union([z.literal("eq"), z.literal("neq")]),
                  value: z.string(),
                })
                .optional(),
            }),
          ]),
        )
        .optional(),
    })
    .meta({
      ref: "ProviderAuthMethod",
    })
  export type Method = z.infer<typeof Method>

  export const Authorization = z
    .object({
      url: z.string(),
      method: z.union([z.literal("auto"), z.literal("code")]),
      instructions: z.string(),
    })
    .meta({
      ref: "ProviderAuthAuthorization",
    })
  export type Authorization = z.infer<typeof Authorization>

  export const OauthMissing = NamedError.create("ProviderAuthOauthMissing", z.object({ providerID: ProviderID.zod }))
  export const OauthCodeMissing = NamedError.create(
    "ProviderAuthOauthCodeMissing",
    z.object({ providerID: ProviderID.zod }),
  )
  export const OauthCallbackFailed = NamedError.create("ProviderAuthOauthCallbackFailed", z.object({}))
  export const ValidationFailed = NamedError.create(
    "ProviderAuthValidationFailed",
    z.object({
      field: z.string(),
      message: z.string(),
    }),
  )

  type Hook = NonNullable<Hooks["auth"]>
  type AuthorizeError = InstanceType<typeof ValidationFailed>
  type CallbackError =
    | InstanceType<typeof OauthMissing>
    | InstanceType<typeof OauthCodeMissing>
    | InstanceType<typeof OauthCallbackFailed>

  interface State {
    hooks: Record<string, Hook>
    pending: Map<ProviderID, AuthOuathResult>
  }

  export interface Interface {
    readonly methods: () => Effect.Effect<Record<string, Method[]>>
    readonly authorize: (input: {
      providerID: ProviderID
      method: number
      inputs?: Record<string, string>
    }) => Effect.Effect<Authorization | undefined, AuthorizeError>
    readonly callback: (input: {
      providerID: ProviderID
      method: number
      code?: string
    }) => Effect.Effect<void, CallbackError>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@symbolic-agent/ProviderAuth") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const state = yield* InstanceState.make<State>(
        Effect.fn("ProviderAuth.state")(() =>
          Effect.promise(async () => {
            const plugins = await Plugin.list()
            const hooks: Record<string, Hook> = {}
            for (const item of plugins) {
              if (!item.auth?.provider) continue
              hooks[item.auth.provider] = item.auth
            }
            return {
              hooks,
              pending: new Map<ProviderID, AuthOuathResult>(),
            }
          }),
        ),
      )

      const methods = Effect.fn("ProviderAuth.methods")(function* () {
        const hooks = (yield* InstanceState.get(state)).hooks
        return Object.fromEntries(
          Object.entries(hooks).map(([providerID, item]) => [
            providerID,
            item.methods.map(
              (method): Method => ({
                type: method.type,
                label: method.label,
                prompts: method.prompts?.map((prompt) => {
                  if (prompt.type === "select") {
                    return {
                      type: "select" as const,
                      key: prompt.key,
                      message: prompt.message,
                      options: prompt.options,
                      when: prompt.when,
                    }
                  }
                  return {
                    type: "text" as const,
                    key: prompt.key,
                    message: prompt.message,
                    placeholder: prompt.placeholder,
                    when: prompt.when,
                  }
                }),
              }),
            ),
          ]),
        ) as Record<string, Method[]>
      })

      const authorize = Effect.fn("ProviderAuth.authorize")(function* (input: {
        providerID: ProviderID
        method: number
        inputs?: Record<string, string>
      }) {
        const { hooks, pending } = yield* InstanceState.get(state)
        const method = hooks[input.providerID]?.methods[input.method]
        if (!method || method.type !== "oauth") return

        if (method.prompts && input.inputs) {
          for (const prompt of method.prompts) {
            if (prompt.type !== "text" || !prompt.validate) continue
            if (input.inputs[prompt.key] === undefined) continue
            const error = prompt.validate(input.inputs[prompt.key])
            if (error) {
              return yield* Effect.fail(new ValidationFailed({ field: prompt.key, message: error }))
            }
          }
        }

        const result = yield* Effect.promise(() => method.authorize(input.inputs))
        pending.set(input.providerID, result)
        return {
          url: result.url,
          method: result.method,
          instructions: result.instructions,
        }
      })

      const callback = Effect.fn("ProviderAuth.callback")(function* (input: {
        providerID: ProviderID
        method: number
        code?: string
      }) {
        const pending = (yield* InstanceState.get(state)).pending
        const match = pending.get(input.providerID)
        if (!match) {
          return yield* Effect.fail(new OauthMissing({ providerID: input.providerID }))
        }
        if (match.method === "code" && !input.code) {
          return yield* Effect.fail(new OauthCodeMissing({ providerID: input.providerID }))
        }

        const result = yield* Effect.promise(() =>
          match.method === "code" ? match.callback(input.code!) : match.callback(),
        )
        if (!result || result.type !== "success") {
          return yield* Effect.fail(new OauthCallbackFailed({}))
        }

        if ("key" in result) {
          yield* Effect.promise(() =>
            Auth.set(input.providerID, {
              type: "api",
              key: result.key,
            }),
          )
        }

        if ("refresh" in result) {
          yield* Effect.promise(() =>
            Auth.set(input.providerID, {
              type: "oauth",
              access: result.access,
              refresh: result.refresh,
              expires: result.expires,
              ...(result.accountId ? { accountId: result.accountId } : {}),
            }),
          )
        }
      })

      return Service.of({ methods, authorize, callback })
    }),
  )

  const runPromise = makeRunPromise(Service, layer)

  export async function methods() {
    return runPromise((svc) => svc.methods())
  }

  export async function authorize(input: {
    providerID: ProviderID
    method: number
    inputs?: Record<string, string>
  }): Promise<Authorization | undefined> {
    return runPromise((svc) => svc.authorize(input))
  }

  export async function callback(input: { providerID: ProviderID; method: number; code?: string }) {
    return runPromise((svc) => svc.callback(input))
  }
}
