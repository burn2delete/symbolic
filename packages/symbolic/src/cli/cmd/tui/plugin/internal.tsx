import type { TuiPluginModule } from "@symbolic-agent/plugin/tui"
import HomeFooter from "../feature-plugins/home/footer"
import HomeTips from "../feature-plugins/home/tips"
import SidebarContext from "../feature-plugins/sidebar/context"
import SidebarFiles from "../feature-plugins/sidebar/files"
import SidebarFooter from "../feature-plugins/sidebar/footer"
import SidebarLsp from "../feature-plugins/sidebar/lsp"
import SidebarMcp from "../feature-plugins/sidebar/mcp"
import SidebarTodo from "../feature-plugins/sidebar/todo"
import PluginManager from "../feature-plugins/system/plugins"

export function internalPlugins(): Array<TuiPluginModule & { id: string }> {
  return [HomeFooter, HomeTips, SidebarContext, SidebarMcp, SidebarLsp, SidebarTodo, SidebarFiles, SidebarFooter, PluginManager]
}
