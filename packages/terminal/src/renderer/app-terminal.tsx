import { memo } from "react";

import { useSidebar } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import type { App } from "./use-term";
import { spot } from "./term-style";

export function AppTerm(props: { ctx: App }) {
  const ctx = props.ctx;
  return (
    <div
      className={
        ctx.mac
          ? "relative grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-2.5 px-3 pb-3 pt-[52px] max-[720px]:px-2 max-[720px]:pb-2 max-[720px]:pt-12"
          : "relative grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-2.5 px-3 pb-3 pt-[52px] max-[720px]:px-2 max-[720px]:pb-2 max-[720px]:pt-12"
      }
    >
      <div
        className="app-no-drag min-h-0 h-full w-full min-w-0 overflow-hidden rounded-2xl border border-[rgba(24,32,34,0.1)] bg-[var(--term-surface)] p-2.5 shadow-[0_24px_60px_rgba(104,83,56,0.14)] data-[empty=true]:opacity-[0.18] [&_.xterm]:h-full [&_.xterm]:w-full [&_.xterm]:min-w-0 [&_.xterm-viewport]:!bg-transparent [&_.xterm-viewport::-webkit-scrollbar-track]:bg-transparent"
        data-host="terminal"
        data-empty={ctx.now ? "false" : "true"}
      >
        <TermHost mount={ctx.mount} />
      </div>
      <Dock ctx={ctx} />
      {ctx.now && ctx.load ? (
        <section
          className={
            ctx.mac
              ? "absolute inset-x-3 bottom-14 top-[52px] grid place-items-center content-center gap-3.5 rounded-2xl bg-[color-mix(in_srgb,var(--term-surface)_88%,transparent)] text-center text-[rgba(251,250,245,0.88)] backdrop-blur-[12px] max-[720px]:inset-x-2 max-[720px]:bottom-12 max-[720px]:top-12"
              : "absolute inset-x-3 bottom-14 top-[52px] grid place-items-center content-center gap-3.5 rounded-2xl bg-[color-mix(in_srgb,var(--term-surface)_88%,transparent)] text-center text-[rgba(251,250,245,0.88)] backdrop-blur-[12px] max-[720px]:inset-x-2 max-[720px]:bottom-12 max-[720px]:top-12"
          }
        >
          <div className="size-6 animate-spin rounded-full border-2 border-[rgba(255,255,255,0.18)] border-t-[rgba(255,255,255,0.82)]" />
          <p>Loading terminal...</p>
        </section>
      ) : null}
      {!ctx.now ? (
        <section
          className={
            ctx.mac
              ? "absolute inset-x-3 bottom-14 top-[52px] grid place-items-center content-center gap-3.5 rounded-2xl border border-dashed border-[var(--field-line)] bg-[var(--empty-bg)] p-6 text-center backdrop-blur-[12px] max-[720px]:inset-x-2 max-[720px]:bottom-12 max-[720px]:top-12"
              : "absolute inset-x-3 bottom-14 top-[52px] grid place-items-center content-center gap-3.5 rounded-2xl border border-dashed border-[var(--field-line)] bg-[var(--empty-bg)] p-6 text-center backdrop-blur-[12px] max-[720px]:inset-x-2 max-[720px]:bottom-12 max-[720px]:top-12"
          }
        >
          <p className="m-0">No session in this window yet.</p>
        </section>
      ) : null}
    </div>
  );
}

const TermHost = memo(function TermHost(props: {
  mount: (node: HTMLDivElement | null) => void;
}) {
  return <div className="h-full w-full min-w-0" ref={props.mount} />;
});

function Dock(props: { ctx: App }) {
  const ctx = props.ctx;
  const sidebar = useSidebar();
  const open = sidebar.open || sidebar.openMobile;
  const show = open ? ctx.prefs.status_open === "bottom" : ctx.prefs.status_closed;
  const cls = `group flex min-h-7 items-center gap-2 self-end justify-self-end px-0.5 text-[11px] font-medium text-[var(--muted)] transition-opacity duration-200 ease-linear max-[720px]:justify-self-start ${show ? "opacity-100" : "pointer-events-none opacity-0"}`;
  if (ctx.tip) {
    return (
      <Tooltip>
        <TooltipTrigger render={<div className={cls} data-state={ctx.proc.state} />}>
          <span className={spot} />
          <span>{ctx.proc.text}</span>
        </TooltipTrigger>
        <TooltipContent align="end" side="top" sideOffset={8}>
          <div className="grid gap-1.5 font-mono text-[11px] leading-4">
            {ctx.tip.map((item, idx) => (
              <span key={`${item}-${idx}`}>{item}</span>
            ))}
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }
  return (
    <div className={cls} data-state={ctx.proc.state}>
      <span className={spot} />
      <span>{ctx.proc.text}</span>
    </div>
  );
}
