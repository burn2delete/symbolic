import { useEffect } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";

import type { App } from "./use-term";
import { AppCustoms } from "./app-customs";
import { colors, shell, skins, tone } from "./term-data";

export function AppPanels(props: { ctx: App }) {
  const ctx = props.ctx;

  useEffect(() => {
    if (ctx.panel !== "prefs") return;
    void ctx.loadCustoms();
  }, [ctx.loadCustoms, ctx.panel]);

  return (
    <>
      {ctx.panel === "prefs" ? (
        <Dialog open onOpenChange={(open) => { if (!open) ctx.setPanel(null); }}>
          <DialogContent className="max-w-[min(440px,calc(100%-20px))] gap-4 rounded-[18px] border border-[var(--field-line)] bg-[var(--panel-bg)] p-4 text-[var(--app-text)] shadow-[0_24px_60px_rgba(14,18,24,0.18)] backdrop-blur-[24px]">
            <DialogHeader className="gap-1 pr-8">
              <DialogTitle>Settings</DialogTitle>
              <DialogDescription className="text-[13px] text-[var(--muted)]">Defaults and appearance.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3.5">
              <label className="flex flex-col items-stretch gap-2.5">
                <span className="text-[13px] font-semibold">Start in</span>
                <select className="min-h-10 rounded-xl border border-[var(--field-line)] bg-[var(--field-bg)] px-3 text-[12px] text-inherit" onChange={(event) => void ctx.save({ cwd_mode: event.currentTarget.value as App["prefs"]["cwd_mode"] })} value={ctx.prefs.cwd_mode}>
                  <option value="recent">Recent</option>
                  <option value="home">Home</option>
                </select>
              </label>

              <div className="grid gap-2.5">
                <span className="text-[13px] font-semibold">Color</span>
                <div className="grid gap-2">
                  {colors.map((item) => (
                    <button className={`grid w-full gap-1.5 rounded-xl border px-3 py-2 text-left text-inherit transition duration-150 ease-out ${ctx.prefs.color === item.id ? "border-sidebar-primary bg-[var(--field-bg)] shadow-[0_0_0_1px_var(--sidebar-primary)]" : "border-[var(--field-line)] bg-[var(--field-bg)] hover:-translate-y-px"}`} key={item.id} onClick={() => ctx.setColor(item.id)} type="button">
                      <span className="text-[12px] font-semibold">{item.label}</span>
                      <span className="text-[11px] text-[var(--muted)]">{item.id === "symbolic" && ctx.tui ? `${item.note} · ${ctx.tui.name}` : item.note}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-2.5">
                <span className="text-[13px] font-semibold">Material</span>
                <span className="text-[11px] text-[var(--muted)]">Controls translucency and weight.</span>
                <div className="grid gap-2">
                  {skins.map((item) => (
                    <button className={`grid w-full gap-2.5 rounded-xl border px-3 py-2 text-left text-inherit transition duration-150 ease-out ${ctx.prefs.skin === item.id ? "border-sidebar-primary bg-[var(--field-bg)] shadow-[0_0_0_1px_var(--sidebar-primary)]" : "border-[var(--field-line)] bg-[var(--field-bg)] hover:-translate-y-px"}`} key={item.id} onClick={() => ctx.setSkin(item.id)} type="button">
                      <span className="flex items-center justify-between gap-3">
                        <span className="grid gap-0.5">
                          <span className="text-[12px] font-semibold">{item.label}</span>
                          <span className="text-[11px] text-[var(--muted)]">{item.note}</span>
                        </span>
                        <span className="flex items-center gap-3">
                          <span className="grid gap-1">
                            <span className="text-[10px] tracking-[0.16em] text-[var(--muted)] uppercase">Light</span>
                            <span className="flex items-center gap-1.5">
                              <span className="size-3 rounded-full border border-black/8" style={{ background: shell.light[item.id].bg }} />
                              <span className="size-3 rounded-full border border-black/8" style={{ background: shell.light[item.id].panel }} />
                              <span className="size-3 rounded-full border border-black/8" style={{ background: tone.light[item.id].background }} />
                            </span>
                          </span>
                          <span className="grid gap-1">
                            <span className="text-[10px] tracking-[0.16em] text-[var(--muted)] uppercase">Dark</span>
                            <span className="flex items-center gap-1.5">
                              <span className="size-3 rounded-full border border-white/12" style={{ background: shell.dark[item.id].bg }} />
                              <span className="size-3 rounded-full border border-white/12" style={{ background: shell.dark[item.id].panel }} />
                              <span className="size-3 rounded-full border border-white/12" style={{ background: tone.dark[item.id].background }} />
                            </span>
                          </span>
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-3">
                <span className="text-[13px] font-semibold">Status</span>
                <label className="flex items-center justify-between gap-3 rounded-xl border border-[var(--field-line)] bg-[var(--field-bg)] px-3 py-2.5">
                  <span className="grid gap-0.5">
                    <span className="text-[12px] font-semibold">Show when closed</span>
                    <span className="text-[11px] text-[var(--muted)]">Keep the bottom status row visible.</span>
                  </span>
                  <Switch checked={ctx.prefs.status_closed} onCheckedChange={(checked) => void ctx.save({ status_closed: checked })} />
                </label>
                <label className="flex items-center justify-between gap-3 rounded-xl border border-[var(--field-line)] bg-[var(--field-bg)] px-3 py-2.5">
                  <span className="grid gap-0.5">
                    <span className="text-[12px] font-semibold">Pin to sidebar when open</span>
                    <span className="text-[11px] text-[var(--muted)]">Off keeps the status row at the bottom.</span>
                  </span>
                  <Switch checked={ctx.prefs.status_open === "sidebar"} onCheckedChange={(checked) => void ctx.save({ status_open: checked ? "sidebar" : "bottom" })} />
                </label>
              </div>

              <AppCustoms ctx={ctx} />
            </div>
          </DialogContent>
        </Dialog>
      ) : null}

      {ctx.panel === "diag" ? (
        <Dialog open onOpenChange={(open) => { if (!open) ctx.setPanel(null); }}>
          <DialogContent className="max-w-[min(520px,calc(100%-20px))] gap-4 rounded-[18px] border border-[var(--field-line)] bg-[var(--panel-bg)] p-4 text-[var(--app-text)] shadow-[0_24px_60px_rgba(14,18,24,0.18)] backdrop-blur-[24px]">
            <DialogHeader className="gap-1 pr-8">
              <DialogTitle>Diagnostics</DialogTitle>
              <DialogDescription className="text-[13px] text-[var(--muted)]">Quick launch details for debugging startup issues.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3.5">
              <div className="flex items-center justify-between gap-2.5">
                <span className="text-[var(--muted)]">Log file</span>
                <span className='font-["SF_Mono","JetBrains_Mono",Menlo,monospace] text-[12px]'>{ctx.diag?.path ?? "Not available"}</span>
              </div>
              <button className="w-fit rounded-xl bg-[var(--ghost-bg)] px-3 py-2 text-[var(--app-text)] transition duration-150 ease-out hover:-translate-y-px" onClick={() => void ctx.loadDiag()} type="button">
                Refresh
              </button>
              <pre className='m-0 max-h-[300px] min-h-[180px] overflow-auto rounded-[14px] bg-[#0f1114] p-3 font-["SF_Mono","JetBrains_Mono",Menlo,monospace] text-[12px] text-[#ece4d7] whitespace-pre-wrap break-words'>
                {ctx.diag?.tail ?? "No diagnostics loaded yet."}
              </pre>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
