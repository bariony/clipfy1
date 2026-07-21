import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, FolderKanban, Plus, Upload } from "lucide-react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/status-pill";
import { projectsQueryOptions, formatDuration, timeAgo, type Project } from "@/lib/projects";
import type { ProjectStatus } from "@/lib/project-status";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/projects/")({
  head: () => ({ meta: [{ title: "Projects — Clipfy" }] }),
  loader: ({ context }) => context.queryClient.ensureQueryData(projectsQueryOptions()),
  component: Projects,
  errorComponent: ({ error }) => (
    <div className="p-8 text-sm text-destructive">Failed to load projects: {error.message}</div>
  ),
  notFoundComponent: () => <div className="p-8 text-sm text-muted-foreground">No projects found.</div>,
});

function Projects() {
  const { data: projects } = useSuspenseQuery(projectsQueryOptions());

  const drafts = projects.filter(
    (p) => (p.storage_path || p.source_url) && p.status === "draft",
  );
  const others = projects.filter((p) => !drafts.includes(p));
  const hasDrafts = drafts.length > 0;

  return (
    <div className="px-6 py-8">
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <div className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-primary">// Biblioteca</div>
          <h1 className="text-3xl font-extrabold tracking-tight">Projetos</h1>
          <p className="mt-1 text-sm text-muted-foreground">Continue de onde parou.</p>
        </div>
        <Button asChild size="lg" className="rounded-xl font-extrabold">
          <Link to="/app/new">
            <Plus className="mr-2 size-4" />
            Novo Projeto
          </Link>
        </Button>
      </div>

      {projects.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-8">
          {hasDrafts && (
            <section>
              <div className="mb-3 flex items-center gap-2">
                <span className="inline-flex size-2 rounded-full bg-yellow-400" />
                <h2 className="text-sm font-bold uppercase tracking-widest text-yellow-300">
                  Continuar rascunhos
                </h2>
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  {drafts.length}
                </span>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {drafts.map((p) => (
                  <ProjectCard key={p.id} project={p} highlight />
                ))}
              </div>
            </section>
          )}
          {others.length > 0 && (
            <section>
              {hasDrafts && (
                <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-muted-foreground">
                  Todos os projetos
                </h2>
              )}
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {others.map((p) => (
                  <ProjectCard key={p.id} project={p} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function ProjectCard({
  project: p,
  highlight,
}: {
  project: Project;
  highlight?: boolean;
}) {
  const hasSource = Boolean(p.storage_path || p.source_url);
  const nextStep = !hasSource
    ? "Adicionar vídeo ou YouTube"
    : ["draft", "failed"].includes(p.status)
      ? "Gerar cortes"
      : p.status === "ready"
        ? "Ver cortes"
        : "Continuar";

  return (
    <Link
      to="/app/projects/$id"
      params={{ id: p.id }}
      className={cn(
        "group flex flex-col overflow-hidden rounded-2xl border bg-card transition-colors",
        highlight ? "border-yellow-400/40 hover:border-yellow-400" : "border-border hover:border-primary/40",
      )}
    >
      <div className="relative aspect-video overflow-hidden bg-gradient-to-br from-secondary via-background to-secondary">
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/60">
            {p.source === "youtube" ? "YouTube" : hasSource ? "Video" : "Sem fonte"}
          </div>
        </div>
        <div className="absolute right-3 top-3">
          {highlight ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-yellow-400/50 bg-yellow-400/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-yellow-300">
              <span className="size-1.5 rounded-full bg-current" />
              continuar
            </span>
          ) : (
            <StatusPill status={p.status as ProjectStatus} />
          )}
        </div>
        <div className="absolute bottom-3 right-3 rounded bg-background/80 px-1.5 py-0.5 font-mono text-[10px] text-foreground backdrop-blur">
          {formatDuration(p.duration_seconds)}
        </div>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <h3 className="mb-2 truncate text-sm font-bold">{p.title}</h3>
        <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
          {hasSource ? <CheckCircle2 className="size-4 text-primary" /> : <Upload className="size-4 text-primary" />}
          <span>{nextStep}</span>
        </div>
        <div className="mt-auto flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          <span>{timeAgo(p.created_at)}</span>
          <span className="inline-flex items-center gap-1 text-primary">
            Abrir <ArrowRight className="size-3" />
          </span>
        </div>
      </div>
    </Link>
  );
}

function EmptyState() {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-border bg-card/40 p-16 text-center">
      <div className="mb-4 grid size-12 place-items-center rounded-xl bg-primary/10 text-primary">
        <FolderKanban className="size-6" />
      </div>
      <h3 className="mb-2 text-lg font-bold">Nenhum projeto ainda</h3>
      <p className="mb-6 max-w-sm text-sm text-muted-foreground">Crie uma pasta de projeto primeiro. Depois você adiciona vídeo, YouTube e objetivo dentro dela.</p>
      <Button asChild className="rounded-xl font-bold">
        <Link to="/app/new">
          <Plus className="mr-2 size-4" />
          New Project
        </Link>
      </Button>
    </div>
  );
}