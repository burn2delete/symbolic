import { Component, For, Show } from "solid-js"
import { Icon } from "@symbolic-agent/ui/icon"
import { FileIcon } from "@symbolic-agent/ui/file-icon"
import type { ImageAttachmentPart } from "@/context/prompt"

type PromptImageAttachmentsProps = {
  attachments: ImageAttachmentPart[]
  onOpen: (attachment: ImageAttachmentPart) => void
  onRemove: (id: string) => void
  removeLabel: string
}

const imageClass =
  "size-16 rounded-md object-cover border border-border-base hover:border-border-strong-base transition-colors"
const removeClass =
  "absolute -top-1.5 -right-1.5 size-5 rounded-full bg-surface-raised-stronger-non-alpha border border-border-base flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-surface-raised-base-hover"
const nameClass = "absolute bottom-0 left-0 right-0 px-1 py-0.5 bg-black/50 rounded-b-md"
const fileClass =
  "min-w-0 w-[min(220px,100%)] h-16 px-2 rounded-md bg-surface-base flex items-center gap-2 border border-border-base hover:border-border-strong-base transition-colors"
const fileNameClass = "min-w-0 truncate text-12-regular text-text-base"

export const PromptImageAttachments: Component<PromptImageAttachmentsProps> = (props) => {
  return (
    <Show when={props.attachments.length > 0}>
      <div class="flex flex-wrap gap-2 px-3 pt-3">
        <For each={props.attachments}>
          {(attachment) => (
            <div class="relative group">
              <Show
                when={attachment.mime.startsWith("image/")}
                fallback={
                  <div class={fileClass}>
                    <FileIcon node={{ path: attachment.filename, type: "file" }} class="size-5 shrink-0" />
                    <span class={fileNameClass}>{attachment.filename}</span>
                  </div>
                }
              >
                <img
                  src={attachment.dataUrl}
                  alt={attachment.filename}
                  class={imageClass}
                  onClick={() => props.onOpen(attachment)}
                />
              </Show>
              <button
                type="button"
                onClick={() => props.onRemove(attachment.id)}
                class={removeClass}
                aria-label={props.removeLabel}
              >
                <Icon name="close" class="size-3 text-text-weak" />
              </button>
              <Show when={attachment.mime.startsWith("image/")}>
                <div class={nameClass}>
                  <span class="text-10-regular text-white truncate block">{attachment.filename}</span>
                </div>
              </Show>
            </div>
          )}
        </For>
      </div>
    </Show>
  )
}
