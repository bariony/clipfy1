import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, Clapperboard, FileVideo, Sparkles, Trash2, Upload, Wand2, X, Youtube } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { StatusPill } from "@/components/status-pill";
import type { ProjectStatus } from "@/lib/project-status";
import { cn } from "@/lib/utils";
import {
  projectQueryOptions,
  projectClipsQueryOptions,
  formatDuration,
  timeAgo,
} from "@/lib/projects";
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const { data: project } = useSuspenseQuery(projectQueryOptions(id));
  const { data: clips } = useSuspenseQuery(projectClipsQueryOptions(id));

  const invalidateProject = () => {
    queryClient.invalidateQueries({ queryKey: ["projects", id] });
    queryClient.invalidateQueries({ queryKey: ["projects"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
  };

  function pickFile(f: File | null) {
    if (!f) return;
    if (!f.type.startsWith("video/")) {
      toast.error("Please choose a video file (mp4, mov, webm, mkv).");
      return;
    }
    if (f.size > MAX_FILE_SIZE) {
      toast.error("File too large", { description: "Max 500MB for now." });
      return;
    }
    setSelectedFile(f);
  }

  async function uploadWithProgress(f: File): Promise<string> {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    const userId = sess.session?.user.id;
    if (!token || !userId) throw new Error("Not authenticated");

    const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
    const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
    const ext = f.name.split(".").pop()?.toLowerCase() || "mp4";
    const safeExt = ext.replace(/[^a-z0-9]/g, "").slice(0, 8) || "mp4";
    const path = `${userId}/${id}/${crypto.randomUUID()}.${safeExt}`;
    const url = `${SUPABASE_URL}/storage/v1/object/videos/${path}`;

    return new Promise<string>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;
      xhr.open("POST", url, true);
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.setRequestHeader("apikey", SUPABASE_KEY);
      xhr.setRequestHeader("x-upsert", "false");
      xhr.setRequestHeader("cache-control", "3600");
      if (f.type) xhr.setRequestHeader("content-type", f.type);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        xhrRef.current = null;
        if (xhr.status >= 200 && xhr.status < 300) resolve(path);
        else {
          let msg = `Upload failed (${xhr.status})`;
          try {
            const parsed = JSON.parse(xhr.responseText);
            if (parsed?.message) msg = parsed.message;
          } catch {
            /* noop */
          }
          reject(new Error(msg));
        }
      };
      xhr.onerror = () => {
        xhrRef.current = null;
        reject(new Error("Network error during upload"));
      };
      xhr.onabort = () => {
        xhrRef.current = null;
        reject(new Error("Upload cancelled"));
      };
      xhr.send(f);
    });
  }

  const uploadVideo = useMutation({
    mutationFn: async (f: File) => {
      setUploadProgress(0);
      const { error: startErr } = await supabase
        .from("projects")
        .update({ status: "uploading", error_message: null })
        .eq("id", id);
      if (startErr) throw startErr;

      let storagePath = "";
      try {
        storagePath = await uploadWithProgress(f);
        const { error: updateErr } = await supabase
          .from("projects")
          .update({ source: "upload", storage_path: storagePath, status: "draft", error_message: null })
          .eq("id", id);
        if (updateErr) {
          await supabase.storage.from("videos").remove([storagePath]).catch(() => {});
          throw updateErr;
        }
        return storagePath;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Upload failed";
        await supabase
          .from("projects")
          .update({ status: message === "Upload cancelled" ? "draft" : "failed", error_message: message.slice(0, 500) })
          .eq("id", id);
        throw err;
      }
    },
    onSuccess: () => {
      setSelectedFile(null);
      setUploadProgress(0);
      invalidateProject();
      toast.success("Video uploaded", { description: "You can transcribe this project now." });
    },
    onError: (err: unknown) => {
      invalidateProject();
      const msg = err instanceof Error ? err.message : "Upload failed";
      if (msg === "Upload cancelled") toast.info("Upload cancelled");
      else toast.error("Upload failed", { description: msg });
    },
  });

  const transcribeFn = useServerFn(transcribeProject);
  const transcribe = useMutation({
    mutationFn: () => transcribeFn({ data: { projectId: id } }),
    onSuccess: (res) => {
      invalidateProject();
      toast.success("Transcription complete", {
        description: `${res.characters.toLocaleString()} characters. Ready for analysis.`,
      });
    },
    onError: (err: unknown) => {
      invalidateProject();
      toast.error("Transcription failed", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
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
      toast.success("Project deleted");
      navigate({ to: "/app/projects" });
    },
    onError: (err: unknown) => {
      toast.error("Failed to delete", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    },
  });

  const canTranscribe =
    project?.source === "upload" &&
    !!project?.storage_path &&
    ["draft", "failed"].includes(project?.status ?? "");
  const isUploading = uploadVideo.isPending || project?.status === "uploading";
  const isBusy = transcribe.isPending || project?.status === "transcribing";

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
            {project.storage_path && project.status === "draft" ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-emerald-400">
                <span className="size-1.5 rounded-full bg-current" />
                Video ready
              </span>
            ) : (
              <StatusPill status={project.status as ProjectStatus} />
            )}
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
                  {project.storage_path ? "Video uploaded · ready to transcribe" : "Upload a video to start processing"}
                </div>
              </div>
            </div>
          </div>

          {canTranscribe && (
            <div className="rounded-2xl border border-primary/30 bg-primary/10 p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <div className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground">
                    <CheckCircle2 className="size-5" />
                  </div>
                  <div>
                    <h2 className="text-base font-extrabold">Vídeo enviado</h2>
                    <p className="mt-1 text-sm text-muted-foreground">Clique em transcrever para gerar a base dos cortes.</p>
                  </div>
                </div>
                <Button size="lg" className="rounded-xl font-extrabold" onClick={() => transcribe.mutate()} disabled={isBusy}>
                  <Sparkles className="mr-2 size-4" />
                  {isBusy ? "Transcrevendo…" : "Transcrever vídeo"}
                </Button>
              </div>
            </div>
          )}

          {project.source === "upload" && (
            <VideoUploadPanel
              file={selectedFile}
              hasVideo={!!project.storage_path}
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
            />
          )}

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
          <Meta label="Next step">
            <span className="text-sm">
              {!project.storage_path
                ? "Upload the video"
                : project.status === "draft" || project.status === "failed"
                  ? "Transcribe the video"
                  : "Processing"}
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

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function VideoUploadPanel({
  file,
  hasVideo,
  progress,
  uploading,
  inputRef,
  onPick,
  onClear,
  onCancel,
  onUpload,
}: {
  file: File | null;
  hasVideo: boolean;
  progress: number;
  uploading: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onPick: (f: File | null) => void;
  onClear: () => void;
  onCancel: () => void;
  onUpload: () => void;
}) {
  const [dragging, setDragging] = useState(false);

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold">Vídeo do projeto</h2>
          <p className="text-xs text-muted-foreground">
            {hasVideo ? "Vídeo anexado. Você pode trocar se precisar." : "Selecione o vídeo para avançar."}
          </p>
        </div>
        {hasVideo && (
          <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-primary">
            uploaded
          </span>
        )}
      </div>

      {file ? (
        <div className="rounded-xl border border-border bg-secondary/30 p-4">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-lg bg-primary/15 text-primary">
              <FileVideo className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{file.name}</div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {formatBytes(file.size)}{uploading ? ` · enviando ${progress}%` : " · pronto"}
              </div>
            </div>
            {uploading ? (
              <Button type="button" variant="outline" size="sm" onClick={onCancel} className="border-border bg-transparent">
                Cancelar
              </Button>
            ) : (
              <Button type="button" variant="ghost" size="icon" onClick={onClear} aria-label="Remove file">
                <X className="size-4" />
              </Button>
            )}
          </div>
          {uploading && <Progress value={progress} className="mt-3 h-1.5" />}
          {!uploading && (
            <Button type="button" onClick={onUpload} className="mt-4 rounded-lg font-bold">
              <Upload className="mr-2 size-4" />
              Enviar vídeo
            </Button>
          )}
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
            const dropped = e.dataTransfer.files?.[0];
            if (dropped) onPick(dropped);
          }}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors",
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
            MP4 · MOV · WEBM · MKV — up to 500MB
          </div>
        </label>
      )}
    </div>
  );
}
