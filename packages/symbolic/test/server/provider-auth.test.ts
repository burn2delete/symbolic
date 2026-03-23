import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { Server } from "../../src/server/server"

afterEach(async () => {
  await resetDatabase()
})

async function plugin(dir: string) {
  const root = path.join(dir, ".symbolic", "plugin")
  await fs.mkdir(root, { recursive: true })
  await Bun.write(
    path.join(root, "provider-auth.ts"),
    [
      "export default async () => ({",
      "  auth: {",
      '    provider: "test-provider",',
      "    methods: [",
      "      {",
      '        type: "oauth",',
      '        label: "Login with SSO",',
      "        prompts: [",
      "          {",
      '            type: "select",',
      '            key: "deployment",',
      '            message: "Deployment",',
      "            options: [",
      '              { label: "Cloud", value: "cloud" },',
      '              { label: "Self-hosted", value: "self", hint: "Bring your own domain" },',
      "            ],",
      "          },",
      "          {",
      '            type: "text",',
      '            key: "host",',
      '            message: "Host",',
      '            placeholder: "git.example.com",',
      '            when: { key: "deployment", op: "eq", value: "self" },',
      '            validate: (value) => value ? undefined : "Host is required",',
      "          },",
      "        ],",
      "        async authorize(inputs = {}) {",
      '          const url = inputs.deployment === "self" ? `https://${inputs.host}` : "https://cloud.example.com"',
      "          return {",
      "            url,",
      '            instructions: inputs.host ?? "cloud",',
      '            method: "code",',
      '            async callback(code) { return { type: "success", key: code } },',
      "          }",
      "        },",
      "      },",
      "    ],",
      "  },",
      "})",
      "",
    ].join("\n"),
  )
}

describe("provider auth routes", () => {
  test("returns prompt metadata and forwards inputs into authorize", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: plugin,
    })
    const app = Server.Default()

    const methods = await app.request("/provider/auth", {
      headers: {
        "x-symbolic-directory": tmp.path,
      },
    })
    expect(methods.status).toBe(200)
    const body = (await methods.json()) as Record<string, unknown>
    expect(body["test-provider"]).toEqual([
      {
        type: "oauth",
        label: "Login with SSO",
        prompts: [
          {
            type: "select",
            key: "deployment",
            message: "Deployment",
            options: [
              { label: "Cloud", value: "cloud" },
              { label: "Self-hosted", value: "self", hint: "Bring your own domain" },
            ],
          },
          {
            type: "text",
            key: "host",
            message: "Host",
            placeholder: "git.example.com",
            when: { key: "deployment", op: "eq", value: "self" },
          },
        ],
      },
    ])

    const authorize = await app.request("/provider/test-provider/oauth/authorize", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-symbolic-directory": tmp.path,
      },
      body: JSON.stringify({
        method: 0,
        inputs: {
          deployment: "self",
          host: "git.example.com",
        },
      }),
    })
    expect(authorize.status).toBe(200)
    expect(await authorize.json()).toEqual({
      url: "https://git.example.com",
      instructions: "git.example.com",
      method: "code",
    })
  })

  test("returns 400 when prompt validation fails", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: plugin,
    })
    const app = Server.Default()

    const res = await app.request("/provider/test-provider/oauth/authorize", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-symbolic-directory": tmp.path,
      },
      body: JSON.stringify({
        method: 0,
        inputs: {
          deployment: "self",
          host: "",
        },
      }),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      name: "ProviderAuthValidationFailed",
      data: {
        field: "host",
        message: "Host is required",
      },
    })
  })
})
