import { Instance } from "@/project/instance"
import { Plugin } from "../plugin"
import { map, filter, pipe, fromEntries, mapValues } from "remeda"
import z from "zod"
import { fn } from "@/util/fn"
import type { AuthOuathResult, Hooks } from "@symbolic-agent/plugin"
import { NamedError } from "@symbolic-agent/util/error"
import { Auth } from "@/auth"
import { ProviderID } from "./schema"

export namespace ProviderAuth {
  const state = Instance.state(async () => {
    const methods = pipe(
      await Plugin.list(),
      filter((x) => x.auth?.provider !== undefined),
      map((x) => [x.auth!.provider, x.auth!] as const),
      fromEntries(),
    )
    return { methods, pending: {} as Record<string, AuthOuathResult> }
  })

  const Prompt = z.union([
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
  ])

  export const Method = z
    .object({
      type: z.union([z.literal("oauth"), z.literal("api")]),
      label: z.string(),
      prompts: z.array(Prompt).optional(),
    })
    .meta({
      ref: "ProviderAuthMethod",
    })
  export type Method = z.infer<typeof Method>

  export async function methods() {
    const s = await state().then((x) => x.methods)
    return mapValues(s, (x) =>
      x.methods.map(
        (y): Method => ({
          type: y.type,
          label: y.label,
          prompts: y.prompts?.map((prompt) => {
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
    )
  }

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

  export const authorize = fn(
    z.object({
      providerID: ProviderID.zod,
      method: z.number(),
      inputs: z.record(z.string(), z.string()).optional(),
    }),
    async (input): Promise<Authorization | undefined> => {
      const auth = await state().then((s) => s.methods[input.providerID])
      const method = auth.methods[input.method]
      if (method.type === "oauth") {
        if (method.prompts && input.inputs) {
          for (const prompt of method.prompts) {
            if (prompt.type !== "text" || !prompt.validate) continue
            const value = input.inputs[prompt.key]
            if (value === undefined) continue
            const error = prompt.validate(value)
            if (error) throw new ValidationFailed({ field: prompt.key, message: error })
          }
        }
        const result = await method.authorize(input.inputs)
        await state().then((s) => (s.pending[input.providerID] = result))
        return {
          url: result.url,
          method: result.method,
          instructions: result.instructions,
        }
      }
    },
  )

  export const callback = fn(
    z.object({
      providerID: ProviderID.zod,
      method: z.number(),
      code: z.string().optional(),
    }),
    async (input) => {
      const match = await state().then((s) => s.pending[input.providerID])
      if (!match) throw new OauthMissing({ providerID: input.providerID })
      let result

      if (match.method === "code") {
        if (!input.code) throw new OauthCodeMissing({ providerID: input.providerID })
        result = await match.callback(input.code)
      }

      if (match.method === "auto") {
        result = await match.callback()
      }

      if (result?.type === "success") {
        if ("key" in result) {
          await Auth.set(input.providerID, {
            type: "api",
            key: result.key,
          })
        }
        if ("refresh" in result) {
          const info: Auth.Info = {
            type: "oauth",
            access: result.access,
            refresh: result.refresh,
            expires: result.expires,
          }
          if (result.accountId) {
            info.accountId = result.accountId
          }
          await Auth.set(input.providerID, info)
        }
        return
      }

      throw new OauthCallbackFailed({})
    },
  )

  export const api = fn(
    z.object({
      providerID: ProviderID.zod,
      key: z.string(),
    }),
    async (input) => {
      await Auth.set(input.providerID, {
        type: "api",
        key: input.key,
      })
    },
  )

  export const OauthMissing = NamedError.create(
    "ProviderAuthOauthMissing",
    z.object({
      providerID: ProviderID.zod,
    }),
  )
  export const OauthCodeMissing = NamedError.create(
    "ProviderAuthOauthCodeMissing",
    z.object({
      providerID: ProviderID.zod,
    }),
  )

  export const OauthCallbackFailed = NamedError.create("ProviderAuthOauthCallbackFailed", z.object({}))
  export const ValidationFailed = NamedError.create(
    "ProviderAuthValidationFailed",
    z.object({
      field: z.string(),
      message: z.string(),
    }),
  )
}
