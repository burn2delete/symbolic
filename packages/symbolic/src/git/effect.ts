import { Effect, Layer, ServiceMap } from "effect"
import { Process } from "@/util/process"

export namespace GitEffect {
  const cfg = [
    "--no-optional-locks",
    "-c",
    "core.autocrlf=false",
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.longpaths=true",
    "-c",
    "core.symlinks=true",
    "-c",
    "core.quotepath=false",
  ] as const

  function out(result: { text(): string }) {
    return result.text().trim()
  }

  function split(text: string) {
    return text.split("\0").filter(Boolean)
  }

  export type Kind = "added" | "deleted" | "modified"

  export type Base = {
    readonly name: string
    readonly ref: string
  }

  export type Item = {
    readonly file: string
    readonly code: string
    readonly status: Kind
  }

  export type Stat = {
    readonly file: string
    readonly additions: number
    readonly deletions: number
  }

  export interface Result {
    readonly exitCode: number
    readonly text: () => string
    readonly stdout: Buffer
    readonly stderr: Buffer
  }

  export interface Options {
    readonly cwd: string
    readonly env?: Record<string, string>
  }

  export interface Interface {
    readonly run: (args: string[], opts: Options) => Effect.Effect<Result>
    readonly text: (args: string[], opts: Options) => Effect.Effect<string>
    readonly lines: (args: string[], opts: Options) => Effect.Effect<string[]>
    readonly branch: (cwd: string) => Effect.Effect<string | undefined>
    readonly prefix: (cwd: string) => Effect.Effect<string>
    readonly defaultBranch: (cwd: string) => Effect.Effect<Base | undefined>
    readonly hasHead: (cwd: string) => Effect.Effect<boolean>
    readonly mergeBase: (cwd: string, base: string, head?: string) => Effect.Effect<string | undefined>
    readonly show: (cwd: string, ref: string, file: string, prefix?: string) => Effect.Effect<string>
    readonly status: (cwd: string) => Effect.Effect<Item[]>
    readonly diff: (cwd: string, ref: string) => Effect.Effect<Item[]>
    readonly stats: (cwd: string, ref: string) => Effect.Effect<Stat[]>
  }

  function kind(code: string | undefined): Kind {
    if (code === "??") return "added"
    if (code?.includes("U")) return "modified"
    if (code?.includes("A") && !code.includes("D")) return "added"
    if (code?.includes("D") && !code.includes("A")) return "deleted"
    return "modified"
  }

  function parseStatus(text: string) {
    return split(text).flatMap((item) => {
      const file = item.slice(3)
      if (!file) return []
      const code = item.slice(0, 2)
      return [{ file, code, status: kind(code) } satisfies Item]
    })
  }

  function parseNames(text: string) {
    const list = split(text)
    const out: Item[] = []
    for (let i = 0; i < list.length; i += 2) {
      const code = list[i]
      const file = list[i + 1]
      if (!code || !file) continue
      out.push({ file, code, status: kind(code) })
    }
    return out
  }

  function parseStats(text: string) {
    const out: Stat[] = []
    for (const item of split(text)) {
      const a = item.indexOf("\t")
      const b = item.indexOf("\t", a + 1)
      if (a === -1 || b === -1) continue
      const file = item.slice(b + 1)
      if (!file) continue
      const adds = item.slice(0, a)
      const dels = item.slice(a + 1, b)
      const additions = adds === "-" ? 0 : Number.parseInt(adds || "0", 10)
      const deletions = dels === "-" ? 0 : Number.parseInt(dels || "0", 10)
      out.push({
        file,
        additions: Number.isFinite(additions) ? additions : 0,
        deletions: Number.isFinite(deletions) ? deletions : 0,
      })
    }
    return out
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@symbolic-agent/Git") {}

  const run = Effect.fn("Git.run")(function* (args: string[], opts: Options) {
    const result = yield* Effect.promise(() =>
      Process.run(["git", ...cfg, ...args], {
        cwd: opts.cwd,
        env: opts.env,
        stdin: "ignore",
        nothrow: true,
      }),
    )
    return {
      exitCode: result.code,
      text: () => result.stdout.toString(),
      stdout: result.stdout,
      stderr: result.stderr,
    } satisfies Result
  })

  const text = Effect.fn("Git.text")(function* (args: string[], opts: Options) {
    return (yield* run(args, opts)).text()
  })

  const lines = Effect.fn("Git.lines")(function* (args: string[], opts: Options) {
    return (yield* text(args, opts))
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean)
  })

  const branch = Effect.fn("Git.branch")(function* (cwd: string) {
    const result = yield* run(["rev-parse", "--abbrev-ref", "HEAD"], { cwd })
    if (result.exitCode !== 0) return
    const text = out(result)
    if (!text || text === "HEAD") return
    return text
  })

  const prefix = Effect.fn("Git.prefix")(function* (cwd: string) {
    const result = yield* run(["rev-parse", "--show-prefix"], { cwd })
    if (result.exitCode !== 0) return ""
    return out(result)
  })

  const defaultBranch = Effect.fn("Git.defaultBranch")(function* (cwd: string) {
    const remotes = yield* lines(["remote"], { cwd })
    const remote = remotes.includes("origin")
      ? "origin"
      : remotes.length === 1
        ? remotes[0]
        : remotes.includes("upstream")
          ? "upstream"
          : remotes[0]

    if (remote) {
      const head = yield* run(["symbolic-ref", `refs/remotes/${remote}/HEAD`], { cwd })
      if (head.exitCode === 0) {
        const ref = out(head).replace(/^refs\/remotes\//, "")
        const name = ref.startsWith(`${remote}/`) ? ref.slice(remote.length + 1) : ""
        if (name) return { name, ref } satisfies Base
      }
    }

    const refs = yield* lines(["for-each-ref", "--format=%(refname:short)", "refs/heads"], { cwd })
    const configured = yield* run(["config", "init.defaultBranch"], { cwd })
    if (configured.exitCode === 0) {
      const name = out(configured)
      if (name && refs.includes(name)) return { name, ref: name } satisfies Base
    }
    if (refs.includes("main")) return { name: "main", ref: "main" } satisfies Base
    if (refs.includes("master")) return { name: "master", ref: "master" } satisfies Base
    if (refs.length === 1 && refs[0]) return { name: refs[0], ref: refs[0] } satisfies Base
  })

  const hasHead = Effect.fn("Git.hasHead")(function* (cwd: string) {
    return (yield* run(["rev-parse", "--verify", "HEAD"], { cwd })).exitCode === 0
  })

  const mergeBase = Effect.fn("Git.mergeBase")(function* (cwd: string, base: string, head = "HEAD") {
    const result = yield* run(["merge-base", base, head], { cwd })
    if (result.exitCode !== 0) return
    const text = out(result)
    return text || undefined
  })

  const show = Effect.fn("Git.show")(function* (cwd: string, ref: string, file: string, prefix = "") {
    const target = prefix ? `${prefix}${file}` : file
    const result = yield* run(["show", `${ref}:${target}`], { cwd })
    if (result.exitCode !== 0) return ""
    return result.text()
  })

  const status = Effect.fn("Git.status")(function* (cwd: string) {
    return parseStatus(yield* text(["status", "--porcelain=v1", "--untracked-files=all", "--no-renames", "-z", "--", "."], { cwd }))
  })

  const diff = Effect.fn("Git.diff")(function* (cwd: string, ref: string) {
    return parseNames(yield* text(["diff", "--no-ext-diff", "--no-renames", "--name-status", "-z", ref, "--", "."], { cwd }))
  })

  const stats = Effect.fn("Git.stats")(function* (cwd: string, ref: string) {
    return parseStats(yield* text(["diff", "--no-ext-diff", "--no-renames", "--numstat", "-z", ref, "--", "."], { cwd }))
  })

  export const layer = Layer.succeed(Service, Service.of({ run, text, lines, branch, prefix, defaultBranch, hasHead, mergeBase, show, status, diff, stats }))

  export const defaultLayer = layer
}
