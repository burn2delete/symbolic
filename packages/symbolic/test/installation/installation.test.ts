import { describe, expect, test } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { Installation } from "../../src/installation"

const encoder = new TextEncoder()

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function mockHttp(handler: (req: HttpClientRequest.HttpClientRequest) => Response) {
  const client = HttpClient.make((req) => Effect.succeed(HttpClientResponse.fromWeb(req, handler(req))))
  return Layer.succeed(HttpClient.HttpClient, client)
}

function mockSpawner(handler: (cmd: string, args: readonly string[]) => string = () => "") {
  const spawner = ChildProcessSpawner.make((cmd) => {
    const std = ChildProcess.isStandardCommand(cmd) ? cmd : undefined
    const out = handler(std?.command ?? "", std?.args ?? [])
    return Effect.succeed(
      ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(0),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        stdin: { [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") } as any,
        stdout: out ? Stream.make(encoder.encode(out)) : Stream.empty,
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => ({ [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") }) as any,
        getOutputFd: () => Stream.empty,
      }),
    )
  })
  return Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)
}

function live(
  http: (req: HttpClientRequest.HttpClientRequest) => Response,
  spawn?: (cmd: string, args: readonly string[]) => string,
) {
  return Installation.layer.pipe(Layer.provide(mockHttp(http)), Layer.provide(mockSpawner(spawn)))
}

describe("installation", () => {
  describe("latest", () => {
    test("reads release version from GitHub releases", async () => {
      const result = await Effect.runPromise(
        Installation.Service.use((svc) => svc.latest("unknown")).pipe(Effect.provide(live(() => json({ tag_name: "v1.2.3" })))),
      )

      expect(result).toBe("1.2.3")
    })

    test("strips v prefix from release tags", async () => {
      const result = await Effect.runPromise(
        Installation.Service.use((svc) => svc.latest("curl")).pipe(Effect.provide(live(() => json({ tag_name: "v4.0.0-beta.1" })))),
      )

      expect(result).toBe("4.0.0-beta.1")
    })

    test("reads npm registry versions", async () => {
      const result = await Effect.runPromise(
        Installation.Service.use((svc) => svc.latest("npm")).pipe(
          Effect.provide(
            live(
              () => json({ version: "1.5.0" }),
              (cmd, args) => {
                if (cmd === "npm" && args.includes("registry")) return "https://registry.npmjs.org\n"
                return ""
              },
            ),
          ),
        ),
      )

      expect(result).toBe("1.5.0")
    })

    test("reads npm registry versions for bun installs", async () => {
      const result = await Effect.runPromise(
        Installation.Service.use((svc) => svc.latest("bun")).pipe(
          Effect.provide(
            live(
              () => json({ version: "1.6.0" }),
              () => "",
            ),
          ),
        ),
      )

      expect(result).toBe("1.6.0")
    })

    test("reads scoop manifest versions", async () => {
      const result = await Effect.runPromise(
        Installation.Service.use((svc) => svc.latest("scoop")).pipe(Effect.provide(live(() => json({ version: "2.3.4" })))),
      )

      expect(result).toBe("2.3.4")
    })

    test("reads chocolatey feed versions", async () => {
      const result = await Effect.runPromise(
        Installation.Service.use((svc) => svc.latest("choco")).pipe(
          Effect.provide(
            live(() =>
              json({
                d: {
                  results: [{ Version: "3.4.5" }],
                },
              }),
            ),
          ),
        ),
      )

      expect(result).toBe("3.4.5")
    })

    test("reads brew formula api versions", async () => {
      const result = await Effect.runPromise(
        Installation.Service.use((svc) => svc.latest("brew")).pipe(
          Effect.provide(
            live(
              () => json({ versions: { stable: "2.0.0" } }),
              (cmd, args) => {
                if (cmd === "brew" && args.includes("--formula") && args.includes("anomalyco/tap/symbolic")) return ""
                if (cmd === "brew" && args.includes("--formula") && args.includes("symbolic")) return "symbolic"
                return ""
              },
            ),
          ),
        ),
      )

      expect(result).toBe("2.0.0")
    })

    test("reads brew tap info from cli json", async () => {
      const info = JSON.stringify({
        formulae: [{ versions: { stable: "2.1.0" } }],
      })
      const result = await Effect.runPromise(
        Installation.Service.use((svc) => svc.latest("brew")).pipe(
          Effect.provide(
            live(
              () => json({}),
              (cmd, args) => {
                if (cmd === "brew" && args.includes("anomalyco/tap/symbolic") && args.includes("--formula"))
                  return "symbolic"
                if (cmd === "brew" && args.includes("--json=v2")) return info
                return ""
              },
            ),
          ),
        ),
      )

      expect(result).toBe("2.1.0")
    })
  })
})
