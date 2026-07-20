import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { ArrowLeft, FolderPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/app/new")({
  head: () => ({ meta: [{ title: "New Project — Clipfy" }] }),
  component: NewProject,
});

function NewProject() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const createProject = useMutation({
    mutationFn: async (form: { title: string; description: string }) => {
      const title = form.title.trim();
      if (!title) throw new Error("Dê um nome para o projeto.");

      const { data, error } = await supabase.rpc("create_project_with_credits", {
        _title: title,
        _description: form.description.trim(),
        _source: "upload",
        _source_url: "",
        _storage_path: "",
        _language: "auto",
        _target_clip_count: 10,
        _min_clip_seconds: 20,
        _max_clip_seconds: 60,
        _estimated_cost: 0,
      });
      if (error) throw error;
      const project = data as { id?: string } | null;
      if (!project?.id) throw new Error("Projeto criado sem ID. Tente novamente.");
      return project.id;
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      toast.success("Projeto criado", { description: "Agora adicione vídeo ou YouTube dentro do projeto." });
      navigate({ to: "/app/projects/$id", params: { id } });
    },
    onError: (err: unknown) => {
      toast.error("Não consegui criar o projeto", {
        description: err instanceof Error ? err.message : "Tente novamente.",
      });
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    createProject.mutate({
      title: String(form.get("title") ?? ""),
      description: String(form.get("description") ?? ""),
    });
  }

  return (
    <div className="px-6 py-8">
      <div className="mx-auto max-w-3xl">
        <Button asChild variant="ghost" size="sm" className="mb-6 gap-1">
          <Link to="/app/projects">
            <ArrowLeft className="size-4" /> Projetos
          </Link>
        </Button>

        <div className="mb-8">
          <div className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-primary">// New folder</div>
          <h1 className="text-3xl font-extrabold tracking-tight">Criar projeto</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Primeiro crie a pasta. Depois, dentro dela, você adiciona vídeo, YouTube e objetivo da IA.
          </p>
        </div>

        <form onSubmit={onSubmit} className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-5 grid size-12 place-items-center rounded-xl bg-primary/10 text-primary">
            <FolderPlus className="size-6" />
          </div>
          <div className="space-y-4">
            <div>
              <Label htmlFor="title" className="mb-2 block text-sm font-semibold">
                Nome do projeto
              </Label>
              <Input
                id="title"
                name="title"
                placeholder="Ex: Podcast com João — cortes para Reels"
                autoFocus
                disabled={createProject.isPending}
              />
            </div>
            <div>
              <Label htmlFor="description" className="mb-2 block text-sm font-semibold">
                O que você quer extrair?
              </Label>
              <Textarea
                id="description"
                name="description"
                placeholder="Ex: cortes com frases fortes, polêmicas, dicas práticas e momentos com potencial viral."
                className="min-h-28 resize-none"
                disabled={createProject.isPending}
              />
            </div>
          </div>
          <div className="mt-6 flex justify-end border-t border-border pt-5">
            <Button type="submit" size="lg" className="rounded-xl font-extrabold" disabled={createProject.isPending}>
              <FolderPlus className="mr-2 size-4" />
              {createProject.isPending ? "Criando…" : "Criar projeto"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}