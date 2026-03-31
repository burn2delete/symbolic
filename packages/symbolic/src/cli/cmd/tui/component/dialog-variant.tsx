import { createMemo } from "solid-js"
import { useLocal } from "@tui/context/local"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"

export function DialogVariant() {
  const local = useLocal()
  const dialog = useDialog()

  const options = createMemo(() => [
    {
      value: "default",
      title: "Default",
      onSelect: () => {
        dialog.clear()
        local.model.variant.set(undefined)
      },
    },
    ...local.model.variant.list().map((variant) => ({
      value: variant,
      title: variant,
      onSelect: () => {
        dialog.clear()
        local.model.variant.set(variant)
      },
    })),
  ])

  return (
    <DialogSelect<string>
      title="Select variant"
      options={options()}
      current={local.model.variant.current() ?? "default"}
      flat={true}
    />
  )
}
