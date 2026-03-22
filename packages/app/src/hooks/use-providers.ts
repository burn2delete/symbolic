import { useGlobalSync } from "@/context/global-sync"
import { decode64 } from "@/utils/base64"
import type { ProviderListResponse } from "@symbolic/sdk/v2/client"
import { useParams } from "@solidjs/router"
import { createMemo } from "solid-js"

export const popularProviders = [
  "symbolic",
  "symbolic-go",
  "anthropic",
  "github-copilot",
  "openai",
  "google",
  "openrouter",
  "vercel",
]
const popularProviderSet = new Set(popularProviders)

export function useProviders() {
  const globalSync = useGlobalSync()
  const params = useParams()
  const dir = createMemo(() => decode64(params.dir) ?? "")
  const providers = (): ProviderListResponse => {
    if (dir()) {
      const [projectStore] = globalSync.child(dir())
      return projectStore.provider
    }
    return globalSync.data.provider
  }
  const paid = (item: ProviderListResponse["all"][number]) => {
    if (item.id !== "symbolic") return true
    return Object.values(item.models).some((model) => !!model.cost?.input)
  }
  return {
    all: () => providers().all,
    default: () => providers().default,
    popular: () => providers().all.filter((p) => popularProviderSet.has(p.id)),
    connected: () => {
      const connected = new Set(providers().connected)
      return providers().all.filter((p) => connected.has(p.id))
    },
    paid: () => {
      const connected = new Set(providers().connected)
      return providers().all.filter((p) => connected.has(p.id) && paid(p))
    },
  }
}
