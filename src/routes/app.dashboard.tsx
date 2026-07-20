import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Clock,
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

export const Route = createFileRoute("/app/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Clipfy" }] }),
  component: Dashboard,
});

const stats = [
  { label: "Projects", value: "12", hint: "3 active", icon: FolderKanban },
  { label: "Videos processed", value: "84", hint: "+6 this week", icon: Video },
  { label: "Credits", value: "1,240", hint: "of 1,500", icon: Wallet },
  { label: "Avg. viral score", value: "82%", hint: "+4% MoM", icon: TrendingUp },
];

const recent: Array<{
  id: string;
  name: string;
  status: ProjectStatus;
  duration: string;
  clips: number;
  when: string;
}> = [
  {
    id: "1",
    name: "Podcast E42 · Founder mode",
    status: "ready",
    duration: "58:12",
    clips: 12,
    when: "2h ago",
  },
  {
    id: "2",
    name: "Interview · Sarah Chen",
    status: "rendering",
    duration: "1:24:03",
    clips: 8,
    when: "Yesterday",
  },
  {
    id: "3",
    name: "VOD · Twitch stream 08.14",
    status: "analyzing",
    duration: "3:12:45",
    clips: 0,
    when: "3d ago",
  },
  {
    id: "4",
    name: "Keynote · Q3 launch",
    status: "completed",
    duration: "42:18",
    clips: 15,
    when: "Last week",
  },
];

function Dashboard() {
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

      {/* Stats */}
      <div className="mb-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-2xl border border-border bg-card p-5"
          >
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

      {/* Recent + Sidebar cards */}
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
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  <th className="px-4 py-3 text-left font-medium">Project</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-left font-medium">Duration</th>
                  <th className="px-4 py-3 text-left font-medium">Clips</th>
                  <th className="px-4 py-3 text-right font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-border/60 last:border-0 hover:bg-secondary/40"
                  >
                    <td className="px-4 py-3 font-medium">{p.name}</td>
                    <td className="px-4 py-3">
                      <StatusPill status={p.status} />
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {p.duration}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{p.clips}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">
                      {p.when}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-6">
          {/* Credits card */}
          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="mb-4 flex items-center justify-between">
              <div className="font-mono text-[10px] uppercase tracking-widest text-primary">
                Monthly usage
              </div>
              <Wallet className="size-4 text-primary" />
            </div>
            <div className="mb-1 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold">1,240</span>
              <span className="font-mono text-xs text-muted-foreground">of 1,500 credits</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary">
              <div className="h-full w-4/5 bg-primary" />
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Renews Jul 30. Upgrade anytime for more processing power.
            </p>
            <Button variant="outline" className="mt-4 w-full border-border bg-transparent">
              Manage plan
            </Button>
          </div>

          {/* AI hint */}
          <div className="rounded-2xl border border-primary/30 bg-primary/5 p-6">
            <Sparkles className="mb-3 size-5 text-primary" />
            <div className="mb-1 text-sm font-bold">AI tip of the day</div>
            <p className="text-xs text-muted-foreground">
              Podcast episodes over 40 min average 3× more high-scoring clips. Try dropping a
              full interview.
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="mb-3 flex items-center gap-2">
              <Clock className="size-4 text-primary" />
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Processing queue
              </div>
            </div>
            <div className="text-sm text-muted-foreground">
              1 job rendering · 1 job analyzing
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
