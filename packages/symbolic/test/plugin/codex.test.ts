import { describe, expect, test } from "bun:test"
import {
  parseJwtClaims,
  extractAccountIdFromClaims,
  extractAccountId,
  patch,
  type IdTokenClaims,
} from "../../src/plugin/codex"
import type { Provider } from "../../src/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"

function createTestJwt(payload: object): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  return `${header}.${body}.sig`
}

describe("plugin.codex", () => {
  describe("parseJwtClaims", () => {
    test("parses valid JWT with claims", () => {
      const payload = { email: "test@example.com", chatgpt_account_id: "acc-123" }
      const jwt = createTestJwt(payload)
      const claims = parseJwtClaims(jwt)
      expect(claims).toEqual(payload)
    })

    test("returns undefined for JWT with less than 3 parts", () => {
      expect(parseJwtClaims("invalid")).toBeUndefined()
      expect(parseJwtClaims("only.two")).toBeUndefined()
    })

    test("returns undefined for invalid base64", () => {
      expect(parseJwtClaims("a.!!!invalid!!!.b")).toBeUndefined()
    })

    test("returns undefined for invalid JSON payload", () => {
      const header = Buffer.from("{}").toString("base64url")
      const invalidJson = Buffer.from("not json").toString("base64url")
      expect(parseJwtClaims(`${header}.${invalidJson}.sig`)).toBeUndefined()
    })
  })

  describe("extractAccountIdFromClaims", () => {
    test("extracts chatgpt_account_id from root", () => {
      const claims: IdTokenClaims = { chatgpt_account_id: "acc-root" }
      expect(extractAccountIdFromClaims(claims)).toBe("acc-root")
    })

    test("extracts chatgpt_account_id from nested https://api.openai.com/auth", () => {
      const claims: IdTokenClaims = {
        "https://api.openai.com/auth": { chatgpt_account_id: "acc-nested" },
      }
      expect(extractAccountIdFromClaims(claims)).toBe("acc-nested")
    })

    test("prefers root over nested", () => {
      const claims: IdTokenClaims = {
        chatgpt_account_id: "acc-root",
        "https://api.openai.com/auth": { chatgpt_account_id: "acc-nested" },
      }
      expect(extractAccountIdFromClaims(claims)).toBe("acc-root")
    })

    test("extracts from organizations array as fallback", () => {
      const claims: IdTokenClaims = {
        organizations: [{ id: "org-123" }, { id: "org-456" }],
      }
      expect(extractAccountIdFromClaims(claims)).toBe("org-123")
    })

    test("returns undefined when no accountId found", () => {
      const claims: IdTokenClaims = { email: "test@example.com" }
      expect(extractAccountIdFromClaims(claims)).toBeUndefined()
    })
  })

  describe("extractAccountId", () => {
    test("extracts from id_token first", () => {
      const idToken = createTestJwt({ chatgpt_account_id: "from-id-token" })
      const accessToken = createTestJwt({ chatgpt_account_id: "from-access-token" })
      expect(
        extractAccountId({
          id_token: idToken,
          access_token: accessToken,
          refresh_token: "rt",
        }),
      ).toBe("from-id-token")
    })

    test("falls back to access_token when id_token has no accountId", () => {
      const idToken = createTestJwt({ email: "test@example.com" })
      const accessToken = createTestJwt({
        "https://api.openai.com/auth": { chatgpt_account_id: "from-access" },
      })
      expect(
        extractAccountId({
          id_token: idToken,
          access_token: accessToken,
          refresh_token: "rt",
        }),
      ).toBe("from-access")
    })

    test("returns undefined when no tokens have accountId", () => {
      const token = createTestJwt({ email: "test@example.com" })
      expect(
        extractAccountId({
          id_token: token,
          access_token: token,
          refresh_token: "rt",
        }),
      ).toBeUndefined()
    })

    test("handles missing id_token", () => {
      const accessToken = createTestJwt({ chatgpt_account_id: "acc-123" })
      expect(
        extractAccountId({
          id_token: "",
          access_token: accessToken,
          refresh_token: "rt",
        }),
      ).toBe("acc-123")
    })
  })

  describe("patch", () => {
    test("adds hardcoded codex oauth models", () => {
      const provider: { models: Record<string, Provider.Model | undefined> } = {
        models: {},
      }

      patch(provider)

      expect(provider.models["gpt-5.3-codex"]?.limit).toEqual({
        context: 400_000,
        input: 272_000,
        output: 128_000,
      })
      expect(provider.models["gpt-5.4"]?.limit).toEqual({
        context: 400_000,
        input: 272_000,
        output: 128_000,
      })
      expect(provider.models["gpt-5.4"]?.api).toEqual({
        id: "gpt-5.4",
        url: "https://chatgpt.com/backend-api/codex",
        npm: "@ai-sdk/openai",
      })
    })

    test("overrides existing gpt-5.4 metadata", () => {
      const provider: { models: Record<string, Provider.Model | undefined> } = {
        models: {
          "gpt-5.4": {
            id: ModelID.make("gpt-5.4"),
            providerID: ProviderID.openai,
            api: {
              id: "gpt-5.4",
              url: "https://api.openai.com/v1",
              npm: "@ai-sdk/openai",
            },
            name: "GPT-5.4",
            capabilities: {
              temperature: true,
              reasoning: false,
              attachment: false,
              toolcall: false,
              input: { text: true, audio: false, image: false, video: false, pdf: false },
              output: { text: true, audio: false, image: false, video: false, pdf: false },
              interleaved: false,
            },
            cost: { input: 2.5, output: 15, cache: { read: 0.25, write: 0 } },
            limit: { context: 128_000, output: 32_768 },
            status: "beta" as const,
            options: { foo: "bar" },
            headers: { x: "y" },
            release_date: "2026-03-01",
            variants: {},
            family: "gpt",
          },
        },
      }

      patch(provider)

      expect(provider.models["gpt-5.4"]?.limit).toEqual({
        context: 400_000,
        input: 272_000,
        output: 128_000,
      })
      expect(provider.models["gpt-5.4"]?.cost).toEqual({
        input: 0,
        output: 0,
        cache: { read: 0, write: 0 },
      })
      expect(provider.models["gpt-5.4"]?.api.url).toBe("https://chatgpt.com/backend-api/codex")
      expect(provider.models["gpt-5.4"]?.options).toEqual({ foo: "bar" })
      expect(provider.models["gpt-5.4"]?.headers).toEqual({ x: "y" })
      expect(provider.models["gpt-5.4"]?.status).toBe("active")
      expect(provider.models["gpt-5.4"]?.release_date).toBe("2026-03-05")
    })
  })
})
