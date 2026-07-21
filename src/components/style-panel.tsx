import { useState } from "react";
import { Check, ChevronDown, ChevronUp, Loader2, Save, Sparkles } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CaptionPresetCard } from "@/components/caption-preset-card";
import { ClipPreview } from "@/components/clip-preview";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  ASPECTS,
  CAPTION_TEMPLATES,
  DEFAULT_TEMPLATE_SLUG,
  LAYOUTS,
  type ProjectPreferences,
  type AspectRatio,
  type LayoutMode,
} from "@/lib/caption-templates";
import type { TranscriptSegment } from "@/lib/projects";


type Props = {
  projectId: string;
  preferences: ProjectPreferences;
  source: "upload" | "youtube";
  videoUrl: string | null;
  youtubeUrl: string | null;
  sampleStart: number;
  sampleEnd: number;
  segments: TranscriptSegment[];
  startCollapsed?: boolean;
};

/**
 * Global style panel — one place to set caption template, aspect ratio, layout.
 * Applies to every clip in the project (unless a clip has its own override).
 */
export function StylePanel({
  projectId,
  preferences,
  source,
  videoUrl,
  youtubeUrl,
  sampleStart,
  sampleEnd,
  segments,
  startCollapsed = false,
}: Props) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(!startCollapsed);
  const [template, setTemplate] = useState(preferences.caption_template ?? DEFAULT_TEMPLATE_SLUG);
  const [aspect, setAspect] = useState<AspectRatio>(preferences.aspect_ratio ?? "9:16");
  const [layout, setLayout] = useState<LayoutMode>(preferences.layout_mode ?? "auto");

  const dirty =
    template !== (preferences.caption_template ?? DEFAULT_TEMPLATE_SLUG) ||
    aspect !== (preferences.aspect_ratio ?? "9:16") ||
    layout !== (preferences.layout_mode ?? "auto");

  const save = useMutation({
    mutationFn: async () => {
      const next: ProjectPreferences = {
        ...preferences,
        caption_template: template,
        aspect_ratio: aspect,
        layout_mode: layout,
      };
      const { error } = await supabase
        .from("projects")
        .update({ preferences: next })
        .eq("id", projectId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects", projectId] });
      qc.invalidateQueries({ queryKey: ["projects", projectId, "clips"] });
      void 0;
    },
    onError: (err: unknown) =>
      toast.error("Não consegui salvar", { description: err instanceof Error ? err.message : "" }),
  });

  const aspectClass = ASPECTS.find((a) => a.slug === aspect)?.className ?? "aspect-[9/16]";
  const currentTpl = CAPTION_TEMPLATES.find((t) => t.slug === template)?.name ?? "—";
  const currentLayout = LAYOUTS.find((l) => l.slug === layout)?.label ?? "—";

  if (!open) {
    return (
      <div className="flex items-center justify-between rounded-2xl border border-border bg-card px-5 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <span className="text-sm font-bold">Estilo global</span>
          <span className="font-mono text-[11px] text-muted-foreground">
            {currentTpl} · {aspect} · {currentLayout}
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          Editar estilo <ChevronDown className="ml-1 size-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <div className="mb-1 font-mono text-xs uppercase tracking-[0.2em] text-primary">// Estilo global</div>
          <h2 className="text-base font-extrabold">Uma vez só — aplica em todos os cortes</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Legenda, proporção e composição do projeto. Cada corte pode ter override no editor.
          </p>
        </div>
        {startCollapsed && (
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Recolher <ChevronUp className="ml-1 size-4" />
          </Button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        {/* Preview */}
        <div>
          <ClipPreview
            source={source}
            videoUrl={videoUrl}
            youtubeUrl={youtubeUrl}
            startSeconds={sampleStart}
            endSeconds={sampleEnd}
            segments={segments}
            templateSlug={template}
            autoPlayOnHover
            aspectClass={aspectClass}
          />
          <p className="mt-2 text-center font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            hover para tocar
          </p>
        </div>

        <div className="space-y-5">
          <Section title="Proporção">
            <div className="grid grid-cols-3 gap-2">
              {ASPECTS.map((a) => (
                <button
                  key={a.slug}
                  type="button"
                  onClick={() => setAspect(a.slug)}
                  className={cn(
                    "rounded-xl border p-3 text-left transition-colors",
                    aspect === a.slug
                      ? "border-primary bg-primary/10"
                      : "border-border bg-background/40 hover:border-primary/40",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold">{a.label}</span>
                    {aspect === a.slug && <Check className="size-4 text-primary" />}
                  </div>
                  <span className="mt-0.5 block text-[10px] text-muted-foreground">{a.hint}</span>
                </button>
              ))}
            </div>
          </Section>

          <Section title="Composição">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {LAYOUTS.map((l) => {
                const selected = layout === l.slug;
                return (
                  <button
                    key={l.slug}
                    type="button"
                    onClick={() => setLayout(l.slug)}
                    className={cn(
                      "flex flex-col items-start rounded-xl border p-3 text-left transition-colors",
                      selected ? "border-primary bg-primary/10" : "border-border bg-background/40 hover:border-primary/40",
                    )}
                  >
                    <span className="text-xs font-bold">{l.label}</span>
                    <span className="mt-0.5 text-[10px] leading-tight text-muted-foreground">{l.hint}</span>
                  </button>
                );
              })}
            </div>
          </Section>

          <Section title="Legenda animada">
            <div className="grid grid-cols-2 gap-2">
              {CAPTION_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.slug}
                  type="button"
                  onClick={() => setTemplate(tpl.slug)}
                  className={cn(
                    "flex flex-col items-start rounded-xl border p-3 text-left transition-colors",
                    template === tpl.slug ? "border-primary bg-primary/10" : "border-border bg-background/40 hover:border-primary/40",
                  )}
                >
                  <div className="flex w-full items-center justify-between">
                    <span className="text-sm font-bold">{tpl.name}</span>
                    {template === tpl.slug && <Check className="size-4 text-primary" />}
                  </div>
                  <span className="mt-0.5 text-[11px] text-muted-foreground">{tpl.description}</span>
                </button>
              ))}
            </div>
          </Section>

          <div className="flex justify-end gap-2">
            <Button
              onClick={() => save.mutate()}
              disabled={!dirty || save.isPending}
              className="rounded-lg font-bold"
            >
              {save.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}
              {dirty ? "Aplicar em todos os cortes" : "Salvo"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}
