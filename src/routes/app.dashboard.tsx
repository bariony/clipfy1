import { createFileRoute, Link } from "@tanstack/react-router";
import {
  FolderKanban,
  Plus,
  Sparkles,
  TrendingUp,
  Video,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/status-pill";
import type { ProjectStatus } from "@/lib/project-status";
import { useSuspenseQuery } from "@tanstack/react-query";
import {
  dashboardStatsQueryOptions,
  profileQueryOptions,
  projectsQueryOptions,
  formatDuration,
  timeAgo,
} from "@/lib/projects";

export const Route = createFileRoute("/app/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Clipfy" }] }),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(projectsQueryOptions()),
      context.queryClient.ensureQueryData(profileQueryOptions()),
      context.queryClient.ensureQueryData(dashboardStatsQueryOptions()),
    ]),
  component: Dashboard,
  errorComponent: ({ error }) => (
    <div className="p-8 text-sm text-destructive">Failed to load dashboard: {error.message}</div>
  ),
});

function Dashboard() {
  const { data: projects } = useSuspenseQuery(projectsQueryOptions());
  const { data: profile } = useSuspenseQuery(profileQueryOptions());
  const { data: stats } = useSuspenseQuery(dashboardStatsQueryOptions());

  const recent = projects.slice(0, 6);
  const credits = profile?.credits ?? 0;

  const cards = [
    { label: "Projects", value: stats.totalProjects.toString(), hint: `${stats.active} active`, icon: FolderKanban },
    { label: "Clips generated", value: stats.totalClips.toString(), hint: "across all projects", icon: Video },
    { label: "Credits", value: credits.toLocaleString(), hint: "current balance", icon: Wallet },
    { label: "Avg. viral score", value: stats.avgVirality ? `${stats.avgVirality}%` : "—", hint: "clip average", icon: TrendingUp },
  ];

  return (
    <div className="px-6 py-8">
      <div className="mb-8 flex items-end justify-between">
        <div>
          <div className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-primary">
            // Overview
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight">Good to see you back</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Here's what's happening across your workspace.
          </p>
        </div>
        <Button asChild size="lg" className="rounded-xl font-extrabold">
          <Link to="/app/new">
            <Plus className="mr-2 size-4" />
            New Project
          </Link>
        </Button>
      </div>

      <div className="mb-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {cards.map((s) => (
          <div key={s.label} className="rounded-2xl border border-border bg-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {s.label}
              </div>
              <s.icon className="size-4 text-primary" />
            </div>
            <div className="text-3xl font-extrabold tracking-tight">{s.value}</div>
            <div className="mt-1 font-mono text-[11px] text-muted-foreground">{s.hint}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold">Recent projects</h2>
            <Link
              to="/app/projects"
              className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-primary"
            >
              View all →
            </Link>
          </div>
          {recent.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card/40 p-10 text-center">
              <div className="mb-2 text-sm font-semibold">No projects yet</div>
              <p className="mb-4 text-xs text-muted-foreground">
                Create your first project to start generating clips.
              </p>
              <Button asChild size="sm" className="rounded-lg font-bold">
                <Link to="/app/new">
                  <Plus className="mr-1 size-4" /> New Project
                </Link>
              </Button>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-border bg-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    <th className="px-4 py-3 text-left font-medium">Project</th>
                    <th className="px-4 py-3 text-left font-medium">Status</th>
                    <th className="px-4 py-3 text-left font-medium">Duration</th>
                    <th className="px-4 py-3 text-left font-medium">Target</th>
                    <th className="px-4 py-3 text-right font-medium">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((p) => (
                    <tr key={p.id} className="border-b border-border/60 last:border-0 hover:bg-secondary/40">
                      <td className="px-4 py-3">
                        <Link to="/app/projects/$id" params={{ id: p.id }} className="font-medium hover:text-primary">
                          {p.title}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill status={p.status as ProjectStatus} />
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {formatDuration(p.duration_seconds)}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{p.target_clip_count ?? 0}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">
                        {timeAgo(p.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="mb-4 flex items-center justify-between">
              <div className="font-mono text-[10px] uppercase tracking-widest text-primary">
                Credits
              </div>
              <Wallet className="size-4 text-primary" />
            </div>
            <div className="text-4xl font-extrabold tracking-tight">
              {credits.toLocaleString()}
            </div>
            <div className="mt-1 font-mono text-[11px] text-muted-foreground">
              available balance
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="mb-3 flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              <div className="font-mono text-[10px] uppercase tracking-widest text-primary">
                Tip
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Longer source videos generally produce more viral moments. Aim for 20–90 min sources for the best hit rate.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
