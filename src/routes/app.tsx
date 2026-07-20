import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import { Bell, Plus, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/app")({
  component: AppLayout,
});

function AppLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const crumb = pathname.replace(/^\/app\/?/, "") || "dashboard";

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar />
        <div className="flex flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-md">
            <SidebarTrigger />
            <div className="hidden font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground md:block">
              // {crumb}
            </div>

            <div className="ml-auto flex items-center gap-2">
              <div className="relative hidden md:block">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search projects"
                  className="w-64 border-border bg-secondary/60 pl-8"
                />
              </div>
              <Button variant="ghost" size="icon" aria-label="Notifications">
                <Bell className="size-4" />
              </Button>
              <Button asChild size="sm" className="rounded-lg font-bold">
                <Link to="/app/new">
                  <Plus className="mr-1 size-4" />
                  New Project
                </Link>
              </Button>
            </div>
          </header>

          <main className="flex-1">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
