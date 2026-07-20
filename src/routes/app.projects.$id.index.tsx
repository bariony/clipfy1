import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Clapperboard,
  FileVideo,
  Link2,
  Loader2,
  Play,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
  X,
  Youtube,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { StatusPill } from "@/components/status-pill";
import { projectClipsQueryOptions, projectQueryOptions, formatDuration, timeAgo, type Clip } from "@/lib/projects";
import type { ProjectStatus } from "@/lib/project-status";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { transcribeProject } from "@/lib/transcribe.functions";

const MAX_FILE_SIZE = 500 * 1024 * 1024;
const ACCEPTED = "video/mp4,video/quicktime,video/webm,video/x-matroska";

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
      <div className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-destructive">// 404</div>
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
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  const { data: project } = useSuspenseQuery(projectQueryOptions(id));
  const { data: clips } = useSuspenseQuery(projectClipsQueryOptions(id));

  const invalidateProject = () => {
    queryClient.invalidateQueries({ queryKey: ["projects", id] });
    queryClient.invalidateQueries({ queryKey: ["projects"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
  };

  const saveBrief = useMutation({
    mutationFn: async (description: string) => {
      const { error } = await supabase.from("projects").update({ description: description.trim() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateProject();
      toast.success("Objetivo salvo");
    },
    onError: (err: unknown) => toast.error("Não consegui salvar", { description: err instanceof Error ? err.message : "Tente novamente." }),
  });

  const saveYoutube = useMutation({
    mutationFn: async (url: string) => {
      const normalized = normalizeYoutubeUrl(url);
      if (!normalized) throw new Error("Cole uma URL válida do YouTube.");
      const { error } = await supabase
        .from("projects")
        .update({ source: "youtube", source_url: normalized, storage_path: null, status: "draft", error_message: null })
        .eq("id", id);
      if (error) throw error;
      return normalized;
    },
    onSuccess: () => {
      setSelectedFile(null);
      invalidateProject();
      toast.success("URL salva", { description: "Agora clique em Processar YouTube para gerar os cortes." });
    },
    onError: (err: unknown) => toast.error("Não consegui salvar a URL", { description: err instanceof Error ? err.message : "Tente novamente." }),
  });

  async function uploadWithProgress(file: File): Promise<string> {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    const userId = sess.session?.user.id;
    if (!token || !userId) throw new Error("Sessão expirada. Entre novamente.");

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
    const ext = file.name.split(".").pop()?.toLowerCase() || "mp4";
    const safeExt = ext.replace(/[^a-z0-9]/g, "").slice(0, 8) || "mp4";
    const path = `${userId}/${id}/${crypto.randomUUID()}.${safeExt}`;
    const url = `${supabaseUrl}/storage/v1/object/videos/${path}`;

    return new Promise<string>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;
      xhr.open("POST", url, true);
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.setRequestHeader("apikey", supabaseKey);
      xhr.setRequestHeader("x-upsert", "false");
      xhr.setRequestHeader("cache-control", "3600");
      if (file.type) xhr.setRequestHeader("content-type", file.type);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) setUploadProgress(Math.round((event.loaded / event.total) * 100));
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
      xhr.send(file);
    });
  }

  function pickFile(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      toast.error("Escolha um arquivo de vídeo.");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast.error("Arquivo muito grande", { description: "Limite atual: 500MB." });
      return;
    }
    setSelectedFile(file);
  }

  const uploadVideo = useMutation({
    mutationFn: async (file: File) => {
      setUploadProgress(0);
      const { error: startError } = await supabase.from("projects").update({ status: "uploading", error_message: null }).eq("id", id);
      if (startError) throw startError;

      let storagePath = "";
      try {
        storagePath = await uploadWithProgress(file);
        const { error } = await supabase
          .from("projects")
          .update({ source: "upload", source_url: null, storage_path: storagePath, status: "draft", error_message: null })
          .eq("id", id);
        if (error) {
          await supabase.storage.from("videos").remove([storagePath]).catch(() => {});
          throw error;
        }
      } catch (err) {
        await supabase
          .from("projects")
          .update({ status: "failed", error_message: err instanceof Error ? err.message.slice(0, 500) : "Upload failed" })
          .eq("id", id);
        throw err;
      }
    },
    onSuccess: () => {
      setSelectedFile(null);
      setUploadProgress(0);
      invalidateProject();
      toast.success("Vídeo anexado", { description: "Agora dá para transcrever." });
    },
    onError: (err: unknown) => {
      invalidateProject();
      const message = err instanceof Error ? err.message : "Upload failed";
      if (message === "Upload cancelado.") toast.info("Upload cancelado");
      else toast.error("Upload falhou", { description: message });
    },
  });

  const processFn = useServerFn(transcribeProject);
  const processSource = useMutation({
    mutationFn: () => processFn({ data: { projectId: id } }),
    onSuccess: (res) => {
      invalidateProject();
      toast.success("Cortes gerados", { description: `${res.clips} sugestões criadas a partir de ${res.characters.toLocaleString()} caracteres.` });
    },
    onError: (err: unknown) => {
      invalidateProject();
      toast.error("Processamento falhou", { description: err instanceof Error ? err.message : "Tente novamente." });
    },
  });

  const deleteProject = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("projects").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      toast.success("Projeto deletado");
      navigate({ to: "/app/projects" });
    },
    onError: (err: unknown) => toast.error("Não consegui deletar", { description: err instanceof Error ? err.message : "Tente novamente." }),
  });

  if (!project) return null;

  const hasUpload = Boolean(project.storage_path);
  const hasYoutube = project.source === "youtube" && Boolean(project.source_url);
  const canProcessUpload = hasUpload && ["draft", "failed"].includes(project.status);
  const canProcessYoutube = hasYoutube && !hasUpload && ["draft", "failed"].includes(project.status);
  const isUploading = uploadVideo.isPending || project.status === "uploading";
  const isProcessing = processSource.isPending || project.status === "transcribing" || project.status === "analyzing";
  const currentStep = getCurrentStep(project.status, hasUpload, hasYoutube);

  return (
    <div className="px-6 py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <Button asChild variant="ghost" size="sm" className="gap-1">
          <Link to="/app/projects">
            <ArrowLeft className="size-4" /> Projects
          </Link>
        </Button>
        <Button
          variant="outline"
          className="border-border bg-transparent"
          onClick={() => {
            if (confirm("Delete this project? This can't be undone.")) deleteProject.mutate();
          }}
          disabled={deleteProject.isPending}
        >
          <Trash2 className="mr-2 size-4" /> Delete
        </Button>
      </div>

      <div className="mb-8">
        <div className="mb-2 flex flex-wrap items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-primary">
          <span>// Project workspace</span>
          {hasUpload && project.status === "draft" ? <ReadyBadge label="video ready" /> : <StatusPill status={project.status as ProjectStatus} />}
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight">{project.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{currentStep}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <SourceStage
            hasUpload={hasUpload}
            hasYoutube={hasYoutube}
            sourceUrl={project.source_url}
            selectedFile={selectedFile}
            progress={uploadProgress}
            uploading={isUploading}
            inputRef={fileInputRef}
            onPick={pickFile}
            onClear={() => {
              setSelectedFile(null);
              setUploadProgress(0);
            }}
            onCancel={() => xhrRef.current?.abort()}
            onUpload={() => selectedFile && uploadVideo.mutate(selectedFile)}
            onSaveYoutube={(url) => saveYoutube.mutate(url)}
            savingYoutube={saveYoutube.isPending}
          />

          <BriefPanel
            initialValue={project.description ?? ""}
            saving={saveBrief.isPending}
            onSave={(description) => saveBrief.mutate(description)}
          />

          {canProcessUpload && (
            <div className="rounded-2xl border border-primary/30 bg-primary/10 p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <div className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground">
                    <CheckCircle2 className="size-5" />
                  </div>
                  <div>
                    <h2 className="text-base font-extrabold">Vídeo pronto</h2>
                    <p className="mt-1 text-sm text-muted-foreground">Clique para transcrever, analisar e gerar os cortes sugeridos.</p>
                  </div>
                </div>
                <Button size="lg" className="rounded-xl font-extrabold" onClick={() => processSource.mutate()} disabled={isProcessing}>
                  {isProcessing ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Sparkles className="mr-2 size-4" />}
                  {isProcessing ? "Processando…" : "Processar vídeo"}
                </Button>
              </div>
            </div>
          )}

          {hasYoutube && !hasUpload && (
            <div className="rounded-2xl border border-primary/30 bg-card p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <div className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                    <Youtube className="size-5" />
                  </div>
                  <div>
                    <h2 className="text-base font-extrabold">URL do YouTube pronta</h2>
                    <p className="mt-1 text-sm text-muted-foreground">O processamento puxa legendas públicas, cria a transcrição e gera sugestões de cortes.</p>
                  </div>
                </div>
                {canProcessYoutube && (
                  <Button size="lg" className="rounded-xl font-extrabold" onClick={() => processSource.mutate()} disabled={isProcessing}>
                    {isProcessing ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Play className="mr-2 size-4" />}
                    {isProcessing ? "Processando…" : "Processar YouTube"}
                  </Button>
                )}
              </div>
            </div>
          )}

          <ClipsPanel clips={clips} projectId={project.id} />
        </div>

        <aside className="space-y-4">
          <div className="aspect-video overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-secondary via-background to-secondary">
            <div className="grid h-full place-items-center text-center">
              <div>
                <Clapperboard className="mx-auto mb-3 size-8 text-muted-foreground" />
                <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  {hasUpload ? "Video uploaded" : hasYoutube ? "YouTube linked" : "No source yet"}
                </div>
              </div>
            </div>
          </div>
          <Meta label="Next step"><span className="text-sm">{currentStep}</span></Meta>
          <Meta label="Source"><span className="text-sm">{hasYoutube ? "YouTube" : hasUpload ? "Upload" : "Not added"}</span></Meta>
          <Meta label="Duration"><span className="font-mono text-sm">{formatDuration(project.duration_seconds)}</span></Meta>
          <Meta label="Created"><span className="font-mono text-sm">{timeAgo(project.created_at)}</span></Meta>
          {project.error_message && <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">{project.error_message}</div>}
        </aside>
      </div>
    </div>
  );
}

function SourceStage({
  hasUpload,
  hasYoutube,
  sourceUrl,
  selectedFile,
  progress,
  uploading,
  inputRef,
  onPick,
  onClear,
  onCancel,
  onUpload,
  onSaveYoutube,
  savingYoutube,
}: {
  hasUpload: boolean;
  hasYoutube: boolean;
  sourceUrl: string | null;
  selectedFile: File | null;
  progress: number;
  uploading: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onPick: (file: File | null) => void;
  onClear: () => void;
  onCancel: () => void;
  onUpload: () => void;
  onSaveYoutube: (url: string) => void;
  savingYoutube: boolean;
}) {
  const [youtubeUrl, setYoutubeUrl] = useState(sourceUrl ?? "");

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-extrabold">Fonte do projeto</h2>
          <p className="text-sm text-muted-foreground">Adicione um arquivo ou cole uma URL do YouTube. Nada acontece antes de você escolher.</p>
        </div>
        {(hasUpload || hasYoutube) && <ReadyBadge label={hasUpload ? "upload added" : "url added"} />}
      </div>

      <Tabs defaultValue={hasYoutube && !hasUpload ? "youtube" : "upload"} className="w-full">
        <TabsList className="mb-4 grid w-full grid-cols-2">
          <TabsTrigger value="upload"><Upload className="mr-2 size-4" /> Upload</TabsTrigger>
          <TabsTrigger value="youtube"><Youtube className="mr-2 size-4" /> YouTube</TabsTrigger>
        </TabsList>
        <TabsContent value="upload" className="mt-0">
          <VideoUploadPanel
            file={selectedFile}
            hasVideo={hasUpload}
            progress={progress}
            uploading={uploading}
            inputRef={inputRef}
            onPick={onPick}
            onClear={onClear}
            onCancel={onCancel}
            onUpload={onUpload}
          />
        </TabsContent>
        <TabsContent value="youtube" className="mt-0">
          <form
            className="rounded-xl border border-border bg-background/40 p-4"
            onSubmit={(event) => {
              event.preventDefault();
              onSaveYoutube(youtubeUrl);
            }}
          >
            <Label htmlFor="youtube-url" className="mb-2 block text-sm font-semibold">URL do YouTube</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Link2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="youtube-url" value={youtubeUrl} onChange={(event) => setYoutubeUrl(event.target.value)} placeholder="https://www.youtube.com/watch?v=..." className="pl-9" disabled={savingYoutube} />
              </div>
              <Button type="submit" className="rounded-lg font-bold" disabled={savingYoutube}>
                {savingYoutube ? "Salvando…" : "Salvar URL"}
              </Button>
            </div>
          </form>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function VideoUploadPanel({ file, hasVideo, progress, uploading, inputRef, onPick, onClear, onCancel, onUpload }: {
  file: File | null;
  hasVideo: boolean;
  progress: number;
  uploading: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onPick: (file: File | null) => void;
  onClear: () => void;
  onCancel: () => void;
  onUpload: () => void;
}) {
  const [dragging, setDragging] = useState(false);

  if (file) {
    return (
      <div className="rounded-xl border border-primary/30 bg-primary/10 p-4">
        <div className="flex items-center gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground"><FileVideo className="size-5" /></div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{file.name}</div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{formatBytes(file.size)}{uploading ? ` · enviando ${progress}%` : " · pronto"}</div>
          </div>
          {uploading ? <Button type="button" variant="outline" size="sm" onClick={onCancel} className="border-border bg-transparent">Cancelar</Button> : <Button type="button" variant="ghost" size="icon" onClick={onClear} aria-label="Remove file"><X className="size-4" /></Button>}
        </div>
        {uploading && <Progress value={progress} className="mt-3 h-1.5" />}
        {!uploading && <Button type="button" onClick={onUpload} className="mt-4 rounded-lg font-bold"><Upload className="mr-2 size-4" />Enviar vídeo</Button>}
      </div>
    );
  }

  return (
    <label
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        onPick(event.dataTransfer.files?.[0] ?? null);
      }}
      className={cn("flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-9 text-center transition-colors", dragging ? "border-primary bg-primary/5" : "border-border bg-background/40 hover:border-primary/50")}
    >
      <input ref={inputRef} type="file" accept={ACCEPTED} className="hidden" onChange={(event) => onPick(event.target.files?.[0] ?? null)} />
      <Upload className="mb-3 size-6 text-muted-foreground" />
      <div className="text-sm font-semibold">{hasVideo ? "Trocar vídeo" : "Solte o vídeo aqui ou clique para escolher"}</div>
      <div className="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">MP4 · MOV · WEBM · MKV — até 500MB</div>
    </label>
  );
}

function BriefPanel({ initialValue, saving, onSave }: { initialValue: string; saving: boolean; onSave: (description: string) => void }) {
  const [value, setValue] = useState(initialValue);
  return (
    <form
      className="rounded-2xl border border-border bg-card p-5"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(value);
      }}
    >
      <Label htmlFor="brief" className="mb-2 block text-base font-extrabold">Objetivo da IA</Label>
      <Textarea id="brief" value={value} onChange={(event) => setValue(event.target.value)} placeholder="Descreva o que a IA deve procurar neste vídeo." className="min-h-28 resize-none" disabled={saving} />
      <div className="mt-4 flex justify-end">
        <Button type="submit" variant="outline" className="border-border bg-transparent" disabled={saving}>{saving ? "Salvando…" : "Salvar objetivo"}</Button>
      </div>
    </form>
  );
}

function ClipsPanel({ clips, projectId }: { clips: Clip[]; projectId: string }) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-bold">Suggested clips</h2>
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{clips.length} clip{clips.length === 1 ? "" : "s"}</span>
      </div>
      {clips.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/40 p-10 text-center">
          <Wand2 className="mx-auto mb-3 size-6 text-primary" />
          <div className="mb-1 text-sm font-semibold">No clips yet</div>
          <p className="text-xs text-muted-foreground">Depois da transcrição e análise, os cortes aparecem aqui.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {clips.map((clip) => (
            <Link
              key={clip.id}
              to="/app/projects/$id/clips/$clipId"
              params={{ id: projectId, clipId: clip.id }}
              className="group rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-widest text-primary">{formatDuration(Number(clip.start_seconds))} → {formatDuration(Number(clip.end_seconds))}</span>
                {clip.virality_score != null && <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">{clip.virality_score}%</span>}
              </div>
              <div className="mb-1 text-sm font-bold">{clip.title}</div>
              {clip.hook && <p className="text-xs text-muted-foreground">{clip.hook}</p>}
              <div className="mt-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground group-hover:text-primary">Abrir editor →</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}


function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

function ReadyBadge({ label }: { label: string }) {
  return <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-primary"><span className="size-1.5 rounded-full bg-current" />{label}</span>;
}

function getCurrentStep(status: string, hasUpload: boolean, hasYoutube: boolean) {
  if (status === "uploading") return "Upload em andamento.";
  if (status === "transcribing") return "Buscando/transcrevendo a fonte.";
  if (status === "analyzing") return "Analisando momentos fortes e gerando cortes.";
  if (status === "ready") return "Cortes prontos para revisar.";
  if (status === "failed") return hasUpload ? "Corrija o erro ou tente transcrever novamente." : "Corrija o erro e continue.";
  if (hasUpload) return "Vídeo anexado. Clique em Processar vídeo.";
  if (hasYoutube) return "URL salva. Clique em Processar YouTube.";
  return "Adicione um vídeo ou cole uma URL do YouTube.";
}

function normalizeYoutubeUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    const host = url.hostname.replace(/^www\./, "");
    if (!["youtube.com", "m.youtube.com", "youtu.be"].includes(host)) return "";
    return url.toString();
  } catch {
    return "";
  }
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