import { useQuery } from "@tanstack/react-query";
import { Download, Edit3, Film, Loader2, Sparkles, Upload, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ClipPreview } from "@/components/clip-preview";
import { cn } from "@/lib/utils";
import {
  formatDuration,
  isRenderJobStuck,
  latestRenderJobQueryOptions,
  type Clip,
  type TranscriptSegment,
} from "@/lib/projects";
import { isScenePlan } from "@/lib/scene-plan";

type Props = {
  clip: Clip;
  source: "upload" | "youtube";
  videoUrl: string | null;
  youtubeUrl: string | null;
  segments: TranscriptSegment[];
  templateSlug: string;
  onEdit: () => void;
  onExport: () => void;
  exporting: boolean;
};

export function ClipCard({
  clip,
  source,
  videoUrl,
  youtubeUrl,
  segments,
  templateSlug,
  onEdit,
  onExport,
  exporting,
}: Props) {
  const { data: renderJob } = useQuery(latestRenderJobQueryOptions(clip.id));
  const stuck = renderJob ? isRenderJobStuck(renderJob) : false;
  const rendering = !stuck && (renderJob?.status === "queued" || renderJob?.status === "processing");
  const ready = renderJob?.status === "completed" && (clip.render_url || renderJob.output_url);
  const downloadUrl = clip.render_url ?? renderJob?.output_url ?? null;
  const score = clip.virality_score;

  const perClipTemplate = (clip.metadata as { template_slug?: string } | null)?.template_slug;
  const effectiveTemplate = perClipTemplate ?? templateSlug;

  const start = Number(clip.start_seconds);
  const end = Number(clip.end_seconds);
  const duration = Math.max(0, end - start);

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
        />

        {/* Score badge */}
        {score != null && (
          <div
            className={cn(
              "absolute left-2 top-2 flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider backdrop-blur",
              score >= 75
                ? "border-primary/50 bg-primary/20 text-primary"
                : score >= 50
                  ? "border-yellow-400/50 bg-yellow-400/20 text-yellow-300"
                  : "border-border bg-black/60 text-muted-foreground",
            )}
          >
            <Sparkles className="size-3" />
            {score}
          </div>
        )}

        {/* Duration */}
        <div className="absolute right-2 top-2 rounded-full border border-border bg-black/70 px-2 py-0.5 font-mono text-[10px] text-white backdrop-blur">
          {formatDuration(duration)}
        </div>
      </div>

      <div className="flex flex-1 flex-col p-3">
        <h3 className="mb-1 line-clamp-2 text-sm font-bold leading-snug">{clip.title}</h3>
        {clip.hook && <p className="mb-3 line-clamp-2 text-xs text-muted-foreground">{clip.hook}</p>}

        <div className="mt-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 border-border bg-transparent"
            onClick={onEdit}
          >
            <Edit3 className="mr-1.5 size-3.5" /> Editar
          </Button>
          {ready && downloadUrl ? (
            <Button
              size="sm"
              className="flex-1 font-bold"
              onClick={async () => {
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
              <Download className="mr-1.5 size-3.5" /> Baixar
            </Button>
          ) : (
            <Button
              size="sm"
              className="flex-1 font-bold"
              onClick={onExport}
              disabled={exporting || rendering}
            >
              {exporting || rendering ? (
                <>
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                  {renderJob?.status === "processing"
                    ? `${renderJob.progress ?? 0}%`
                    : "Fila…"}
                </>
              ) : (
                <>
                  <Upload className="mr-1.5 size-3.5" /> {stuck ? "Tentar" : "Exportar"}
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
