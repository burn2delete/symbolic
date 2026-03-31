import z from "zod"
import path from "path"
import os from "os"
import { pathToFileURL } from "url"
import { Effect, Layer, ServiceMap } from "effect"
import { Config } from "../config/config"
import { NamedError } from "@symbolic-agent/util/error"
import { ConfigMarkdown } from "../config/markdown"
import { Log } from "../util/log"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { Flag } from "@/flag/flag"
import { Bus } from "@/bus"
import { Session } from "@/session"
import { Discovery } from "./discovery"
import { Glob } from "../util/glob"
import type { Agent } from "@/agent/agent"
import { PermissionNext } from "@/permission/next"
import { InstanceState } from "@/effect/instance-state"
import { makeRunPromise } from "@/effect/run-service"

export namespace Skill {
  const log = Log.create({ service: "skill" })
  const external = [".claude", ".agents"]
  const externalPattern = "skills/**/SKILL.md"
  const symbolicPattern = "{skill,skills}/**/SKILL.md"
  const skillPattern = "**/SKILL.md"

  export const Info = z.object({
    name: z.string(),
    description: z.string(),
    location: z.string(),
    content: z.string(),
  })
  export type Info = z.infer<typeof Info>

  export const InvalidError = NamedError.create(
    "SkillInvalidError",
    z.object({
      path: z.string(),
      message: z.string().optional(),
      issues: z.custom<z.core.$ZodIssue[]>().optional(),
    }),
  )

  export const NameMismatchError = NamedError.create(
    "SkillNameMismatchError",
    z.object({
      path: z.string(),
      expected: z.string(),
      actual: z.string(),
    }),
  )

  type State = {
    skills: Record<string, Info>
    dirs: Set<string>
    ready: boolean
    loading?: Promise<void>
    load: () => Effect.Effect<void>
  }

  export interface Interface {
    readonly get: (name: string) => Effect.Effect<Info | undefined>
    readonly all: () => Effect.Effect<Info[]>
    readonly dirs: () => Effect.Effect<string[]>
    readonly available: (agent?: Agent.Info) => Effect.Effect<Info[]>
  }

  const add = Effect.fnUntraced(function* (state: State, match: string) {
    const md = yield* Effect.tryPromise({
      try: () => ConfigMarkdown.parse(match),
      catch: (err) => err,
    }).pipe(
      Effect.catch(
        Effect.fnUntraced(function* (err) {
          const message = ConfigMarkdown.FrontmatterError.isInstance(err)
            ? err.data.message
            : `Failed to parse skill ${match}`
          yield* Effect.promise(() =>
            Bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() }),
          )
          log.error("failed to load skill", { skill: match, err })
          return undefined
        }),
      ),
    )

    if (!md) return

    const parsed = Info.pick({ name: true, description: true }).safeParse(md.data)
    if (!parsed.success) return

    if (state.skills[parsed.data.name]) {
      log.warn("duplicate skill name", {
        name: parsed.data.name,
        existing: state.skills[parsed.data.name].location,
        duplicate: match,
      })
    }

    state.dirs.add(path.dirname(match))
    state.skills[parsed.data.name] = {
      name: parsed.data.name,
      description: parsed.data.description,
      location: match,
      content: md.content,
    }
  })

  const scan = Effect.fnUntraced(function* (
    state: State,
    root: string,
    pattern: string,
    opts?: { dot?: boolean; scope?: string },
  ) {
    const list = yield* Effect.tryPromise({
      try: () =>
        Glob.scan(pattern, {
          cwd: root,
          absolute: true,
          include: "file",
          symlink: true,
          dot: opts?.dot,
        }),
      catch: (err) => err,
    }).pipe(
      Effect.catch((err) => {
        if (!opts?.scope) return Effect.die(err)
        log.error(`failed to scan ${opts.scope} skills`, { dir: root, err })
        return Effect.succeed([] as string[])
      }),
    )

    yield* Effect.forEach(list, (item) => add(state, item), {
      concurrency: "unbounded",
      discard: true,
    })
  })

  const loadSkills = Effect.fnUntraced(function* (state: State, directory: string, worktree: string) {
    if (!Flag.SYMBOLIC_DISABLE_EXTERNAL_SKILLS) {
      for (const dir of external) {
        const root = path.join(Global.Path.home, dir)
        const ok = yield* Effect.promise(() => Filesystem.isDir(root))
        if (!ok) continue
        yield* scan(state, root, externalPattern, { dot: true, scope: "global" })
      }

      const roots = yield* Effect.promise(async () => {
        const list: string[] = []
        for await (const root of Filesystem.up({
          targets: external,
          start: directory,
          stop: worktree,
        })) {
          list.push(root)
        }
        return list
      })

      for (const root of roots) {
        yield* scan(state, root, externalPattern, { dot: true, scope: "project" })
      }
    }

    const dirs = yield* Effect.promise(() => Config.directories())
    for (const dir of dirs) {
      yield* scan(state, dir, symbolicPattern)
    }

    const cfg = yield* Effect.promise(() => Config.get())
    for (const item of cfg.skills?.paths ?? []) {
      const expanded = item.startsWith("~/") ? path.join(os.homedir(), item.slice(2)) : item
      const dir = path.isAbsolute(expanded) ? expanded : path.join(directory, expanded)
      const ok = yield* Effect.promise(() => Filesystem.isDir(dir))
      if (!ok) {
        log.warn("skill path not found", { path: dir })
        continue
      }
      yield* scan(state, dir, skillPattern)
    }

    for (const url of cfg.skills?.urls ?? []) {
      const pulled = yield* Effect.promise(() => Discovery.pull(url))
      for (const dir of pulled) {
        state.dirs.add(dir)
        yield* scan(state, dir, skillPattern)
      }
    }
  })

  function create(): State {
    return {
      skills: {},
      dirs: new Set<string>(),
      ready: false,
      loading: undefined,
      load: () => Effect.void,
    }
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@symbolic-agent/Skill") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const state = yield* InstanceState.make(
        Effect.fn("Skill.state")((ctx) =>
          Effect.gen(function* () {
            const s = create()
            s.load = () =>
              Effect.promise(() => {
                if (s.ready) return Promise.resolve()
                if (s.loading) return s.loading
                s.loading = Effect.runPromise(
                  (loadSkills(s, ctx.directory, ctx.worktree) as Effect.Effect<void, never, never>).pipe(
                    Effect.tap(() =>
                      Effect.sync(() => {
                        s.ready = true
                      }),
                    ),
                  ),
                ).finally(() => {
                  s.loading = undefined
                })
                return s.loading
              }).pipe(Effect.catchCause(() => Effect.void))
            return s
          }),
        ),
      )

      const ensure = Effect.fn("Skill.ensure")(function* () {
        const cache = yield* InstanceState.get(state)
        yield* cache.load()
        return cache
      })

      const get = Effect.fn("Skill.get")(function* (name: string) {
        const cache = yield* ensure()
        return cache.skills[name]
      })

      const all = Effect.fn("Skill.all")(function* () {
        const cache = yield* ensure()
        return Object.values(cache.skills)
      })

      const dirs = Effect.fn("Skill.dirs")(function* () {
        const cache = yield* ensure()
        return Array.from(cache.dirs)
      })

      const available = Effect.fn("Skill.available")(function* (agent?: Agent.Info) {
        const cache = yield* ensure()
        const list = Object.values(cache.skills).toSorted((a, b) => a.name.localeCompare(b.name))
        if (!agent) return list
        return list.filter((skill) => PermissionNext.evaluate("skill", skill.name, agent.permission).action !== "deny")
      })

      return Service.of({ get, all, dirs, available })
    }),
  )

  export function fmt(list: Info[], opts: { verbose: boolean }) {
    if (list.length === 0) {
      return "No skills are currently available."
    }
    if (opts.verbose) {
      return [
        "<available_skills>",
        ...list.flatMap((skill) => [
          `  <skill>`,
          `    <name>${skill.name}</name>`,
          `    <description>${skill.description}</description>`,
          `    <location>${pathToFileURL(skill.location).href}</location>`,
          `  </skill>`,
        ]),
        "</available_skills>",
      ].join("\n")
    }
    return ["## Available Skills", ...list.flatMap((skill) => `- **${skill.name}**: ${skill.description}`)].join("\n")
  }

  const runPromise = makeRunPromise(Service, layer)

  export async function get(name: string) {
    return runPromise((svc) => svc.get(name))
  }

  export async function all() {
    return runPromise((svc) => svc.all())
  }

  export async function dirs() {
    return runPromise((svc) => svc.dirs())
  }

  export async function available(agent?: Agent.Info) {
    return runPromise((svc) => svc.available(agent))
  }
}
