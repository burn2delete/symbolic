import type { MiddlewareHandler } from "hono"
import { getAdaptor } from "@/control-plane/adaptors"
import { WorkspaceID } from "@/control-plane/schema"
import { Workspace } from "@/control-plane/workspace"
import { WorkspaceContext } from "@/control-plane/workspace-context"
import { Flag } from "@/flag/flag"
import { InstanceBootstrap } from "@/project/bootstrap"
import { Instance } from "@/project/instance"
import { Filesystem } from "@/util/filesystem"
import { lazy } from "@/util/lazy"
import { InstanceRoutes } from "./instance"

type Rule = { method?: string; path: string; exact?: boolean; action: "local" | "forward" }

const RULES: Array<Rule> = [
  { path: "/session/status", action: "forward" },
  { method: "GET", path: "/session", action: "local" },
]

function local(method: string, path: string) {
  for (const rule of RULES) {
    if (rule.method && rule.method !== method) continue
    const match = rule.exact ? path === rule.path : path === rule.path || path.startsWith(rule.path + "/")
    if (match) return rule.action === "local"
  }
  return false
}

const routes = lazy(() => InstanceRoutes())

function parseDir(raw: string) {
  try {
    return Filesystem.resolve(decodeURIComponent(raw))
  } catch {
    return Filesystem.resolve(raw)
  }
}

async function localFetch(c: Parameters<MiddlewareHandler>[0], directory: string, workspaceID?: WorkspaceID) {
  return WorkspaceContext.provide({
    workspaceID,
    async fn() {
      if (c.req.path === "/log") return routes().fetch(c.req.raw, c.env)
      return Instance.provide({
        directory,
        init: InstanceBootstrap,
        async fn() {
          return routes().fetch(c.req.raw, c.env)
        },
      })
    },
  })
}

export const WorkspaceRouterMiddleware: MiddlewareHandler = async (c) => {
  const directory = parseDir(c.req.query("directory") || c.req.header("x-symbolic-directory") || process.cwd())
  const raw = c.req.query("workspace") || c.req.header("x-symbolic-workspace") || WorkspaceContext.workspaceID
  const workspaceID = raw ? WorkspaceID.make(raw) : undefined
  if (!workspaceID || !Flag.SYMBOLIC_EXPERIMENTAL_WORKSPACES) {
    return localFetch(c, directory, workspaceID)
  }

  const url = new URL(c.req.url)
  const workspace = await Workspace.get(workspaceID)
  if (!workspace) {
    return new Response(`Workspace not found: ${workspaceID}`, {
      status: 500,
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    })
  }

  if (workspace.type === "worktree") {
    return localFetch(c, workspace.directory!, workspaceID)
  }

  if (local(c.req.method, url.pathname)) {
    return localFetch(c, directory, workspaceID)
  }

  const adaptor = await getAdaptor(workspace.type)
  const headers = new Headers(c.req.raw.headers)
  headers.delete("x-symbolic-workspace")

  return adaptor.fetch(workspace, `${url.pathname}${url.search}`, {
    method: c.req.method,
    body: c.req.method === "GET" || c.req.method === "HEAD" ? undefined : await c.req.raw.arrayBuffer(),
    signal: c.req.raw.signal,
    headers,
  })
}
