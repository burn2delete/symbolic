import { createMemo, createResource, Show, type ParentProps } from "solid-js"
import { useLocation, useNavigate, useParams } from "@solidjs/router"
import { SDKProvider } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { LocalProvider } from "@/context/local"
import { useGlobalSDK } from "@/context/global-sdk"

import { DataProvider } from "@symbolic-agent/ui/context"
import { base64Encode } from "@symbolic-agent/util/encode"
import { decode64 } from "@/utils/base64"
import { showToast } from "@symbolic-agent/ui/toast"
import { useLanguage } from "@/context/language"
function DirectoryDataProvider(props: ParentProps<{ directory: string }>) {
  const navigate = useNavigate()
  const sync = useSync()
  const slug = createMemo(() => base64Encode(props.directory))

  return (
    <DataProvider
      data={sync.data}
      directory={props.directory}
      onNavigateToSession={(sessionID: string) => navigate(`/${slug()}/session/${sessionID}`)}
      onSessionHref={(sessionID: string) => `/${slug()}/session/${sessionID}`}
    >
      <LocalProvider>{props.children}</LocalProvider>
    </DataProvider>
  )
}

export default function Layout(props: ParentProps) {
  const params = useParams()
  const location = useLocation()
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const navigate = useNavigate()
  let invalid = ""

  const [resolved] = createResource(
    () => {
      if (params.dir) return [location.pathname, params.dir] as const
    },
    async ([pathname, dir]) => {
      const raw = decode64(dir)
      if (!raw) {
        if (invalid === dir) return
        invalid = dir
        showToast({
          variant: "error",
          title: language.t("common.requestFailed"),
          description: language.t("directory.error.invalidUrl"),
        })
        navigate("/", { replace: true })
        return
      }

      return await globalSDK
        .createClient({
          directory: raw,
          throwOnError: true,
        })
        .path.get()
        .then((x) => {
          const next = x.data?.directory ?? raw
          invalid = ""
          if (next === raw) return next
          const path = pathname.slice(dir.length + 1)
          navigate(`/${base64Encode(next)}${path}${location.search}${location.hash}`, { replace: true })
          return next
        })
        .catch(() => {
          invalid = ""
          return raw
        })
    },
  )

  return (
    <Show when={resolved()} keyed>
      {(resolved) => (
        <SDKProvider directory={() => resolved}>
          <SyncProvider>
            <DirectoryDataProvider directory={resolved}>{props.children}</DirectoryDataProvider>
          </SyncProvider>
        </SDKProvider>
      )}
    </Show>
  )
}
