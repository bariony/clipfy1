import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertCircle, Download, Edit3, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ClipPreview } from "@/components/clip-preview";
import { cn } from "@/lib/utils";
import {
  formatDuration,
  isRenderJobStuck,
  isSupersededRenderJob,
  latestRenderJobQueryOptions,
  type Clip,
  type TranscriptSegment,
} from "@/lib/projects";
import { enqueueClipRender } from "@/lib/render.functions";

type Props = {
  clip: Clip;
  source: "upload" | "youtube";
  videoUrl: string | null;
  youtubeUrl: string | null;
  segments: TranscriptSegment[];
  templateSlug: string;
  onEdit: () => void;
};

export function ClipCard({
  clip,
  source,
  videoUrl,
  youtubeUrl,
  segments,
  templateSlug,
  onEdit,
}: Props) {
  const qc = useQueryClient();
  const { data: renderJob } = useQuery(latestRenderJobQueryOptions(clip.id));
  const downloadUrl = clip.render_url ?? renderJob?.output_url ?? null;
  const superseded = renderJob ? isSupersededRenderJob(renderJob) : false;
  const ready = Boolean(downloadUrl) && (clip.status === "ready" || renderJob?.status === "completed");
  const stuck = !ready && renderJob && !superseded ? isRenderJobStuck(renderJob) : false;
  const rendering = !superseded && !stuck && (renderJob?.status === "queued" || renderJob?.status === "processing");
  const failed = !ready && !superseded && (renderJob?.status === "failed" || stuck);
  const score = clip.virality_score;

  const perClipTemplate = (clip.metadata as { template_slug?: string } | null)?.template_slug;
  const effectiveTemplate = perClipTemplate ?? templateSlug;

  const start = Number(clip.start_seconds);
  const end = Number(clip.end_seconds);
  const duration = Math.max(0, end - start);

  // Auto-render: se não existe job (null) OU tá stuck, dispara UMA vez.
  // Se falhou (worker offline etc.), NÃO auto-retry — mostra botão manual.
  const enqueueRender = useServerFn(enqueueClipRender);
  const autoRender = useMutation({
    mutationFn: () => enqueueRender({ data: { clipId: clip.id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["render-job", clip.id] });
    },
  });
  const kickedRef = useRef(false);
  useEffect(() => {
    if (kickedRef.current) return;
    if (ready) return;
    if (renderJob === undefined) return; // ainda carregando
    if (renderJob === null || superseded || stuck) {
      kickedRef.current = true;
      autoRender.mutate();
    }
  }, [renderJob, superseded, stuck, ready, autoRender]);

  const progress = Math.max(0, Math.min(100, renderJob?.progress ?? 0));
  const errorMsg = superseded ? null : renderJob?.error_message ?? null;
  const statusLabel = failed
    ? "Falha na renderização"
    : renderJob?.status === "processing"
      ? `Renderizando ${progress}%`
      : renderJob?.status === "queued"
        ? "Na fila…"
        : autoRender.isPending
          ? "Enfileirando…"
          : "Preparando…";

  return (
    <div className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-colors hover:border-primary/40">
      <div className="relative">
        <ClipPreview
          source={source}
          videoUrl={videoUrl}
          youtubeUrl={youtubeUrl}
          startSeconds={start}
          endSeconds={end}
          segments={segments}
          templateSlug={effectiveTemplate}
          autoPlayOnHover
          aspectClass="aspect-[9/16]"
          renderedUrl={ready ? downloadUrl : null}
        />

        {score != null && (
          <div
            className={cn(
              "absolute left-2 top-2 flex items-center gap-1 rounded-full border px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider backdrop-blur",
              score >= 75
                ? "border-primary/50 bg-primary/20 text-primary"
                : score >= 50
                  ? "border-yellow-400/50 bg-yellow-400/20 text-yellow-300"
                  : "border-border bg-black/60 text-muted-foreground",
            )}
          >
            <Sparkles className="size-3" />
            Viral {score}/100
          </div>
        )}

        <div className="absolute right-2 top-2 rounded-full border border-border bg-black/70 px-2 py-0.5 font-mono text-[10px] text-white backdrop-blur">
          {formatDuration(duration)}
        </div>

        {/* Overlay de status com barra de progresso */}
        {!ready && !failed && (rendering || autoRender.isPending || renderJob === null) && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-1.5 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-3 pb-3 pt-10">
            <div className="flex items-center justify-between text-[11px] font-semibold text-white">
              <span className="flex items-center gap-1.5">
                <Loader2 className="size-3 animate-spin" />
                {statusLabel}
              </span>
              {renderJob?.status === "processing" && (
                <span className="font-mono tabular-nums text-white/80">{progress}%</span>
              )}
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-white/15">
              <div
                className={cn(
                  "h-full rounded-full bg-primary transition-[width] duration-500 ease-out",
                  renderJob?.status !== "processing" && "animate-pulse",
                )}
                style={{ width: `${renderJob?.status === "processing" ? progress : 8}%` }}
              />
            </div>
          </div>
        )}

        {/* Overlay de falha */}
        {failed && (
          <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-gradient-to-t from-black/95 via-black/75 to-transparent px-3 pb-3 pt-10">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-destructive">
              <AlertCircle className="size-3" />
              Falha na renderização
            </div>
            {errorMsg && (
              <p className="line-clamp-2 text-[10px] text-white/70">{errorMsg}</p>
            )}
          </div>
        )}
      </div>


      <div className="flex flex-1 flex-col p-3">
        <h3 className="mb-1 line-clamp-2 text-sm font-bold leading-snug">{clip.title}</h3>
        {clip.hook && <p className="mb-3 line-clamp-2 text-xs text-muted-foreground">{clip.hook}</p>}

        <div className="mt-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="border-border bg-transparent"
            onClick={onEdit}
          >
            <Edit3 className="size-3.5" />
          </Button>
          {failed ? (
            <Button
              size="sm"
              variant="outline"
              className="flex-1 border-destructive/40 bg-transparent font-bold text-destructive hover:bg-destructive/10"
              disabled={autoRender.isPending}
              onClick={() => {
                kickedRef.current = true;
                autoRender.mutate();
              }}
            >
              {autoRender.isPending ? (
                <>
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" /> Reenviando…
                </>
              ) : (
                <>
                  <RefreshCw className="mr-1.5 size-3.5" /> Tentar de novo
                </>
              )}
            </Button>
          ) : (
            <Button
              size="sm"
              className="flex-1 font-bold"
              disabled={!ready || !downloadUrl}
              onClick={async () => {
                if (!downloadUrl) return;
                try {
                  const res = await fetch(downloadUrl);
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `clipfy-${clip.id}.mp4`;
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                } catch {
                  window.open(downloadUrl, "_blank");
                }
              }}
            >
              {ready ? (
                <>
                  <Download className="mr-1.5 size-3.5" /> Baixar MP4
                </>
              ) : (
                <>
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" /> {statusLabel}
                </>
              )}
            </Button>
          )}
        </div>
      </div>

    </div>
  );
}
