import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, RefreshCw, Save, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ClipPreview } from "@/components/clip-preview";
import { SceneTimeline } from "@/components/scene-timeline";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { CAPTION_TEMPLATES } from "@/lib/caption-templates";
import { formatDuration, type Clip, type TranscriptSegment } from "@/lib/projects";
import { isScenePlan, LAYOUT_LABEL } from "@/lib/scene-plan";
import { regenerateScenePlan } from "@/lib/scene-plan.functions";
import { enqueueClipRender } from "@/lib/render.functions";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clip: Clip | null;
  projectId: string;
  source: "upload" | "youtube";
  videoUrl: string | null;
  youtubeUrl: string | null;
  segments: TranscriptSegment[];
  projectTemplate: string;
};

export function EditClipDrawer({
  open,
  onOpenChange,
  clip,
  projectId,
  source,
  videoUrl,
  youtubeUrl,
  segments,
  projectTemplate,
}: Props) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(clip?.title ?? "");
  const [trim, setTrim] = useState<[number, number]>([
    Number(clip?.start_seconds ?? 0),
    Number(clip?.end_seconds ?? 0),
  ]);
  const [overrideSlug, setOverrideSlug] = useState<string | null>(
    (clip?.metadata as { template_slug?: string } | null)?.template_slug ?? null,
  );
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (!clip) return;
    setTitle(clip.title);
    setTrim([Number(clip.start_seconds), Number(clip.end_seconds)]);
    setOverrideSlug((clip.metadata as { template_slug?: string } | null)?.template_slug ?? null);
    setShowAdvanced(false);
  }, [clip?.id]);

  const effectiveTemplate = overrideSlug ?? projectTemplate;

  const save = useMutation({
    mutationFn: async () => {
      if (!clip) return;
      const meta = { ...((clip.metadata as object) ?? {}), template_slug: overrideSlug ?? undefined };
      const { error } = await supabase
        .from("clips")
        .update({
          title,
          start_seconds: trim[0],
          end_seconds: trim[1],
          metadata: meta as never,
        })
        .eq("id", clip.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects", projectId, "clips"] });
      qc.invalidateQueries({ queryKey: ["clip", clip?.id] });
      void 0;
      onOpenChange(false);
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : "Falha ao salvar"),
  });

  const regenScenePlanFn = useServerFn(regenerateScenePlan);
  const regenScenePlan = useMutation({
    mutationFn: () => {
      if (!clip) throw new Error("no clip");
      return regenScenePlanFn({ data: { clipId: clip.id } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects", projectId, "clips"] });
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Falha ao gerar plano de cenas"),
  });

  const enqueueRenderFn = useServerFn(enqueueClipRender);
  const rerender = useMutation({
    mutationFn: () => {
      if (!clip) throw new Error("no clip");
      return enqueueRenderFn({ data: { clipId: clip.id } });
    },
    onSuccess: () => {
      toast.success("Render enviado. Acompanhe no card do corte.");
      qc.invalidateQueries({ queryKey: ["render-job", clip?.id] });
      qc.invalidateQueries({ queryKey: ["projects", projectId, "clips"] });
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Falha ao enviar render"),
  });

  if (!clip) return null;

  const scenePlan = isScenePlan(clip.scene_plan) ? clip.scene_plan : null;
  const clipDurationOriginal = Math.max(1, Number(clip.end_seconds) - Number(clip.start_seconds));
  const maxTrim = Math.max(Number(clip.end_seconds) + 30, 300);
  const clipLen = Math.max(0, trim[1] - trim[0]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Editar corte</SheetTitle>
          <SheetDescription>Ajustes finos para este corte específico.</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-5">
          <div className="mx-auto max-w-[260px]">
            <ClipPreview
              source={source}
              videoUrl={videoUrl}
              youtubeUrl={youtubeUrl}
              startSeconds={trim[0]}
              endSeconds={trim[1]}
              segments={segments}
              templateSlug={effectiveTemplate}
              autoPlayOnHover
              aspectClass="aspect-[9/16]"
            />
          </div>

          <div>
            <Label htmlFor="edit-title" className="mb-1.5 block text-sm font-bold">Título</Label>
            <Input id="edit-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label className="text-sm font-bold">Trim ({formatDuration(clipLen)})</Label>
              <span className="font-mono text-[11px] text-muted-foreground">
                {formatDuration(trim[0])} → {formatDuration(trim[1])}
              </span>
            </div>
            <Slider
              value={[trim[0], trim[1]]}
              min={0}
              max={maxTrim}
              step={0.1}
              onValueChange={(v) => {
                if (v.length !== 2) return;
                const a = Math.min(v[0], v[1]);
                const b = Math.max(v[0], v[1]);
                if (b - a < 1) return;
                setTrim([a, b]);
              }}
            />
          </div>

          {/* Scene plan — edição dinâmica */}
          <div className="rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/5 p-3">
            <div className="mb-2 flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-semibold">Edição dinâmica (Scene Plan)</div>
                <div className="text-[11px] text-muted-foreground">
                  {scenePlan
                    ? `${scenePlan.scenes.length} cenas · ${scenePlan.speakers.length} falante(s) detectado(s) via IA`
                    : "A IA divide o corte em cenas e alterna layouts como um editor profissional."}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 border-fuchsia-500/40 bg-transparent"
                onClick={() => regenScenePlan.mutate()}
                disabled={regenScenePlan.isPending}
              >
                {regenScenePlan.isPending ? (
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                ) : (
                  <Wand2 className="mr-1.5 size-3.5" />
                )}
                {scenePlan ? "Regerar" : "Gerar"}
              </Button>
            </div>

            {scenePlan ? (
              <>
                <SceneTimeline plan={scenePlan} duration={clipDurationOriginal} />
                <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {scenePlan.scenes.slice(0, 12).map((s, i) => (
                    <div
                      key={i}
                      className="rounded-md border border-border bg-background/40 px-2 py-1.5 text-[10px]"
                    >
                      <div className="font-mono text-muted-foreground">
                        {s.t.toFixed(1)}s → {(s.t + s.dur).toFixed(1)}s
                      </div>
                      <div className="mt-0.5 font-bold text-foreground">
                        {LAYOUT_LABEL[s.layout]}
                        {s.focus ? ` · ${s.focus}` : ""}
                      </div>
                      {s.beat && (
                        <div className="text-[9px] italic text-muted-foreground">{s.beat}</div>
                      )}
                    </div>
                  ))}
                </div>
                <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-[10px] text-amber-200/90">
                  ⚡ Preview do plano acima. O render dinâmico (worker aplicando layouts em cada cena) chega na próxima sessão.
                </div>
              </>
            ) : (
              <div className="rounded-md border border-dashed border-border bg-background/40 p-3 text-center text-[11px] text-muted-foreground">
                Sem plano ainda. Clique <span className="font-bold text-foreground">Gerar</span> para
                a IA analisar falantes e beats.
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border bg-card/40 p-3">
            <button
              type="button"
              onClick={() => setShowAdvanced((s) => !s)}
              className="flex w-full items-center justify-between text-left"
            >
              <div>
                <div className="text-sm font-semibold">Legenda deste corte</div>
                <div className="text-[11px] text-muted-foreground">
                  {overrideSlug ? `Override: ${overrideSlug}` : "Usando estilo do projeto"}
                </div>
              </div>
              <span className="font-mono text-[10px] uppercase tracking-widest text-primary">
                {showAdvanced ? "fechar" : "avançado"}
              </span>
            </button>

            {showAdvanced && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setOverrideSlug(null)}
                  className={cn(
                    "rounded-lg border p-2 text-left text-xs",
                    overrideSlug === null
                      ? "border-primary bg-primary/10"
                      : "border-border bg-background/40",
                  )}
                >
                  <div className="font-bold">Padrão do projeto</div>
                  <div className="text-[10px] text-muted-foreground">
                    {CAPTION_TEMPLATES.find((t) => t.slug === projectTemplate)?.name}
                  </div>
                </button>
                {CAPTION_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.slug}
                    type="button"
                    onClick={() => setOverrideSlug(tpl.slug)}
                    className={cn(
                      "rounded-lg border p-2 text-left text-xs",
                      overrideSlug === tpl.slug
                        ? "border-primary bg-primary/10"
                        : "border-border bg-background/40 hover:border-primary/40",
                    )}
                  >
                    <div className="font-bold">{tpl.name}</div>
                    <div className="text-[10px] text-muted-foreground">{tpl.description}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <SheetFooter className="mt-6 flex-row justify-end gap-2 sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending} className="font-bold">
            {save.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}
            Salvar
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
