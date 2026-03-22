import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useSidebar, Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuAction, SidebarMenuButton, SidebarMenuItem, SidebarSeparator } from "@/components/ui/sidebar";

import { symbolic } from "../shared/launch";
import type { App } from "./use-term";
import { glyph } from "./app-icon";
import { Gear, Plus, Term, Turn, X } from "./term-data";
import { label, line, parts, leaf } from "./term-util";
import { spot } from "./term-style";

export function AppSide(props: { ctx: App }) {
  const ctx = props.ctx;
  return (
    <Sidebar className="border-r border-sidebar-border/80 [&_[data-sidebar=sidebar]]:backdrop-blur-[24px]" collapsible="offcanvas">
      <SidebarHeader className={ctx.mac ? "app-drag select-none gap-3 px-3 pt-14 pb-3" : "app-drag select-none gap-3 p-3"}>
        <div className="grid gap-1.5 px-1">
          <span className="text-[10px] font-semibold tracking-[0.22em] text-sidebar-foreground/55 uppercase">Symbolic</span>
        </div>
      </SidebarHeader>
      <SidebarSeparator />
      <SidebarContent className="overflow-hidden pb-3">
        <Tabs ctx={ctx} />
        {ctx.recent.length ? (
          <SidebarGroup>
            <SidebarGroupLabel>Recent</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {ctx.recent.map((item) => {
                  const Icon = glyph(item.launch);
                  return (
                    <SidebarMenuItem key={item.cwd}>
                      <SidebarMenuButton onClick={() => void ctx.choose(item)} title={`${item.cwd} · ${item.launch.name}`}>
                        <Icon className="size-3.5" />
                        <span>{leaf(item.cwd)}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
        <SidebarGroup className="mt-auto pb-1">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={() => ctx.setPanel("prefs")}>
                  <Gear />
                  <span>Settings</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <Foot ctx={ctx} />
    </Sidebar>
  );
}

function Tabs(props: { ctx: App }) {
  const ctx = props.ctx;
  const ref = useRef<HTMLDivElement | null>(null);
  const [fade, setFade] = useState({ bot: false, top: false });
  const built = ctx.apps.filter((item) => item.built);
  const custom = ctx.apps.filter((item) => !item.built);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => setFade(mark(el));
    sync();
    const obs = new ResizeObserver(sync);
    obs.observe(el);
    const child = el.firstElementChild;
    if (child instanceof HTMLElement) obs.observe(child);
    return () => obs.disconnect();
  }, [ctx.list.length]);

  return (
    <SidebarGroup className="min-h-0 flex-1 pb-0">
      <SidebarGroupLabel>Tabs</SidebarGroupLabel>
      <div className="absolute top-3 right-3 flex items-center overflow-hidden rounded-md border border-sidebar-border/80 bg-sidebar-accent/45">
        <button
          aria-label="New Symbolic tab"
          className="flex h-5 w-5 items-center justify-center text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          onClick={() => void ctx.add(symbolic)}
          title="New Symbolic tab"
          type="button"
        >
          <Plus />
        </button>
        <DropdownMenu onOpenChange={(open) => { if (open) void ctx.loadApps(); }}>
          <DropdownMenuTrigger
            aria-label="Tab apps"
            className="flex h-5 w-5 items-center justify-center border-l border-sidebar-border/80 text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            title="Tab apps"
          >
            <ChevronDown className="size-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 rounded-xl border border-[var(--field-line)] bg-[var(--panel-bg)] p-1.5 text-[var(--app-text)] shadow-[0_18px_40px_rgba(14,18,24,0.18)] backdrop-blur-[24px]" sideOffset={6}>
            {built.map((item) => (
              <DropdownMenuItem disabled={!item.ok} key={item.id} onClick={() => void ctx.add(item)}>
                <span>{item.name}</span>
                {!item.ok ? <DropdownMenuShortcut>Missing</DropdownMenuShortcut> : null}
              </DropdownMenuItem>
            ))}
            {custom.length ? (
              <>
                <DropdownMenuSeparator className="bg-[var(--field-line)]" />
                {custom.map((item) => (
                  <DropdownMenuItem key={item.id} onClick={() => void ctx.add(item)}>
                    <span>{item.name}</span>
                  </DropdownMenuItem>
                ))}
              </>
            ) : null}
            <DropdownMenuSeparator className="bg-[var(--field-line)]" />
            <DropdownMenuItem onClick={() => ctx.setPanel("prefs")}>
              <span>Customize</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <SidebarGroupContent className="min-h-0 flex-1">
        <div className="relative h-full min-h-0">
          <div className={`pointer-events-none absolute inset-x-0 top-0 z-10 h-4 bg-[linear-gradient(180deg,var(--sidebar)_12%,transparent)] transition-opacity duration-150 ease-linear ${fade.top ? "opacity-100" : "opacity-0"}`} />
          <div className={`pointer-events-none absolute inset-x-0 bottom-0 z-10 h-4 bg-[linear-gradient(0deg,var(--sidebar)_12%,transparent)] transition-opacity duration-150 ease-linear ${fade.bot ? "opacity-100" : "opacity-0"}`} />
          <div className="no-scrollbar h-full overflow-y-auto px-2 pb-2" onScroll={(event) => setFade(mark(event.currentTarget))} ref={ref}>
            <SidebarMenu className="gap-1">
              {ctx.list.length ? ctx.list.map((session) => {
                const cwd = parts(session.cwd);
                const Icon = glyph(session.launch);
                return (
                  <SidebarMenuItem key={session.id}>
                    <SidebarMenuButton className="h-auto min-h-10 items-start py-2 pr-14" isActive={session.id === ctx.now?.id} onClick={() => void ctx.focus(session.id)} title={`${session.launch.name} · ${session.cwd}`}>
                      <Icon className="size-3.5" />
                      <span className="grid min-w-0 gap-0.5">
                        <span className='flex min-w-0 max-w-full items-baseline font-["SF_Mono","JetBrains_Mono",Menlo,monospace] text-[12px] leading-5'>
                          <span className="truncate">{cwd.lead}</span>
                          <span className="shrink-0">{cwd.tail}</span>
                        </span>
                        <span className="text-[11px] text-sidebar-foreground/58">{line(session)}</span>
                      </span>
                    </SidebarMenuButton>
                    <SidebarMenuAction aria-label={`Restart ${label(session)}`} className="right-6 z-10 text-sidebar-foreground/42 hover:bg-sidebar-accent/55 hover:text-sidebar-foreground/70" onClick={(event) => { event.preventDefault(); event.stopPropagation(); void ctx.restart(session.id); }} onKeyDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} showOnHover title="Restart tab" type="button">
                      <Turn className="size-3" />
                    </SidebarMenuAction>
                    <SidebarMenuAction aria-label={`Close ${label(session)}`} className="z-10 text-sidebar-foreground/42 hover:bg-sidebar-accent/55 hover:text-sidebar-foreground/70" onClick={(event) => { event.preventDefault(); event.stopPropagation(); void ctx.remove(session.id); }} onKeyDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} showOnHover title="Close tab" type="button">
                      <X className="size-3" />
                    </SidebarMenuAction>
                  </SidebarMenuItem>
                );
              }) : (
                <SidebarMenuItem>
                  <SidebarMenuButton disabled>
                    <Term className="size-3.5" />
                    <span>No tabs yet</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </div>
        </div>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function mark(el: HTMLDivElement) {
  const max = el.scrollHeight - el.clientHeight;
  if (max <= 1) return { bot: false, top: false };
  return {
    bot: el.scrollTop < max - 1,
    top: el.scrollTop > 1,
  };
}

function Foot(props: { ctx: App }) {
  const ctx = props.ctx;
  const sidebar = useSidebar();
  const open = sidebar.open || sidebar.openMobile;
  if (!open || ctx.prefs.status_open !== "sidebar") return null;
  return (
    <SidebarFooter className="gap-1 p-3 pt-0">
      <div className="grid gap-1.5 rounded-xl border border-sidebar-border/80 bg-sidebar-accent/70 px-3 py-2.5 text-xs leading-5 text-sidebar-foreground/76">
        <span className="text-[10px] font-semibold tracking-[0.18em] text-sidebar-foreground/52 uppercase">Status</span>
        <div className="group flex items-center gap-2" data-state={ctx.proc.state}>
          <span className={spot} />
          <span>{ctx.proc.text}</span>
        </div>
        {ctx.hostText ? <div>{ctx.hostText}</div> : null}
      </div>
    </SidebarFooter>
  );
}
