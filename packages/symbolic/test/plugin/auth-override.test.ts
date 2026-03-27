import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Auth } from "../../src/auth"
import { ProviderAuth } from "../../src/provider/auth"
import { ProviderID } from "../../src/provider/schema"

describe("plugin.auth-override", () => {
  test("user plugin overrides built-in github-copilot auth", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const pluginDir = path.join(dir, ".symbolic", "plugin")
        await fs.mkdir(pluginDir, { recursive: true })

        await Bun.write(
          path.join(pluginDir, "custom-copilot-auth.ts"),
          [
            "export default async () => ({",
            "  auth: {",
            '    provider: "github-copilot",',
            "    methods: [",
            '      { type: "api", label: "Test Override Auth" },',
            "    ],",
            "    loader: async () => ({ access: 'test-token' }),",
            "  },",
            "})",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const methods = await ProviderAuth.methods()
        const copilot = methods["github-copilot"]
        expect(copilot).toBeDefined()
        expect(copilot.length).toBe(1)
        expect(copilot[0].label).toBe("Test Override Auth")
      },
    })
  }, 30000) // Increased timeout for plugin installation

  test("user plugin preserves prompt metadata for overridden auth", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const pluginDir = path.join(dir, ".symbolic", "plugin")
        await fs.mkdir(pluginDir, { recursive: true })

        await Bun.write(
          path.join(pluginDir, "custom-copilot-prompts.ts"),
          [
            "export default async () => ({",
            "  auth: {",
            '    provider: "github-copilot",',
            "    methods: [",
            "      {",
            '        type: "oauth",',
            '        label: "Copilot Enterprise",',
            "        prompts: [",
            "          {",
            '            type: "select",',
            '            key: "mode",',
            '            message: "Mode",',
            "            options: [",
            '              { label: "Cloud", value: "cloud" },',
            '              { label: "Enterprise", value: "enterprise", hint: "Self-hosted" },',
            "            ],",
            "          },",
            "          {",
            '            type: "text",',
            '            key: "host",',
            '            message: "Host",',
            '            placeholder: "ghe.example.com",',
            '            when: { key: "mode", op: "eq", value: "enterprise" },',
            "          },",
            "        ],",
            '        authorize: async () => ({ url: "https://example.com", instructions: "ok", method: "auto", callback: async () => ({ type: "failed" }) }),',
            "      },",
            '      { type: "api", label: "Token" },',
            "    ],",
            "    loader: async () => ({}),",
            "  },",
            "})",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const methods = await ProviderAuth.methods()
        expect(methods["github-copilot"]).toEqual([
          {
            type: "oauth",
            label: "Copilot Enterprise",
            prompts: [
              {
                type: "select",
                key: "mode",
                message: "Mode",
                options: [
                  { label: "Cloud", value: "cloud" },
                  { label: "Enterprise", value: "enterprise", hint: "Self-hosted" },
                ],
              },
              {
                type: "text",
                key: "host",
                message: "Host",
                placeholder: "ghe.example.com",
                when: { key: "mode", op: "eq", value: "enterprise" },
              },
            ],
          },
          {
            type: "api",
            label: "Token",
          },
        ])
      },
    })
  }, 30000)

  test("plugin config hook errors do not block auth loading", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const pluginDir = path.join(dir, ".symbolic", "plugin")
        await fs.mkdir(pluginDir, { recursive: true })

        await Bun.write(
          path.join(pluginDir, "throwing-config.ts"),
          [
            "export default async () => ({",
            "  config: async () => {",
            "    throw new Error('config boom')",
            "  },",
            "  auth: {",
            '    provider: "config-error-provider",',
            "    methods: [",
            '      { type: "api", label: "Config Error" },',
            "    ],",
            "    loader: async () => ({ access: 'test-token' }),",
            "  },",
            "})",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const methods = await ProviderAuth.methods()
        expect(methods["config-error-provider"]).toEqual([
          {
            type: "api",
            label: "Config Error",
          },
        ])
      },
    })
  }, 30000)

  test("oauth callback preserves enterprise url when saving auth", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const pluginDir = path.join(dir, ".symbolic", "plugin")
        await fs.mkdir(pluginDir, { recursive: true })

        await Bun.write(
          path.join(pluginDir, "enterprise-auth.ts"),
          [
            "export default async () => ({",
            "  auth: {",
            '    provider: "enterprise-auth-provider",',
            "    methods: [",
            "      {",
            '        type: "oauth",',
            '        label: "Enterprise Auth",',
            "        async authorize() {",
            '          return { url: "https://example.com", instructions: "ok", method: "code", async callback(code) {',
            "            return {",
            '              type: "success",',
            '              access: `access-${code}`,',
            '              refresh: "refresh-token",',
            "              expires: 123,",
            '              enterpriseUrl: "https://ghe.example.com",',
            "            }",
            "          } }",
            "        },",
            "      },",
            "    ],",
            "    loader: async () => ({}),",
            "  },",
            "})",
            "",
          ].join("\n"),
        )
      },
    })

    await Auth.remove("enterprise-auth-provider").catch(() => undefined)

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const id = ProviderID.make("enterprise-auth-provider")
          await ProviderAuth.authorize({
            providerID: id,
            method: 0,
          })
          await ProviderAuth.callback({
            providerID: id,
            method: 0,
            code: "code",
          })

          const auth = await Auth.get("enterprise-auth-provider")
          expect(auth).toEqual({
            type: "oauth",
            access: "access-code",
            refresh: "refresh-token",
            expires: 123,
            enterpriseUrl: "https://ghe.example.com",
          })
        },
      })
    } finally {
      await Auth.remove("enterprise-auth-provider").catch(() => undefined)
    }
  }, 30000)
})
