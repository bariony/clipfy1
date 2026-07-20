import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  FolderKanban,
  Plus,
  Settings,
  Sparkles,
  Wallet,
  Bell,
  Clapperboard,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

const primary = [
  { title: "Dashboard", url: "/app/dashboard", icon: LayoutDashboard },
  { title: "Projects", url: "/app/projects", icon: FolderKanban },
  { title: "New Project", url: "/app/new", icon: Plus, highlight: true },
];

const secondary = [
  { title: "AI Suggestions", url: "/app/dashboard", icon: Sparkles },
  { title: "Credits", url: "/app/dashboard", icon: Wallet },
  { title: "Notifications", url: "/app/dashboard", icon: Bell },
  { title: "Settings", url: "/app/dashboard", icon: Settings },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isActive = (url: string) => pathname === url || pathname.startsWith(url + "/");

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border">
        <Link to="/app/dashboard" className="flex items-center gap-2 px-2 py-1">
          <div className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
            <Clapperboard className="size-4" strokeWidth={2.5} />
          </div>
          {!collapsed && (
            <span className="text-base font-extrabold tracking-tighter">CLIPFY</span>
          )}
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          {!collapsed && (
            <SidebarGroupLabel className="font-mono text-[10px] uppercase tracking-widest">
              Workspace
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu>
              {primary.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive(item.url)}
                    className={cn(
                      item.highlight &&
                        !isActive(item.url) &&
                        "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
                    )}
                  >
                    <Link to={item.url} className="flex items-center gap-2">
                      <item.icon className="size-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          {!collapsed && (
            <SidebarGroupLabel className="font-mono text-[10px] uppercase tracking-widest">
              Account
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu>
              {secondary.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <Link to={item.url} className="flex items-center gap-2">
                      <item.icon className="size-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        {!collapsed ? (
          <div className="rounded-lg border border-sidebar-border bg-sidebar-accent/40 p-3">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-primary">
              Credits
            </div>
            <div className="mb-2 flex items-baseline gap-1">
              <span className="text-xl font-extrabold">1,240</span>
              <span className="font-mono text-[10px] text-muted-foreground">/ 1,500</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-sidebar-border">
              <div className="h-full w-4/5 bg-primary" />
            </div>
          </div>
        ) : (
          <div className="grid size-8 place-items-center rounded-md bg-sidebar-accent/40 font-mono text-[10px] text-primary">
            1.2k
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
