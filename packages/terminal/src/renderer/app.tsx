import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

import { AppPanels } from "./app-panels";
import { AppSide } from "./app-sidebar";
import { AppTerm } from "./app-terminal";
import { AppTop } from "./app-topbar";
import { useTerm } from "./use-term";

export function App() {
  const ctx = useTerm();
  return (
    <SidebarProvider
      className="relative h-full min-h-0 overflow-hidden"
      onOpenChange={ctx.setSide}
      open={ctx.side}
    >
      <AppSide ctx={ctx} />
      <SidebarInset className="min-h-0 bg-transparent shadow-none md:m-0 md:rounded-none">
        <AppTop ctx={ctx} />
        <AppTerm ctx={ctx} />
        <AppPanels ctx={ctx} />
      </SidebarInset>
    </SidebarProvider>
  );
}
