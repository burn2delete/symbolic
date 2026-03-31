import { existsSync } from "fs"
import { createRequire } from "module"
import path from "path"
import { pathToFileURL } from "url"
import z from "zod"
import { mergeDeep, unique } from "remeda"
import { Config } from "./config"
import { ConfigPaths } from "./paths"
import { migrateTuiConfig } from "./migrate-tui-config"
import { TuiInfo } from "./tui-schema"
import { Instance } from "@/project/instance"
import { Flag } from "@/flag/flag"
import { Log } from "@/util/log"
import { Global } from "@/global"

export namespace TuiConfig {
  const log = Log.create({ service: "tui.config" })

  export const Info = TuiInfo

  export type Info = z.output<typeof Info>

  function mergeInfo(target: Info, source: Info): Info {
    const merged = mergeDeep(target, source)
    if (target.plugin && source.plugin) {
      merged.plugin = Config.deduplicatePlugins([...target.plugin, ...source.plugin])
    }
    if (target.plugin_enabled && source.plugin_enabled) {
      merged.plugin_enabled = {
        ...target.plugin_enabled,
        ...source.plugin_enabled,
      }
    }
    return merged
  }

  function customPath() {
    return Flag.SYMBOLIC_TUI_CONFIG
  }

  const state = Instance.state(async () => {
    let projectFiles = Flag.SYMBOLIC_DISABLE_PROJECT_CONFIG
      ? []
      : await ConfigPaths.projectFiles("tui", Instance.directory, Instance.worktree)
    const directories = await ConfigPaths.directories(Instance.directory, Instance.worktree)
    const custom = customPath()
    const managed = Config.managedConfigDir()
    await migrateTuiConfig({ directories, custom, managed })
    // Re-compute after migration since migrateTuiConfig may have created new tui.json files
    projectFiles = Flag.SYMBOLIC_DISABLE_PROJECT_CONFIG
      ? []
      : await ConfigPaths.projectFiles("tui", Instance.directory, Instance.worktree)

    let result: Info = {}

    for (const file of ConfigPaths.fileInDirectory(Global.Path.config, "tui")) {
      result = mergeInfo(result, await loadFile(file))
    }

    if (custom) {
      result = mergeInfo(result, await loadFile(custom))
      log.debug("loaded custom tui config", { path: custom })
    }

    for (const file of projectFiles) {
      result = mergeInfo(result, await loadFile(file))
    }

    for (const dir of unique(directories)) {
      if (!dir.endsWith(".symbolic") && dir !== Flag.SYMBOLIC_CONFIG_DIR) continue
      for (const file of ConfigPaths.fileInDirectory(dir, "tui")) {
        result = mergeInfo(result, await loadFile(file))
      }
    }

    if (existsSync(managed)) {
      for (const file of ConfigPaths.fileInDirectory(managed, "tui")) {
        result = mergeInfo(result, await loadFile(file))
      }
    }

    result.keybinds = Config.Keybinds.parse(result.keybinds ?? {})

    return {
      config: result,
    }
  })

  export async function get() {
    return state().then((x) => x.config)
  }

  async function loadFile(filepath: string): Promise<Info> {
    const text = await ConfigPaths.readFile(filepath)
    if (!text) return {}
    return load(text, filepath).catch((error) => {
      log.warn("failed to load tui config", { path: filepath, error })
      return {}
    })
  }

  async function load(text: string, configFilepath: string): Promise<Info> {
    const raw = await ConfigPaths.parseText(text, configFilepath, "empty")
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}

    // Flatten a nested "tui" key so users who wrote `{ "tui": { ... } }` inside tui.json
    // (mirroring the old symbolic.json shape) still get their settings applied.
    const normalized = (() => {
      const copy = { ...(raw as Record<string, unknown>) }
      if (!("tui" in copy)) return copy
      if (!copy.tui || typeof copy.tui !== "object" || Array.isArray(copy.tui)) {
        delete copy.tui
        return copy
      }
      const tui = copy.tui as Record<string, unknown>
      delete copy.tui
      return {
        ...tui,
        ...copy,
      }
    })()

    const parsed = Info.safeParse(normalized)
    if (!parsed.success) {
      log.warn("invalid tui config", { path: configFilepath, issues: parsed.error.issues })
      return {}
    }

    const data = parsed.data
    if (data.plugin) {
      for (let i = 0; i < data.plugin.length; i++) {
        const item = data.plugin[i]
        const spec = Config.pluginSpec(item)
        try {
          const resolved = import.meta.resolve!(spec, configFilepath)
          data.plugin[i] = typeof item === "string" ? resolved : [resolved, item[1]]
        } catch {
          try {
            const require = createRequire(configFilepath)
            const resolved = pathToFileURL(require.resolve(spec)).href
            data.plugin[i] = typeof item === "string" ? resolved : [resolved, item[1]]
          } catch {
            const raw = spec.startsWith("file://") ? spec : pathToFileURL(path.resolve(path.dirname(configFilepath), spec)).href
            if (spec.startsWith(".") || path.isAbsolute(spec) || /^[A-Za-z]:[\\/]/.test(spec)) {
              data.plugin[i] = typeof item === "string" ? raw : [raw, item[1]]
            }
          }
        }
      }
    }

    return data
  }
}
