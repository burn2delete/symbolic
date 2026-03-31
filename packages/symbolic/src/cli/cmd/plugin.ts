import { intro, log, outro, spinner } from "@clack/prompts"
import type { Argv } from "yargs"
import { Instance } from "../../project/instance"
import { installPlugin, patchPluginConfig, readPluginManifest } from "../../plugin/install"
import { Process } from "../../util/process"
import { UI } from "../ui"
import { cmd } from "./cmd"

function cause(err: unknown) {
  if (!err || typeof err !== "object") return
  if (!("cause" in err)) return
  return (err as { cause?: unknown }).cause
}

function msg(err: unknown) {
  return err instanceof Error ? err.message : String(err)
}

export const PluginCommand = cmd({
  command: "plugin <module>",
  aliases: ["plug"],
  describe: "install a plugin and update config",
  builder: (yargs: Argv) =>
    yargs
      .positional("module", {
        type: "string",
        describe: "npm plugin module name",
      })
      .option("global", {
        alias: ["g"],
        type: "boolean",
        default: false,
        describe: "write to global config",
      })
      .option("force", {
        alias: ["f"],
        type: "boolean",
        default: false,
        describe: "replace an existing plugin version",
      }),
  handler: async (args) => {
    const mod = String(args.module ?? "").trim()
    if (!mod) {
      UI.error("module is required")
      process.exitCode = 1
      return
    }

    UI.empty()
    intro(`Install plugin ${mod}`)
    let ok = true

    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const install = spinner()
        install.start("Installing plugin package...")
        const installed = await installPlugin(mod)
        if (!installed.ok) {
          install.stop("Install failed", 1)
          log.error(`Could not install "${mod}"`)
          const hit = cause(installed.error) ?? installed.error
          if (hit instanceof Process.RunFailedError) {
            const lines = hit.stderr
              .toString()
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter(Boolean)
            const detail = lines.find((line) => line.startsWith("error:"))?.replace(/^error:\s*/, "") ?? lines.at(-1)
            if (detail) log.error(detail)
          } else {
            log.error(msg(hit))
          }
          ok = false
          return
        }
        install.stop("Plugin package ready")

        const inspect = spinner()
        inspect.start("Reading plugin manifest...")
        const manifest = await readPluginManifest(installed.target)
        if (!manifest.ok) {
          inspect.stop("Manifest read failed", 1)
          if (manifest.code === "manifest_read_failed") {
            log.error(`Installed "${mod}" but failed to read ${manifest.file}`)
            log.error(msg(cause(manifest.error) ?? manifest.error))
          } else {
            log.error(`"${mod}" has an invalid oc-plugin manifest in ${manifest.file}`)
          }
          ok = false
          return
        }
        const targets = manifest.targets ?? [{ kind: "server" as const }]
        if (manifest.targets) {
          inspect.stop(`Detected ${targets.map((item) => item.kind).join(" + ")} target(s)`)
        } else {
          inspect.stop("No oc-plugin manifest; treating package as a server plugin")
        }

        const patch = spinner()
        patch.start("Updating plugin config...")
        for (const target of targets) {
          const item = target.opts ? ([mod, target.opts] as [string, Record<string, unknown>]) : mod
          const out = await patchPluginConfig({
            spec: mod,
            kind: target.kind,
            item,
            force: Boolean(args.force),
            global: Boolean(args.global),
            vcs: Instance.project.vcs,
            worktree: Instance.worktree,
            directory: Instance.directory,
          })
          if (!out.ok) {
            patch.stop("Failed updating plugin config", 1)
            if (out.code === "invalid_json") {
              log.error(`Invalid JSON in ${out.file} (${out.parse} at line ${out.line}, column ${out.col})`)
              log.info("Fix the config file and run the command again.")
            } else {
              log.error(msg(out.error))
            }
            ok = false
            return
          }

          if (out.mode === "noop") {
            log.info(`Already configured in ${out.file}`)
          } else if (out.mode === "replace") {
            log.info(`Replaced in ${out.file}`)
          } else {
            log.info(`Added to ${out.file}`)
          }
        }
        patch.stop("Plugin config updated")
        log.success(`Installed ${mod}`)
      },
    })

    outro("Done")
    if (!ok) process.exitCode = 1
  },
})
