import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, FileVideo, Upload, X } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/new")({
  head: () => ({ meta: [{ title: "New Project — Clipfy" }] }),
  component: NewProject,
});

const MAX_FILE_SIZE = 500 * 1024 * 1024;
const ACCEPTED = "video/mp4,video/quicktime,video/webm,video/x-matroska";

function NewProject() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [progress, setProgress] = useState(0);

  function pickFile(next: File | null) {
    if (!next) return;
    if (!next.type.startsWith("video/")) {
      toast.error("Escolha um arquivo de vídeo.");
      return;
    }
    if (next.size > MAX_FILE_SIZE) {
      toast.error("Arquivo muito grande", { description: "Limite atual: 500MB." });
      return;
    }
    setFile(next);
    if (!name.trim()) setName(cleanFileName(next.name));
  }

  async function uploadWithProgress(projectId: string, selected: File): Promise<string> {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    const userId = sess.session?.user.id;
    if (!token || !userId) throw new Error("Sessão expirada. Entre novamente.");

    const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
    const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
    const ext = selected.name.split(".").pop()?.toLowerCase() || "mp4";
    const safeExt = ext.replace(/[^a-z0-9]/g, "").slice(0, 8) || "mp4";
    const path = `${userId}/${projectId}/${crypto.randomUUID()}.${safeExt}`;
    const url = `${SUPABASE_URL}/storage/v1/object/videos/${path}`;

    return new Promise<string>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;
      xhr.open("POST", url, true);
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.setRequestHeader("apikey", SUPABASE_KEY);
      xhr.setRequestHeader("x-upsert", "false");
      xhr.setRequestHeader("cache-control", "3600");
      if (selected.type) xhr.setRequestHeader("content-type", selected.type);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100));
      };
      xhr.onload = () => {
        xhrRef.current = null;
        if (xhr.status >= 200 && xhr.status < 300) resolve(path);
        else reject(new Error(parseUploadError(xhr.responseText, xhr.status)));
      };
      xhr.onerror = () => {
        xhrRef.current = null;
        reject(new Error("Falha de rede durante o upload."));
      };
      xhr.onabort = () => {
        xhrRef.current = null;
        reject(new Error("Upload cancelado."));
      };
      xhr.send(selected);
    });
  }

  const createProject = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Selecione um vídeo para continuar.");
      setProgress(0);

      const { data, error } = await supabase.rpc("create_project_with_credits", {
        _title: name.trim() || cleanFileName(file.name),
        _description: "",
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
      const id = project?.id;
      if (!id) throw new Error("Projeto criado sem ID. Tente novamente.");

      const { error: statusError } = await supabase
        .from("projects")
        .update({ status: "uploading", error_message: null })
        .eq("id", id);
      if (statusError) throw statusError;

      let storagePath = "";
      try {
        storagePath = await uploadWithProgress(id, file);
        const { error: updateError } = await supabase
          .from("projects")
          .update({ storage_path: storagePath, status: "uploaded", error_message: null })
          .eq("id", id);
        if (updateError) throw updateError;
      } catch (err) {
        if (storagePath) await supabase.storage.from("videos").remove([storagePath]).catch(() => {});
        await supabase
          .from("projects")
          .update({ status: "failed", error_message: err instanceof Error ? err.message.slice(0, 500) : "Upload failed" })
          .eq("id", id);
        throw err;
      }

      return { id };
    },
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      setProgress(0);
      toast.success("Vídeo enviado", { description: "Agora é só transcrever." });
      navigate({ to: "/app/projects/$id", params: { id: project.id } });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Falha ao criar projeto";
      if (msg === "Upload cancelado.") toast.info("Upload cancelado");
      else toast.error("Não consegui continuar", { description: msg });
    },
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      toast.error("Selecione o vídeo primeiro.");
      return;
    }
    createProject.mutate();
  }

  const isPending = createProject.isPending;

  return (
    <div className="px-6 py-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mb-5 gap-1"
            onClick={() => navigate({ to: "/app/projects" })}
          >
            <ArrowLeft className="size-4" /> Projetos
          </Button>
          <h1 className="text-3xl font-extrabold tracking-tight">Enviar vídeo</h1>
          <p className="mt-1 text-sm text-muted-foreground">Escolha o arquivo. O Clipfy cria o projeto e abre o editor automaticamente.</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-5">
          <VideoDropzone file={file} disabled={isPending} progress={progress} onPick={pickFile} onClear={() => setFile(null)} />

          <div className="rounded-2xl border border-border bg-card p-5">
            <Label className="mb-2 block text-sm font-semibold">Nome do projeto</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="O nome vem do arquivo, mas você pode editar"
              disabled={isPending}
            />
          </div>

          {isPending && (
            <div className="rounded-2xl border border-primary/30 bg-primary/10 p-5">
              <div className="mb-3 flex items-center justify-between text-sm font-bold">
                <span>{progress > 0 ? "Subindo vídeo" : "Criando projeto"}</span>
                <span className="font-mono text-primary">{progress}%</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
          )}

          <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="font-mono text-xs text-muted-foreground">Sem configuração antes. Sem draft vazio.</div>
            <div className="flex gap-2">
              {isPending && (
                <Button type="button" variant="outline" className="border-border bg-transparent" onClick={() => xhrRef.current?.abort()}>
                  Cancelar
                </Button>
              )}
              <Button type="submit" size="lg" className="rounded-xl font-extrabold" disabled={!file || isPending}>
                <Upload className="mr-2 size-4" />
                {isPending ? "Enviando…" : "Criar e enviar"}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function VideoDropzone({
  file,
  disabled,
  progress,
  onPick,
  onClear,
}: {
  file: File | null;
  disabled: boolean;
  progress: number;
  onPick: (file: File | null) => void;
  onClear: () => void;
}) {
  const [dragging, setDragging] = useState(false);

  return (
    <div className="rounded-3xl border border-border bg-card p-4">
      {file ? (
        <div className="rounded-2xl border border-primary/30 bg-primary/10 p-5">
          <div className="flex items-center gap-4">
            <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
              <FileVideo className="size-6" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-extrabold">{file.name}</div>
              <div className="mt-1 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">{formatBytes(file.size)}</div>
            </div>
            {!disabled && (
              <Button type="button" variant="ghost" size="icon" onClick={onClear} aria-label="Remover vídeo">
                <X className="size-4" />
              </Button>
            )}
          </div>
          {disabled && <Progress value={progress} className="mt-5 h-2" />}
        </div>
      ) : (
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            onPick(e.dataTransfer.files?.[0] ?? null);
          }}
          className={cn(
            "flex min-h-[320px] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-8 text-center transition-colors",
            dragging ? "border-primary bg-primary/10" : "border-border bg-background/50 hover:border-primary/60 hover:bg-secondary/40",
          )}
        >
          <input type="file" accept={ACCEPTED} className="hidden" disabled={disabled} onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
          <div className="mb-5 grid size-16 place-items-center rounded-2xl bg-primary text-primary-foreground">
            <Upload className="size-8" />
          </div>
          <div className="text-xl font-extrabold">Solte o vídeo aqui</div>
          <div className="mt-2 text-sm text-muted-foreground">ou clique para selecionar o arquivo</div>
          <div className="mt-5 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">MP4 · MOV · WEBM · MKV · até 500MB</div>
        </label>
      )}
    </div>
  );
}

function cleanFileName(fileName: string) {
  return fileName.replace(/\.[^/.]+$/, "").replace(/[-_]+/g, " ").trim() || "Novo vídeo";
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function parseUploadError(responseText: string, status: number) {
  try {
    const parsed = JSON.parse(responseText);
    if (parsed?.message) return parsed.message;
    if (parsed?.error) return parsed.error;
  } catch {
    /* noop */
  }
  return `Upload falhou (${status}).`;
}

