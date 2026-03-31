import path from "path"
import type { Tool } from "./tool"
import { Instance } from "../project/instance"
import { Filesystem } from "@/util/filesystem"

type Kind = "file" | "directory"

type Options = {
  bypass?: boolean
  kind?: Kind
}

export async function assertExternalDirectory(ctx: Tool.Context, target?: string, options?: Options) {
  if (!target) return

  if (options?.bypass) return

  const full = process.platform === "win32" ? Filesystem.normalizePath(target) : target
  if (Instance.containsPath(full)) return

  const kind = options?.kind ?? "file"
  const parentDir = kind === "directory" ? full : path.dirname(full)
  const glob =
    process.platform === "win32"
      ? Filesystem.normalizePathPattern(path.join(parentDir, "*"))
      : path.join(parentDir, "*").replaceAll("\\", "/")

  await ctx.ask({
    permission: "external_directory",
    patterns: [glob],
    always: [glob],
    metadata: {
      filepath: full,
      parentDir,
    },
  })
}
