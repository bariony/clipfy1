import { createFileRoute, Link } from "@tanstack/react-router";
import { FolderKanban, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/status-pill";
import type { ProjectStatus } from "@/lib/project-status";

export const Route = createFileRoute("/app/projects")({
  head: () => ({ meta: [{ title: "Projects — Clipfy" }] }),
  component: Projects,
});

const projects: Array<{
  id: string;
  name: string;
  duration: string;
  status: ProjectStatus;
  clips: number;
  when: string;
}> = [
  { id: "1", name: "Podcast E42 · Founder mode", duration: "58:12", status: "ready", clips: 12, when: "2h ago" },
  { id: "2", name: "Interview · Sarah Chen", duration: "1:24:03", status: "rendering", clips: 8, when: "Yesterday" },
  { id: "3", name: "VOD · Twitch stream 08.14", duration: "3:12:45", status: "analyzing", clips: 0, when: "3d ago" },
  { id: "4", name: "Keynote · Q3 launch", duration: "42:18", status: "completed", clips: 15, when: "1w ago" },
  { id: "5", name: "Workshop · Design tokens", duration: "1:02:34", status: "draft", clips: 0, when: "2w ago" },
  { id: "6", name: "Livestream · Dev Q&A", duration: "2:14:00", status: "failed", clips: 0, when: "3w ago" },
];

function Projects() {
  const empty = projects.length === 0;

  return (
    <div className="px-6 py-8">
      <div className="mb-8 flex items-end justify-between">
        <div>
          <div className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-primary">
            // Library
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight">Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            All your uploads, cuts, and renders in one place.
          </p>
        </div>
        <Button asChild size="lg" className="rounded-xl font-extrabold">
          <Link to="/app/new">
            <Plus className="mr-2 size-4" />
            New Project
          </Link>
        </Button>
      </div>

      {empty ? (
        <EmptyState />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => (
            <div
              key={p.id}
              className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-colors hover:border-primary/40"
            >
              <div className="relative aspect-video overflow-hidden bg-gradient-to-br from-secondary via-background to-secondary">
                <div className="pointer-events-none absolute inset-0 grid place-items-center">
                  <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/60">
                    Thumbnail
                  </div>
                </div>
                <div className="absolute right-3 top-3">
                  <StatusPill status={p.status} />
                </div>
                <div className="absolute bottom-3 right-3 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-white/90 backdrop-blur">
                  {p.duration}
                </div>
              </div>
              <div className="flex flex-1 flex-col p-4">
                <h3 className="mb-2 truncate text-sm font-bold">{p.name}</h3>
                <div className="mt-auto flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  <span>{p.clips} clips</span>
                  <span>{p.when}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-border bg-card/40 p-16 text-center">
      <div className="mb-4 grid size-12 place-items-center rounded-xl bg-primary/10 text-primary">
        <FolderKanban className="size-6" />
      </div>
      <h3 className="mb-2 text-lg font-bold">No projects yet</h3>
      <p className="mb-6 max-w-sm text-sm text-muted-foreground">
        Kick off your first project by uploading a video or pasting a YouTube link.
      </p>
      <Button asChild className="rounded-xl font-bold">
        <Link to="/app/new">
          <Plus className="mr-2 size-4" />
          New Project
        </Link>
      </Button>
    </div>
  );
}
