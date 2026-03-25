import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { ProviderAuth } from "../../src/provider/auth"

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
})
