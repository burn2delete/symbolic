import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import type { App } from "./use-term";
import { Desk, Moon, Sun } from "./term-data";
import { chrome } from "./term-style";

export function AppTop(props: { ctx: App }) {
  const ctx = props.ctx;
  const left = ctx.frame.full ? "18px" : ctx.side ? "18px" : "84px";
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-[52px] max-[720px]:h-12">
      {ctx.mac ? (
        <div
          aria-hidden="true"
          className="app-drag absolute top-0 h-[52px] max-[720px]:h-12"
          style={{
            left: ctx.frame.full ? "64px" : ctx.side ? "64px" : "128px",
            right: "56px",
          }}
        />
      ) : null}
      {ctx.mac ? (
        <div
          className="app-no-drag pointer-events-auto absolute top-2.5 z-10 transition-[left] duration-200 ease-linear max-[720px]:top-2"
          style={{ left }}
        >
          <SidebarTrigger aria-label="Toggle sidebar" className={`app-no-drag pointer-events-auto size-8 ${chrome}`} />
        </div>
      ) : null}
      <div className="pointer-events-none absolute inset-x-14 top-0 z-0 flex h-[52px] items-center justify-center px-6 max-[720px]:inset-x-12 max-[720px]:h-12">
        <span className={`truncate text-[12px] font-medium tracking-[0.18em] text-[var(--muted)] uppercase transition-opacity duration-200 ease-linear ${ctx.side ? "opacity-0" : "opacity-100"}`}>
          Symbolic Terminal
        </span>
      </div>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              className={`app-no-drag pointer-events-auto absolute top-2.5 right-2.5 z-10 ${chrome} max-[720px]:top-2 max-[720px]:right-2`}
              onClick={ctx.flip}
              size="icon"
              type="button"
              variant="ghost"
            >
              {ctx.prefs.theme === "system" ? <Desk /> : ctx.prefs.theme === "light" ? <Sun /> : <Moon />}
              <span className="sr-only">Toggle theme</span>
            </Button>
          }
        />
        <TooltipContent align="end" side="left" sideOffset={8}>
          {ctx.prefs.theme === "system" ? "Theme: System" : ctx.prefs.theme === "light" ? "Theme: Light" : "Theme: Dark"}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
