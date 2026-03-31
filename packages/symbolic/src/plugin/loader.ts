import { BunProc } from "@/bun"
import { Config } from "@/config/config"
import {
  isDeprecatedPlugin,
  isPathPluginSpec,
  parsePluginSpecifier,
  pluginSource,
  resolvePathPluginTarget,
  resolvePluginEntrypoint,
  type PluginKind,
  type PluginSource,
} from "./shared"

export namespace PluginLoader {
  export type Plan = {
    item: Config.PluginSpec
    spec: string
    opts: ReturnType<typeof Config.pluginOptions>
    deprecated: boolean
  }

  export type Resolved = Plan & {
    source: PluginSource
    target: string
    entry: string
  }

  export type Loaded = Resolved & {
    mod: Record<string, unknown>
  }

  export function plan(item: Config.PluginSpec): Plan {
    const spec = Config.pluginSpec(item)
    return {
      item,
      spec,
      opts: Config.pluginOptions(item),
      deprecated: isDeprecatedPlugin(spec),
    }
  }

  export async function resolve(plan: Plan, kind: PluginKind) {
    const source = isPathPluginSpec(plan.spec) ? "file" : pluginSource(plan.spec)
    const parsed = parsePluginSpecifier(plan.spec)
    const target =
      source === "file"
        ? await resolvePathPluginTarget(plan.spec)
        : await BunProc.install(parsed.pkg, parsed.version, { ignoreScripts: true })
    const entry = await resolvePluginEntrypoint(plan.spec, target, kind)
    return {
      ...plan,
      source,
      target,
      entry,
    } satisfies Resolved
  }

  export async function load(input: Resolved) {
    const mod = (await import(input.entry)) as Record<string, unknown>
    return {
      ...input,
      mod,
    } satisfies Loaded
  }
}
