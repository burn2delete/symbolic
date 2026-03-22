import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import type { Custom } from "../shared/api";
import type { App } from "./use-term";
import { Plus, X } from "./term-data";

export function AppCustoms(props: { ctx: App }) {
  const ctx = props.ctx;
  const [list, setList] = useState<Custom[]>(ctx.customs);

  useEffect(() => {
    setList(ctx.customs);
  }, [ctx.customs]);

  return (
    <div className="grid gap-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="grid gap-0.5">
          <span className="text-[13px] font-semibold">Tab apps</span>
          <span className="text-[11px] text-[var(--muted)]">
            Add custom commands to the new tab menu.
          </span>
        </div>
        <Button
          className="h-8 rounded-lg px-2.5 text-[11px]"
          onClick={() =>
            setList((items) => [
              ...items,
              { id: crypto.randomUUID(), name: "", cmd: "" },
            ])
          }
          size="sm"
          type="button"
          variant="ghost"
        >
          <Plus className="size-3.5" />
          Add
        </Button>
      </div>
      <div className="grid gap-2">
        {ctx.customsReady ? (
          list.length ? (
            list.map((item) => (
              <div
                className="grid gap-2 rounded-xl border border-[var(--field-line)] bg-[var(--field-bg)] p-2.5"
                key={item.id}
              >
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                  <Input
                    onChange={(event) =>
                      setList((items) =>
                        items.map((row) =>
                          row.id === item.id
                            ? { ...row, name: event.currentTarget.value }
                            : row,
                        ),
                      )
                    }
                    placeholder="Name"
                    value={item.name}
                  />
                  <Button
                    className="h-9 w-9 rounded-lg p-0 text-[var(--muted)]"
                    onClick={() =>
                      setList((items) => items.filter((row) => row.id !== item.id))
                    }
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
                <Input
                  onChange={(event) =>
                    setList((items) =>
                      items.map((row) =>
                        row.id === item.id
                          ? { ...row, cmd: event.currentTarget.value }
                          : row,
                      ),
                    )
                  }
                  placeholder="Command"
                  value={item.cmd}
                />
              </div>
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-[var(--field-line)] px-3 py-2 text-[11px] text-[var(--muted)]">
              No custom apps yet.
            </div>
          )
        ) : (
          <div className="rounded-xl border border-dashed border-[var(--field-line)] px-3 py-2 text-[11px] text-[var(--muted)]">
            Loading apps…
          </div>
        )}
      </div>
      <div className="flex justify-end">
        <Button
          className="rounded-lg px-3 text-[11px]"
          onClick={() => void ctx.saveCustoms(list)}
          type="button"
          variant="ghost"
        >
          Save apps
        </Button>
      </div>
    </div>
  );
}
