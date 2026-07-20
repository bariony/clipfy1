import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Clapperboard, Sparkles, Trash2, Wand2, Youtube } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/status-pill";
import type { ProjectStatus } from "@/lib/project-status";
import {
  projectQueryOptions,
  projectClipsQueryOptions,
  formatDuration,
  timeAgo,
} from "@/lib/projects";
import { supabase } from "@/integrations/supabase/client";
import { transcribeProject } from "@/lib/transcribe.functions";


export const Route = createFileRoute("/app/projects/$id")({
  head: () => ({ meta: [{ title: "Project — Clipfy" }] }),
  loader: async ({ params, context }) => {
    const project = await context.queryClient.ensureQueryData(projectQueryOptions(params.id));
    if (!project) throw notFound();
    context.queryClient.ensureQueryData(projectClipsQueryOptions(params.id));
    return { title: project.title };
  },
  component: ProjectEditor,
  errorComponent: ({ error }) => (
    <div className="p-8 text-sm text-destructive">Failed to load project: {error.message}</div>
  ),
  notFoundComponent: () => (
    <div className="p-8">
      <div className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-destructive">
        // 404
      </div>
      <h2 className="text-2xl font-extrabold">Project not found</h2>
      <p className="mt-1 text-sm text-muted-foreground">It may have been deleted.</p>
      <Button asChild className="mt-4 rounded-lg">
        <Link to="/app/projects">Back to projects</Link>
      </Button>
    </div>
  ),
});

function ProjectEditor() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: project } = useSuspenseQuery(projectQueryOptions(id));
  const { data: clips } = useSuspenseQuery(projectClipsQueryOptions(id));

  const deleteProject = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("projects").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      toast.success("Project deleted");
      navigate({ to: "/app/projects" });
    },
    onError: (err: unknown) => {
      toast.error("Failed to delete", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    },
  });

  if (!project) return null;

  return (
    <div className="px-6 py-8">
      <div className="mb-6 flex items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="gap-1">
          <Link to="/app/projects">
            <ArrowLeft className="size-4" /> Projects
          </Link>
        </Button>
      </div>

      <div className="mb-8 flex items-start justify-between gap-6">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-primary">
            <span>// Project</span>
            <StatusPill status={project.status as ProjectStatus} />
          </div>
          <h1 className="truncate text-3xl font-extrabold tracking-tight">{project.title}</h1>
          {project.description && (
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              {project.description}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="outline"
            className="border-border bg-transparent"
            onClick={() => {
              if (confirm("Delete this project? This can't be undone.")) {
                deleteProject.mutate();
              }
            }}
            disabled={deleteProject.isPending}
          >
            <Trash2 className="mr-2 size-4" />
            Delete
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="aspect-video overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-secondary via-background to-secondary">
            <div className="grid h-full place-items-center">
              <div className="text-center">
                <Clapperboard className="mx-auto mb-3 size-8 text-muted-foreground" />
                <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Player unlocks after transcoding
                </div>
              </div>
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold">Suggested clips</h2>
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {clips.length} clip{clips.length === 1 ? "" : "s"}
              </span>
            </div>

            {clips.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-card/40 p-10 text-center">
                <Wand2 className="mx-auto mb-3 size-6 text-primary" />
                <div className="mb-1 text-sm font-semibold">No clips yet</div>
                <p className="text-xs text-muted-foreground">
                  Clips will appear here once transcription and analysis complete.
                </p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {clips.map((c) => (
                  <div
                    key={c.id}
                    className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="font-mono text-[10px] uppercase tracking-widest text-primary">
                        {formatDuration(Number(c.start_seconds))} → {formatDuration(Number(c.end_seconds))}
                      </span>
                      {c.virality_score != null && (
                        <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
                          {c.virality_score}%
                        </span>
                      )}
                    </div>
                    <div className="mb-1 text-sm font-bold">{c.title}</div>
                    {c.hook && <p className="text-xs text-muted-foreground">{c.hook}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <aside className="space-y-4">
          <Meta label="Source">
            <div className="flex items-center gap-2 text-sm">
              {project.source === "youtube" ? (
                <>
                  <Youtube className="size-4 text-primary" />
                  <a
                    href={project.source_url ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate text-primary hover:underline"
                  >
                    YouTube link
                  </a>
                </>
              ) : (
                <span>Upload</span>
              )}
            </div>
          </Meta>
          <Meta label="Language">
            <span className="text-sm">{project.language ?? "auto"}</span>
          </Meta>
          <Meta label="Target clips">
            <span className="font-mono text-sm">{project.target_clip_count}</span>
          </Meta>
          <Meta label="Clip duration">
            <span className="font-mono text-sm">
              {project.min_clip_seconds}s – {project.max_clip_seconds}s
            </span>
          </Meta>
          <Meta label="Video duration">
            <span className="font-mono text-sm">{formatDuration(project.duration_seconds)}</span>
          </Meta>
          <Meta label="Created">
            <span className="font-mono text-sm">{timeAgo(project.created_at)}</span>
          </Meta>
          {project.error_message && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
              {project.error_message}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}
