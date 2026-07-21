import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  ArrowLeft,
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
import { StatusPill } from "@/components/status-pill";
import { ClipCard } from "@/components/clip-card";
import { EditClipDrawer } from "@/components/edit-clip-drawer";
import { StylePanel } from "@/components/style-panel";
import {
  projectClipsQueryOptions,
  projectQueryOptions,
  transcriptQueryOptions,
  type Clip,
  type TranscriptSegment,
} from "@/lib/projects";
import type { ProjectStatus } from "@/lib/project-status";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { transcribeProject } from "@/lib/transcribe.functions";
import { formatProcessingError } from "@/lib/processing-errors";

import { DEFAULT_TEMPLATE_SLUG, type ProjectPreferences } from "@/lib/caption-templates";

const MAX_FILE_SIZE = 500 * 1024 * 1024;
const ACCEPTED = "video/mp4,video/quicktime,video/webm,video/x-matroska";

export const Route = createFileRoute("/app/projects/$id/")({
  head: () => ({ meta: [{ title: "Projeto — Clipfy" }] }),
  loader: async ({ params, context }) => {
    const project = await context.queryClient.ensureQueryData(projectQueryOptions(params.id));
    if (!project) throw notFound();
    context.queryClient.ensureQueryData(projectClipsQueryOptions(project.id));
    context.queryClient.ensureQueryData(transcriptQueryOptions(project.id));
    return { title: project.title };
  },

  component: ProjectWorkspace,
  errorComponent: ({ error }) => (
    <div className="p-8 text-sm text-destructive">Falhou ao carregar: {error.message}</div>
  ),
  notFoundComponent: () => (
    <div className="p-8">
      <div className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-destructive">// 404</div>
      <h2 className="text-2xl font-extrabold">Projeto não encontrado</h2>
      <Button asChild className="mt-4 rounded-lg">
        <Link to="/app/projects">Voltar</Link>
      </Button>
    </div>
  ),
});

function ProjectWorkspace() {
  const { id: idOrSlug } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: project } = useSuspenseQuery(projectQueryOptions(idOrSlug));
  const id = project?.id ?? idOrSlug;
  const { data: clips } = useSuspenseQuery(projectClipsQueryOptions(id));
  const { data: transcript } = useSuspenseQuery(transcriptQueryOptions(id));


  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [editingClip, setEditingClip] = useState<Clip | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["projects", id] });
    qc.invalidateQueries({ queryKey: ["projects"] });
    qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
  };

  // ---------- Signed URL for uploaded video (shared across cards) ----------
  useEffect(() => {
    if (!project || project.source !== "upload" || !project.storage_path) {
      setVideoUrl(null);
      return;
    }
    let cancelled = false;
    supabase.storage
      .from("videos")
      .createSignedUrl(project.storage_path, 3600)
      .then(({ data }) => {
        if (!cancelled) setVideoUrl(data?.signedUrl ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [project?.source, project?.storage_path]);

  const segments = useMemo<TranscriptSegment[]>(() => {
    const raw = (transcript?.segments ?? []) as unknown;
    return Array.isArray(raw)
      ? (raw as TranscriptSegment[]).filter(
          (s) => typeof s?.start === "number" && typeof s?.end === "number",
        )
      : [];
  }, [transcript]);

  // ---------- Mutations ----------
  const saveYoutube = useMutation({
    mutationFn: async (url: string) => {
      const normalized = normalizeYoutubeUrl(url);
      if (!normalized) throw new Error("Cole uma URL válida do YouTube.");
      const { error } = await supabase
        .from("projects")
        .update({
          source: "youtube",
          source_url: normalized,
          storage_path: null,
          status: "draft",
          error_message: null,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      void 0;
    },
    onError: (err: unknown) =>
      toast.error("Não consegui salvar", { description: err instanceof Error ? err.message : "" }),
  });

  const uploadVideo = useMutation({
    mutationFn: async (file: File) => {
      setUploadProgress(0);
      await supabase.from("projects").update({ status: "uploading", error_message: null }).eq("id", id);
      try {
        const path = await uploadWithProgress(file, id, setUploadProgress, xhrRef);
        const { error } = await supabase
          .from("projects")
          .update({
            source: "upload",
            source_url: null,
            storage_path: path,
            status: "draft",
            error_message: null,
          })
          .eq("id", id);
        if (error) {
          await supabase.storage.from("videos").remove([path]).catch(() => {});
          throw error;
        }
      } catch (err) {
        await supabase
          .from("projects")
          .update({
            status: "failed",
            error_message: err instanceof Error ? err.message.slice(0, 500) : "Upload failed",
          })
          .eq("id", id);
        throw err;
      }
    },
    onSuccess: () => {
      setSelectedFile(null);
      setUploadProgress(0);
      invalidate();
      void 0;
    },
    onError: (err: unknown) => {
      invalidate();
      const message = err instanceof Error ? err.message : "Upload falhou";
      if (message === "Upload cancelado.") void 0;
      else toast.error("Upload falhou", { description: message });
    },
  });

  const processFn = useServerFn(transcribeProject);
  const processSource = useMutation({
    mutationFn: () => processFn({ data: { projectId: id } }),
    onMutate: () => {
      qc.setQueryData(["projects", idOrSlug], project ? { ...project, status: "transcribing", error_message: null } : project);
      qc.setQueryData(["projects", id], project ? { ...project, status: "transcribing", error_message: null } : project);
    },
    onSuccess: () => {
      invalidate();
    },

    onError: (err: unknown) => {
      invalidate();
      toast.error("Processamento falhou", { description: err instanceof Error ? err.message : "" });
    },
  });


  const deleteProject = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("projects").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      void 0;
      navigate({ to: "/app/projects" });
    },
    onError: (err: unknown) =>
      toast.error("Não consegui deletar", { description: err instanceof Error ? err.message : "" }),
  });

  if (!project) return null;

  const hasUpload = Boolean(project.storage_path);
  const hasYoutube = project.source === "youtube" && Boolean(project.source_url);
  const hasSource = hasUpload || hasYoutube;
  const isUploading = uploadVideo.isPending || project.status === "uploading";
  const isProcessing =
    processSource.isPending || project.status === "transcribing" || project.status === "analyzing";
  const hasClips = clips.length > 0;

  const preferences = (project.preferences ?? {}) as ProjectPreferences;
  const templateSlug = preferences.caption_template ?? DEFAULT_TEMPLATE_SLUG;
  const visibleError = formatProcessingError(project.error_message);
  const canRetryFromError = hasSource && project.status === "failed";

  const source: "upload" | "youtube" = hasYoutube ? "youtube" : "upload";
  const sampleClip = clips[0];
  const sampleStart = sampleClip ? Number(sampleClip.start_seconds) : 0;
  const sampleEnd = sampleClip ? Number(sampleClip.end_seconds) : Math.min(30, project.duration_seconds ?? 30) || 30;

  function pickFile(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("video/")) return toast.error("Escolha um arquivo de vídeo.");
    if (file.size > MAX_FILE_SIZE) return toast.error("Máx 500MB.");
    setSelectedFile(file);
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      {/* Top bar */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <Button asChild variant="ghost" size="sm" className="gap-1">
          <Link to="/app/projects">
            <ArrowLeft className="size-4" /> Projetos
          </Link>
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="border-border bg-transparent"
          onClick={() => {
            if (confirm("Deletar este projeto?")) deleteProject.mutate();
          }}
          disabled={deleteProject.isPending}
        >
          <Trash2 className="mr-1.5 size-3.5" /> Deletar
        </Button>
      </div>

      <div className="mb-6">
        <div className="mb-2 flex flex-wrap items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-primary">
          <span>// workspace</span>
          <StatusPill status={project.status as ProjectStatus} />
          {hasClips && (
            <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
              {clips.length} corte{clips.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight">{project.title}</h1>
      </div>

      {visibleError && (
        <div className="mb-6 flex flex-col gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between">
          <span>{visibleError}</span>
          {canRetryFromError && (
            <Button
              size="sm"
              variant="outline"
              className="border-destructive/40 bg-background/40 text-destructive hover:bg-destructive/10"
              onClick={() => processSource.mutate()}
              disabled={isProcessing}
            >
              <Sparkles className="mr-2 size-3.5" /> Tentar novamente
            </Button>
          )}
        </div>
      )}

      {/* Estado A: sem fonte */}
      {!hasSource && (
        <SourceStage
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
      )}

      {/* Estado B: fonte pronta, ainda sem cortes */}
      {hasSource && !hasClips && !isProcessing && (
        <div className="space-y-6">
          <StylePanel
            projectId={project.id}
            preferences={preferences}
            source={source}
            videoUrl={videoUrl}
            youtubeUrl={hasYoutube ? project.source_url : null}
            sampleStart={0}
            sampleEnd={Math.min(30, project.duration_seconds ?? 30) || 30}
            segments={segments}
          />

          <div className="rounded-2xl border border-primary/30 bg-primary/10 p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground">
                  {hasYoutube ? <Youtube className="size-5" /> : <Clapperboard className="size-5" />}
                </div>
                <div>
                  <h2 className="text-base font-extrabold">Pronto pra gerar os cortes</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    A IA transcreve, encontra os melhores momentos e aplica o estilo escolhido.
                  </p>
                </div>
              </div>
              <Button
                size="lg"
                className="rounded-xl font-extrabold"
                onClick={() => processSource.mutate()}
                disabled={isProcessing}
              >
                <Sparkles className="mr-2 size-4" /> Gerar cortes
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Processing */}
      {isProcessing && (
        <div className="rounded-2xl border border-border bg-card p-10 text-center">
          <Loader2 className="mx-auto mb-3 size-6 animate-spin text-primary" />
          <h2 className="text-base font-extrabold">Analisando vídeo…</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Transcrição + análise de viralidade. Isso leva de segundos a alguns minutos.
          </p>
        </div>
      )}

      {/* Estado C: cortes prontos */}
      {hasClips && (
        <div className="space-y-5">
          <StylePanel
            projectId={project.id}
            preferences={preferences}
            source={source}
            videoUrl={videoUrl}
            youtubeUrl={hasYoutube ? project.source_url : null}
            sampleStart={sampleStart}
            sampleEnd={sampleEnd}
            segments={segments}
            startCollapsed
          />

          <div>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-extrabold">Cortes sugeridos</h2>
                <p className="text-xs text-muted-foreground">
                  Passe o mouse pra ouvir · legenda já aplicada · ordenado por score
                </p>
              </div>
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {clips.length} clip{clips.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {clips.map((clip) => (
                <ClipCard
                  key={clip.id}
                  clip={clip}
                  source={source}
                  videoUrl={videoUrl}
                  youtubeUrl={hasYoutube ? project.source_url : null}
                  segments={segments}
                  templateSlug={templateSlug}
                  onEdit={() => setEditingClip(clip)}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      <EditClipDrawer
        open={editingClip !== null}
        onOpenChange={(o) => !o && setEditingClip(null)}
        clip={editingClip}
        projectId={id}
        source={source}
        videoUrl={videoUrl}
        youtubeUrl={hasYoutube ? project.source_url : null}
        segments={segments}
        projectTemplate={templateSlug}
      />
    </div>
  );
}

// ---------- Source stage (Upload / YouTube) ----------
function SourceStage({
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
  const [youtubeUrl, setYoutubeUrl] = useState("");
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-4">
        <div className="mb-1 font-mono text-xs uppercase tracking-[0.2em] text-primary">// passo 1</div>
        <h2 className="text-base font-extrabold">De onde vem o vídeo?</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Envie um arquivo ou cole uma URL do YouTube.
        </p>
      </div>

      <Tabs defaultValue="upload" className="w-full">
        <TabsList className="mb-4 grid w-full grid-cols-2">
          <TabsTrigger value="upload">
            <Upload className="mr-2 size-4" /> Upload
          </TabsTrigger>
          <TabsTrigger value="youtube">
            <Youtube className="mr-2 size-4" /> YouTube
          </TabsTrigger>
        </TabsList>

        <TabsContent value="upload" className="mt-0">
          <UploadDropzone
            file={selectedFile}
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
            onSubmit={(e) => {
              e.preventDefault();
              onSaveYoutube(youtubeUrl);
            }}
          >
            <Label htmlFor="yt-url" className="mb-2 block text-sm font-semibold">URL do YouTube</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Link2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="yt-url"
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=..."
                  className="pl-9"
                  disabled={savingYoutube}
                />
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

function UploadDropzone({
  file,
  progress,
  uploading,
  inputRef,
  onPick,
  onClear,
  onCancel,
  onUpload,
}: {
  file: File | null;
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
          <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
            <FileVideo className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{file.name}</div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              {formatBytes(file.size)}
              {uploading ? ` · enviando ${progress}%` : " · pronto"}
            </div>
          </div>
          {uploading ? (
            <Button type="button" variant="outline" size="sm" onClick={onCancel} className="border-border bg-transparent">
              Cancelar
            </Button>
          ) : (
            <Button type="button" variant="ghost" size="icon" onClick={onClear} aria-label="Remover">
              <X className="size-4" />
            </Button>
          )}
        </div>
        {uploading && <Progress value={progress} className="mt-3 h-1.5" />}
        {!uploading && (
          <Button type="button" onClick={onUpload} className="mt-4 rounded-lg font-bold">
            <Upload className="mr-2 size-4" /> Enviar vídeo
          </Button>
        )}
      </div>
    );
  }

  return (
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
        "flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-9 text-center transition-colors",
        dragging ? "border-primary bg-primary/5" : "border-border bg-background/40 hover:border-primary/50",
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        className="hidden"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      />
      <Upload className="mb-3 size-6 text-muted-foreground" />
      <div className="text-sm font-semibold">Solte o vídeo aqui ou clique para escolher</div>
      <div className="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        MP4 · MOV · WEBM · MKV — até 500MB
      </div>
    </label>
  );
}

// ---------- Helpers ----------
async function uploadWithProgress(
  file: File,
  projectId: string,
  onProgress: (p: number) => void,
  xhrRef: RefObject<XMLHttpRequest | null>,
): Promise<string> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  const userId = sess.session?.user.id;
  if (!token || !userId) throw new Error("Sessão expirada. Entre novamente.");

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
  const ext = (file.name.split(".").pop() ?? "mp4").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "mp4";
  const path = `${userId}/${projectId}/${crypto.randomUUID()}.${ext}`;
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
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
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

// unused imports guard (Play/Wand2 kept for potential future states)
void Play;
void Wand2;
