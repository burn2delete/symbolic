import path from "path"
import { Effect, Layer, ServiceMap } from "effect"
import { makeRunPromise } from "@/effect/run-service"
import { Global } from "../global"
import z from "zod"
import { Filesystem } from "../util/filesystem"

export const OAUTH_DUMMY_KEY = "symbolic-oauth-dummy-key"

export namespace Auth {
  export const Oauth = z
    .object({
      type: z.literal("oauth"),
      refresh: z.string(),
      access: z.string(),
      expires: z.number(),
      accountId: z.string().optional(),
      enterpriseUrl: z.string().optional(),
    })
    .meta({ ref: "OAuth" })

  export const Api = z
    .object({
      type: z.literal("api"),
      key: z.string(),
      enterpriseUrl: z.string().optional(),
    })
    .meta({ ref: "ApiAuth" })

  export const WellKnown = z
    .object({
      type: z.literal("wellknown"),
      key: z.string(),
      token: z.string(),
    })
    .meta({ ref: "WellKnownAuth" })

  export const Info = z.discriminatedUnion("type", [Oauth, Api, WellKnown]).meta({ ref: "Auth" })
  export type Info = z.infer<typeof Info>

  const file = path.join(Global.Path.data, "auth.json")

  export class AuthError extends Error {
    override readonly cause?: unknown

    constructor(
      message: string,
      cause?: unknown,
    ) {
      super(message)
      this.cause = cause
    }
  }

  function fail(message: string) {
    return (cause: unknown) => new AuthError(message, cause)
  }

  export interface Interface {
    readonly get: (providerID: string) => Effect.Effect<Info | undefined, AuthError>
    readonly all: () => Effect.Effect<Record<string, Info>, AuthError>
    readonly set: (key: string, info: Info) => Effect.Effect<void, AuthError>
    readonly remove: (key: string) => Effect.Effect<void, AuthError>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@symbolic-agent/Auth") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const all = Effect.fn("Auth.all")(() =>
        Effect.tryPromise({
          try: async () => {
            const data = await Filesystem.readJson<Record<string, unknown>>(file).catch(() => ({}))
            return Object.entries(data).reduce(
              (acc, [key, value]) => {
                const parsed = Info.safeParse(value)
                if (!parsed.success) return acc
                acc[key] = parsed.data
                return acc
              },
              {} as Record<string, Info>,
            )
          },
          catch: fail("Failed to read auth data"),
        }),
      )

      const get = Effect.fn("Auth.get")(function* (providerID: string) {
        return (yield* all())[providerID]
      })

      const set = Effect.fn("Auth.set")(function* (key: string, info: Info) {
        const norm = key.replace(/\/+$/, "")
        const data = yield* all()
        if (norm !== key) delete data[key]
        delete data[norm + "/"]
        yield* Effect.tryPromise({
          try: () => Filesystem.writeJson(file, { ...data, [norm]: info }, 0o600),
          catch: fail("Failed to write auth data"),
        })
      })

      const remove = Effect.fn("Auth.remove")(function* (key: string) {
        const norm = key.replace(/\/+$/, "")
        const data = yield* all()
        delete data[key]
        delete data[norm]
        yield* Effect.tryPromise({
          try: () => Filesystem.writeJson(file, data, 0o600),
          catch: fail("Failed to write auth data"),
        })
      })

      return Service.of({ get, all, set, remove })
    }),
  )

  const runPromise = makeRunPromise(Service, layer)

  export async function get(providerID: string) {
    return runPromise((svc) => svc.get(providerID))
  }

  export async function all(): Promise<Record<string, Info>> {
    return runPromise((svc) => svc.all())
  }

  export async function set(key: string, info: Info) {
    return runPromise((svc) => svc.set(key, info))
  }

  export async function remove(key: string) {
    return runPromise((svc) => svc.remove(key))
  }
}
