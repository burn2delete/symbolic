import type {
  Config,
  SymbolicClient,
  Path,
  PermissionRequest,
  Project,
  ProviderAuthResponse,
  ProviderListResponse,
  QuestionRequest,
  Todo,
} from "@symbolic-agent/sdk/v2/client"
import { showToast } from "@symbolic-agent/ui/toast"
import { getFilename } from "@symbolic-agent/util/path"
import { retry } from "@symbolic-agent/util/retry"
import { batch } from "solid-js"
import { reconcile, type SetStoreFunction, type Store } from "solid-js/store"
import type { State, VcsCache, VcsInfo } from "./types"
import { cmp, normalizeAgentList, normalizeProviderList } from "./utils"
import { formatServerError } from "@/utils/server-errors"

type GlobalStore = {
  ready: boolean
  path: Path
  project: Project[]
  session_todo: {
    [sessionID: string]: Todo[]
  }
  provider: ProviderListResponse
  provider_auth: ProviderAuthResponse
  config: Config
  reload: undefined | "pending" | "complete"
}

export async function bootstrapGlobal(input: {
  globalSDK: SymbolicClient
  connectErrorTitle: string
  connectErrorDescription: string
  requestFailedTitle: string
  translate: (key: string, vars?: Record<string, string | number>) => string
  formatMoreCount: (count: number) => string
  setGlobalStore: SetStoreFunction<GlobalStore>
}) {
  const paint = () =>
    new Promise<void>((resolve) => {
      let done = false
      const end = () => {
        if (done) return
        done = true
        resolve()
      }
      const timer = setTimeout(end, 50)
      if (typeof requestAnimationFrame !== "function") return
      requestAnimationFrame(() => {
        clearTimeout(timer)
        end()
      })
    })

  const errs = (list: PromiseSettledResult<unknown>[]) =>
    list.filter((item): item is PromiseRejectedResult => item.status === "rejected").map((item) => item.reason)

  const runAll = (list: Array<() => Promise<unknown>>) => Promise.allSettled(list.map((item) => item()))

  const showErrs = (input: {
    errs: unknown[]
    title: string
    translate: (key: string, vars?: Record<string, string | number>) => string
    formatMoreCount: (count: number) => string
  }) => {
    if (input.errs.length === 0) return
    const message = formatServerError(input.errs[0], input.translate)
    const more = input.errs.length > 1 ? input.formatMoreCount(input.errs.length - 1) : ""
    showToast({
      variant: "error",
      title: input.title,
      description: message + more,
    })
  }

  const health = await input.globalSDK.global
    .health()
    .then((x) => x.data)
    .catch(() => undefined)
  if (!health?.healthy) {
    showToast({
      variant: "error",
      title: input.connectErrorTitle,
      description: input.connectErrorDescription,
    })
    input.setGlobalStore("ready", true)
    return
  }

  const fast = [
    () =>
      retry(() =>
        input.globalSDK.path.get().then((x) => {
          input.setGlobalStore("path", x.data!)
        }),
      ),
    () =>
      retry(() =>
        input.globalSDK.global.config.get().then((x) => {
          input.setGlobalStore("config", x.data!)
        }),
      ),
    () =>
      retry(() =>
        input.globalSDK.provider.list().then((x) => {
          input.setGlobalStore("provider", normalizeProviderList(x.data!))
        }),
      ),
    () =>
      retry(() =>
        input.globalSDK.provider.auth().then((x) => {
          input.setGlobalStore("provider_auth", x.data ?? {})
        }),
      ),
  ]

  const slow = [
    () =>
      retry(() =>
        input.globalSDK.project.list().then((x) => {
          const projects = (x.data ?? [])
            .filter((p) => !!p?.id)
            .filter((p) => !!p.worktree && !p.worktree.includes("symbolic-test"))
            .slice()
            .sort((a, b) => cmp(a.id, b.id))
          input.setGlobalStore("project", projects)
        }),
      ),
  ]

  showErrs({ errs: errs(await runAll(fast)), title: input.requestFailedTitle, translate: input.translate, formatMoreCount: input.formatMoreCount })
  await paint()
  showErrs({ errs: errs(await runAll(slow)), title: input.requestFailedTitle, translate: input.translate, formatMoreCount: input.formatMoreCount })
  input.setGlobalStore("ready", true)
}

function groupBySession<T extends { id: string; sessionID: string }>(input: T[]) {
  return input.reduce<Record<string, T[]>>((acc, item) => {
    if (!item?.id || !item.sessionID) return acc
    const list = acc[item.sessionID]
    if (list) list.push(item)
    if (!list) acc[item.sessionID] = [item]
    return acc
  }, {})
}

export async function bootstrapDirectory(input: {
  directory: string
  sdk: SymbolicClient
  store: Store<State>
  setStore: SetStoreFunction<State>
  vcsCache: VcsCache
  loadSessions: (directory: string) => Promise<void> | void
  translate: (key: string, vars?: Record<string, string | number>) => string
}) {
  if (input.store.status !== "complete") input.setStore("status", "loading")

  const blockingRequests = {
    project: () => input.sdk.project.current().then((x) => input.setStore("project", x.data!.id)),
    provider: () =>
      input.sdk.provider.list().then((x) => {
        input.setStore("provider", normalizeProviderList(x.data!))
      }),
    agent: () => input.sdk.app.agents().then((x) => input.setStore("agent", normalizeAgentList(x.data))),
    config: () => input.sdk.config.get().then((x) => input.setStore("config", x.data!)),
  }

  try {
    await Promise.all(Object.values(blockingRequests).map((p) => retry(p)))
  } catch (err) {
    console.error("Failed to bootstrap instance", err)
    const project = getFilename(input.directory)
    showToast({
      variant: "error",
      title: input.translate("toast.project.reloadFailed.title", { project }),
      description: formatServerError(err, input.translate),
    })
    input.setStore("status", "partial")
    return
  }

  if (input.store.status !== "complete") input.setStore("status", "partial")

  Promise.all([
    input.sdk.path.get().then((x) => input.setStore("path", x.data!)),
    input.sdk.command.list().then((x) => input.setStore("command", x.data ?? [])),
    input.sdk.session.status().then((x) => input.setStore("session_status", x.data!)),
    input.loadSessions(input.directory),
    input.sdk.mcp.status().then((x) => input.setStore("mcp", x.data!)),
    input.sdk.lsp.status().then((x) => input.setStore("lsp", x.data!)),
    input.sdk.vcs.get().then((x) => {
      const next = (x.data ? ({ ...x.data, dirty: x.data.dirty ?? false } as VcsInfo) : input.store.vcs) ?? input.store.vcs
      input.setStore("vcs", next)
      if (next) input.vcsCache.setStore("value", next)
    }),
    input.sdk.permission.list().then((x) => {
      const grouped = groupBySession(
        (x.data ?? []).filter((perm): perm is PermissionRequest => !!perm?.id && !!perm.sessionID),
      )
      batch(() => {
        for (const sessionID of Object.keys(input.store.permission)) {
          if (grouped[sessionID]) continue
          input.setStore("permission", sessionID, [])
        }
        for (const [sessionID, permissions] of Object.entries(grouped)) {
          input.setStore(
            "permission",
            sessionID,
            reconcile(
              permissions.filter((p) => !!p?.id).sort((a, b) => cmp(a.id, b.id)),
              { key: "id" },
            ),
          )
        }
      })
    }),
    input.sdk.question.list().then((x) => {
      const grouped = groupBySession((x.data ?? []).filter((q): q is QuestionRequest => !!q?.id && !!q.sessionID))
      batch(() => {
        for (const sessionID of Object.keys(input.store.question)) {
          if (grouped[sessionID]) continue
          input.setStore("question", sessionID, [])
        }
        for (const [sessionID, questions] of Object.entries(grouped)) {
          input.setStore(
            "question",
            sessionID,
            reconcile(
              questions.filter((q) => !!q?.id).sort((a, b) => cmp(a.id, b.id)),
              { key: "id" },
            ),
          )
        }
      })
    }),
  ]).then(() => {
    input.setStore("status", "complete")
  })
}
