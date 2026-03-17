import type { Hooks, PluginInput } from "@symbolic-ai/plugin"
import { Auth } from "../auth"
import { Installation } from "../installation"
import crypto from "node:crypto"
import open from "open"

const CLIENT_ID = process.env.GITLAB_OAUTH_CLIENT_ID || "1d89f9fdb23ee96d4e603201f6861dab6e143c5c3c00469a018a2d94bdc03d4e"
const HOME = "https://gitlab.com"
const SKEW = 5 * 60 * 1000
const SCOPE = ["api"]
const HOST = "127.0.0.1"
const PORT = 8080
const TIMEOUT = 120_000

type Code = {
  code: string
  state: string
}

type Token = {
  access_token: string
  refresh_token: string
  expires_in: number
}

let lock: Promise<void> | undefined

function page(title: string, text: string) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><p>${text}</p></body></html>`
}

function encode(buf: Uint8Array) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

function secret(len: number) {
  return encode(crypto.randomBytes(len))
}

function challenge(input: string) {
  return encode(crypto.createHash("sha256").update(input).digest())
}

function normalize(input: string) {
  const url = new URL(input.includes("://") ? input : `https://${input}`)
  return `${url.protocol}//${url.host}`
}

function listen() {
  let done = false
  let ok = (_data: Code) => {}
  let err = (_err: Error) => {}
  const wait = new Promise<Code>((resolve, reject) => {
    ok = resolve
    err = reject
  })
  void wait.catch(() => undefined)

  const stop = (fn?: () => void) => {
    if (done) return
    done = true
    clearTimeout(id)
    fn?.()
    queueMicrotask(() => server.stop(true))
  }

  const server = Bun.serve({
    hostname: HOST,
    port: PORT,
    fetch(req) {
      const url = new URL(req.url)
      if (url.pathname !== "/callback") {
        return new Response("Not found", { status: 404 })
      }

      const fail = url.searchParams.get("error_description") || url.searchParams.get("error")
      if (fail) {
        stop(() => err(new Error(`OAuth error: ${fail}`)))
        return new Response(page("Authentication Failed", fail), {
          headers: { "content-type": "text/html; charset=utf-8" },
        })
      }

      const code = url.searchParams.get("code")
      const state = url.searchParams.get("state")
      if (!code || !state) {
        stop(() => err(new Error("Missing code or state parameter")))
        return new Response(page("Authentication Failed", "Missing required parameters."), {
          headers: { "content-type": "text/html; charset=utf-8" },
        })
      }

      stop(() => ok({ code, state }))
      return new Response(page("Authentication Successful", "You can close this window and return to Symbolic."), {
        headers: { "content-type": "text/html; charset=utf-8" },
      })
    },
  })

  const id = setTimeout(() => {
    stop(() => err(new Error("OAuth callback timeout")))
  }, TIMEOUT)

  return {
    url: `http://${HOST}:${PORT}/callback`,
    wait: () => wait,
    close() {
      if (done) return
      done = true
      clearTimeout(id)
      server.stop(true)
    },
  }
}

async function token(url: string, body: URLSearchParams) {
  const res = await fetch(`${url.replace(/\/$/, "")}/oauth/token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": `symbolic/${Installation.VERSION}`,
    },
    body: body.toString(),
  })

  if (!res.ok) {
    throw new Error(`GitLab token exchange failed: ${res.status} ${res.statusText} - ${await res.text()}`)
  }

  return (await res.json()) as Token
}

async function fresh(info: Extract<Auth.Info, { type: "oauth" }>, auth: () => Promise<Auth.Info | undefined>) {
  const url = info.enterpriseUrl || HOME
  if (info.expires > Date.now() + SKEW) {
    return {
      apiKey: info.access,
      instanceUrl: url,
    }
  }

  if (!lock) {
    lock = token(
      url,
      new URLSearchParams({
        client_id: CLIENT_ID,
        refresh_token: info.refresh,
        grant_type: "refresh_token",
      }),
    )
      .then(async (next) => {
        await Auth.set("gitlab", {
          type: "oauth",
          access: next.access_token,
          refresh: next.refresh_token || info.refresh,
          expires: Date.now() + next.expires_in * 1000,
          enterpriseUrl: url,
        })
      })
      .catch(async (err) => {
        if (String(err).includes("401")) await Auth.remove("gitlab")
        throw err
      })
      .finally(() => {
        lock = undefined
      })
  }

  await lock
  const next = await auth()
  if (next?.type !== "oauth") throw new Error("Failed to refresh GitLab token")
  return {
    apiKey: next.access,
    instanceUrl: next.enterpriseUrl || HOME,
  }
}

export async function GitlabAuthPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "gitlab",
      async loader(auth) {
        const info = (await auth()) as Auth.Info | undefined
        if (!info) return {}

        if (info.type === "oauth") {
          const next = await fresh(info, auth)
          return {
            ...next,
            clientId: CLIENT_ID,
          }
        }

        if (info.type === "api") {
          return {
            apiKey: info.key,
            instanceUrl: info.enterpriseUrl || process.env.GITLAB_INSTANCE_URL || HOME,
          }
        }

        return {}
      },
      methods: [
        {
          type: "oauth",
          label: "GitLab OAuth",
          prompts: [
            {
              type: "text",
              key: "instanceUrl",
              message: "GitLab instance URL",
              placeholder: HOME,
              validate(value) {
                if (!value) return "Instance URL is required"
                try {
                  normalize(value)
                  return undefined
                } catch {
                  return "Invalid URL format"
                }
              },
            },
          ],
          async authorize(inputs = {}) {
            const url = normalize(inputs.instanceUrl || process.env.GITLAB_INSTANCE_URL || HOME)
            const verifier = secret(43)
            const hash = challenge(verifier)
            const state = secret(32)
            const cb = listen()
            const authUrl = `${url}/oauth/authorize?${
              new URLSearchParams({
                client_id: CLIENT_ID,
                redirect_uri: cb.url,
                response_type: "code",
                state,
                scope: SCOPE.join(" "),
                code_challenge: hash,
                code_challenge_method: "S256",
              }).toString()
            }`

            await open(authUrl).catch(() => undefined)

            return {
              method: "auto" as const,
              url: authUrl,
              instructions: "Your browser should open automatically. If it does not, open the URL manually.",
              async callback() {
                try {
                  const res = await cb.wait()
                  if (res.state !== state) return { type: "failed" as const }
                  const next = await token(
                    url,
                    new URLSearchParams({
                      client_id: CLIENT_ID,
                      code: res.code,
                      grant_type: "authorization_code",
                      redirect_uri: cb.url,
                      code_verifier: verifier,
                    }),
                  )
                  return {
                    type: "success" as const,
                    access: next.access_token,
                    refresh: next.refresh_token,
                    expires: Date.now() + next.expires_in * 1000,
                    enterpriseUrl: url,
                  }
                } catch {
                  return { type: "failed" as const }
                } finally {
                  cb.close()
                }
              },
            }
          },
        },
        {
          type: "api",
          label: "GitLab Personal Access Token",
          prompts: [
            {
              type: "text",
              key: "instanceUrl",
              message: "GitLab instance URL",
              placeholder: HOME,
              validate(value) {
                if (!value) return "Instance URL is required"
                try {
                  normalize(value)
                  return undefined
                } catch {
                  return "Invalid URL format"
                }
              },
            },
            {
              type: "text",
              key: "token",
              message: "Personal Access Token",
              placeholder: "glpat-xxxxxxxxxxxxxxxxxxxx",
              validate(value) {
                if (!value) return "Token is required"
                if (!value.startsWith("glpat-")) return "Token should start with glpat-"
                return undefined
              },
            },
          ],
          async authorize(inputs = {}) {
            const url = normalize(inputs.instanceUrl || process.env.GITLAB_INSTANCE_URL || HOME)
            const key = inputs.token
            if (!key) return { type: "failed" as const }

            const res = await fetch(`${url}/api/v4/user`, {
              headers: {
                Authorization: `Bearer ${key}`,
                "User-Agent": `symbolic/${Installation.VERSION}`,
              },
            })

            if (!res.ok) return { type: "failed" as const }
            return {
              type: "success" as const,
              key,
              enterpriseUrl: url,
            }
          },
        },
      ],
    },
  }
}
