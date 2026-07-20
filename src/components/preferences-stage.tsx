import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Loader2,
  Play,
  Save,
  Sparkles,
  User,
  Users,
  Wand2,
  Youtube,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export type ProjectPreferences = {
  caption_template?: CaptionTemplateSlug;
  caption_position?: CaptionPosition;
  layout_mode?: LayoutMode;
  aspect_ratio?: AspectRatio;
};

export type CaptionTemplateSlug = "karaoke-lime" | "bold-yellow" | "minimal-white" | "big-impact";
export type CaptionPosition = "top" | "middle" | "bottom";
export type LayoutMode = "auto" | "full" | "split-h" | "split-v" | "grid-3" | "pip";
export type AspectRatio = "9:16" | "1:1" | "16:9";

const CAPTION_TEMPLATES: {
  slug: CaptionTemplateSlug;
  name: string;
  hint: string;
  className: string;
  activeClassName: string;
}[] = [
  { slug: "karaoke-lime",  name: "Karaokê Lima",  hint: "Palavra ativa em destaque neon",
    className: "text-white font-black uppercase tracking-tight", activeClassName: "text-primary" },
  { slug: "bold-yellow",   name: "Bold Yellow",   hint: "Amarelo cheio, estilo MrBeast",
    className: "text-yellow-300 font-black uppercase tracking-tight [text-shadow:_-2px_-2px_0_#000,2px_-2px_0_#000,-2px_2px_0_#000,2px_2px_0_#000]", activeClassName: "text-white" },
  { slug: "minimal-white", name: "Minimal Branco",hint: "Legenda limpa em caixa preta",
    className: "text-white font-semibold", activeClassName: "text-white" },
  { slug: "big-impact",    name: "Big Impact",    hint: "Palavra por vez, gigante",
    className: "text-white font-black uppercase text-3xl tracking-tighter [text-shadow:_0_4px_12px_rgba(0,0,0,0.9)]", activeClassName: "text-primary" },
];

const LAYOUTS: {
  slug: LayoutMode;
  name: string;
  hint: string;
  icon: typeof User;
  recommended?: boolean;
}[] = [
  { slug: "auto",    name: "IA Recomenda",   hint: "Detecta falantes e escolhe o melhor formato por cena", icon: Wand2, recommended: true },
  { slug: "full",    name: "Full",           hint: "1 pessoa, foco total no rosto",     icon: User },
  { slug: "split-h", name: "Lado a lado",    hint: "2 pessoas, uma ao lado da outra",   icon: Users },
  { slug: "split-v", name: "Empilhado",      hint: "2 pessoas, uma em cima da outra",   icon: Users },
  { slug: "grid-3",  name: "3 no frame",     hint: "3 pessoas em grade dinâmica",       icon: Users },
  { slug: "pip",     name: "PiP",            hint: "Câmera sobre a tela compartilhada", icon: Sparkles },
];

const ASPECTS: { slug: AspectRatio; name: string; hint: string; ratio: string }[] = [
  { slug: "9:16", name: "9:16", hint: "Reels · Shorts · TikTok", ratio: "aspect-[9/16]" },
  { slug: "1:1",  name: "1:1",  hint: "Feed quadrado",           ratio: "aspect-square"  },
  { slug: "16:9", name: "16:9", hint: "YouTube · LinkedIn",      ratio: "aspect-video"   },
];

const POSITIONS: { slug: CaptionPosition; name: string }[] = [
  { slug: "top", name: "Topo" }, { slug: "middle", name: "Meio" }, { slug: "bottom", name: "Base" },
];

const MOCK_WORDS = ["isso","aqui","vai","mudar","sua","forma","de","editar","vídeos","curtos","pra","sempre"];

export function PreferencesStage({
  projectId,
  storagePath,
  youtubeUrl,
  initialPreferences,
  onSaved,
}: {
  projectId: string;
  storagePath: string | null;
  youtubeUrl: string | null;
  initialPreferences: ProjectPreferences;
  onSaved: () => void;
}) {
  const [template, setTemplate] = useState<CaptionTemplateSlug>(initialPreferences.caption_template ?? "karaoke-lime");
  const [position, setPosition] = useState<CaptionPosition>(initialPreferences.caption_position ?? "bottom");
  const [layout, setLayout] = useState<LayoutMode>(initialPreferences.layout_mode ?? "auto");
  const [aspect, setAspect] = useState<AspectRatio>(initialPreferences.aspect_ratio ?? "9:16");
  const [saving, setSaving] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!storagePath) { setVideoUrl(null); return; }
    (async () => {
      const { data } = await supabase.storage.from("videos").createSignedUrl(storagePath, 3600);
      if (!cancelled) setVideoUrl(data?.signedUrl ?? null);
    })();
    return () => { cancelled = true; };
  }, [storagePath]);

  async function handleSave() {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("projects")
        .update({ preferences: {
          caption_template: template,
          caption_position: position,
          layout_mode: layout,
          aspect_ratio: aspect,
        } })
        .eq("id", projectId);
      if (error) throw error;
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  const templateStyle = useMemo(() => CAPTION_TEMPLATES.find((t) => t.slug === template)!, [template]);
  const aspectClass = ASPECTS.find((a) => a.slug === aspect)!.ratio;

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-5">
        <div className="mb-1 font-mono text-xs uppercase tracking-[0.2em] text-primary">// Passo 2 — Preferências</div>
        <h2 className="text-base font-extrabold">Escolha o visual antes de processar</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Deixe a <span className="text-primary font-semibold">IA escolher o formato</span> por cena (2 pessoas → lado a lado, 3 pessoas → grid, etc.), ou trave em um layout fixo. Você define a proporção final.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        {/* Preview */}
        <div className="mx-auto w-full max-w-[300px]">
          <PreviewFrame
            videoUrl={videoUrl}
            youtubeUrl={youtubeUrl}
            layout={layout}
            position={position}
            templateStyle={templateStyle}
            aspectClass={aspectClass}
          />
          <p className="mt-2 text-center font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Preview · {aspect} · legenda simulada
          </p>
        </div>

        {/* Controls */}
        <div className="space-y-5">
          <ControlGroup title="Proporção final (você escolhe)">
            <div className="grid grid-cols-3 gap-2">
              {ASPECTS.map((a) => (
                <button
                  key={a.slug}
                  type="button"
                  onClick={() => setAspect(a.slug)}
                  className={cn(
                    "rounded-xl border p-3 text-left transition-colors",
                    aspect === a.slug ? "border-primary bg-primary/10" : "border-border bg-background/40 hover:border-primary/40",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold">{a.name}</span>
                    {aspect === a.slug && <Check className="size-4 text-primary" />}
                  </div>
                  <span className="mt-0.5 block text-[10px] text-muted-foreground">{a.hint}</span>
                </button>
              ))}
            </div>
          </ControlGroup>

          <ControlGroup title="Distribuição / Composição">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {LAYOUTS.map((l) => {
                const Icon = l.icon;
                const selected = layout === l.slug;
                return (
                  <button
                    key={l.slug}
                    type="button"
                    onClick={() => setLayout(l.slug)}
                    className={cn(
                      "relative flex flex-col items-start rounded-xl border p-3 text-left transition-colors",
                      selected ? "border-primary bg-primary/10" : "border-border bg-background/40 hover:border-primary/40",
                      l.recommended && !selected && "border-primary/50",
                    )}
                  >
                    {l.recommended && (
                      <span className="absolute -top-2 right-2 rounded-full bg-primary px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-primary-foreground">
                        AI
                      </span>
                    )}
                    <Icon className={cn("mb-1 size-4", selected ? "text-primary" : "text-muted-foreground")} />
                    <span className="text-xs font-bold">{l.name}</span>
                    <span className="mt-0.5 text-[10px] leading-tight text-muted-foreground">{l.hint}</span>
                  </button>
                );
              })}
            </div>
            {layout === "auto" && (
              <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-primary/30 bg-primary/5 p-2 text-[11px] text-muted-foreground">
                <Sparkles className="mt-0.5 size-3 shrink-0 text-primary" />
                <span>A IA analisa cada corte, detecta quantas pessoas aparecem e monta a composição ideal automaticamente — split, grid ou full — mantendo a proporção <span className="font-mono text-primary">{aspect}</span>.</span>
              </p>
            )}
          </ControlGroup>

          <ControlGroup title="Template de legenda">
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
                  <span className="mt-0.5 text-[11px] text-muted-foreground">{tpl.hint}</span>
                </button>
              ))}
            </div>
          </ControlGroup>

          <ControlGroup title="Posição da legenda">
            <div className="flex gap-2">
              {POSITIONS.map((p) => (
                <button
                  key={p.slug}
                  type="button"
                  onClick={() => setPosition(p.slug)}
                  className={cn(
                    "flex-1 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors",
                    position === p.slug ? "border-primary bg-primary/10 text-primary" : "border-border bg-background/40 hover:border-primary/40",
                  )}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </ControlGroup>

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={saving} className="rounded-lg font-bold">
              {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}
              Salvar preferências
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ControlGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

function PreviewFrame({
  videoUrl,
  youtubeUrl,
  layout,
  position,
  templateStyle,
  aspectClass,
}: {
  videoUrl: string | null;
  youtubeUrl: string | null;
  layout: LayoutMode;
  position: CaptionPosition;
  templateStyle: typeof CAPTION_TEMPLATES[number];
  aspectClass: string;
}) {
  const [wordIdx, setWordIdx] = useState(0);
  const [autoCycle, setAutoCycle] = useState(0); // rotates the "AI-picked" layout in preview
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const id = setInterval(() => setWordIdx((i) => (i + 1) % MOCK_WORDS.length), 380);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (layout !== "auto") return;
    const id = setInterval(() => setAutoCycle((i) => (i + 1) % 4), 1800);
    return () => clearInterval(id);
  }, [layout]);

  const captionAlign = position === "top" ? "items-start pt-6" : position === "middle" ? "items-center" : "items-end pb-8";
  const visibleWords = MOCK_WORDS.slice(Math.max(0, wordIdx - 2), wordIdx + 3);

  const youtubeEmbed = useMemo(() => {
    if (!youtubeUrl) return null;
    try {
      const u = new URL(youtubeUrl);
      const id = u.hostname.includes("youtu.be") ? u.pathname.slice(1) : u.searchParams.get("v");
      if (!id) return null;
      return `https://www.youtube.com/embed/${id}?autoplay=1&mute=1&controls=0&loop=1&playlist=${id}&modestbranding=1&playsinline=1`;
    } catch { return null; }
  }, [youtubeUrl]);

  const mediaLayer = (
    <div className="absolute inset-0">
      {videoUrl ? (
        <video ref={videoRef} src={videoUrl} className="h-full w-full object-cover" autoPlay muted loop playsInline />
      ) : youtubeEmbed ? (
        <iframe src={youtubeEmbed} className="h-full w-full scale-[1.8] object-cover" allow="autoplay; encrypted-media" title="preview" />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-secondary via-background to-secondary text-muted-foreground">
          {youtubeUrl ? <Youtube className="size-8" /> : <Play className="size-8" />}
          <span className="font-mono text-[10px] uppercase tracking-widest">sem fonte</span>
        </div>
      )}
    </div>
  );

  const speakerTile = (label: string) => (
    <div className="relative h-full w-full overflow-hidden bg-secondary">
      <div className="grid h-full place-items-center text-muted-foreground">
        <div className="text-center">
          <User className="mx-auto mb-1 size-5" />
          <div className="font-mono text-[10px] uppercase tracking-widest">{label}</div>
        </div>
      </div>
    </div>
  );

  // Which layout do we actually render? "auto" cycles through options for preview
  const effectiveLayout: Exclude<LayoutMode, "auto"> =
    layout === "auto"
      ? (["full", "split-h", "split-v", "grid-3"] as const)[autoCycle]
      : layout;

  return (
    <div className={cn("relative w-full overflow-hidden rounded-2xl border border-border bg-black shadow-2xl", aspectClass)}>
      {effectiveLayout === "full" && mediaLayer}

      {effectiveLayout === "split-h" && (
        <div className="absolute inset-0 grid grid-cols-2 gap-0.5 bg-primary/40">
          <div className="relative overflow-hidden">{mediaLayer}</div>
          {speakerTile("Falante 2")}
        </div>
      )}

      {effectiveLayout === "split-v" && (
        <div className="absolute inset-0 grid grid-rows-2 gap-0.5 bg-primary/40">
          <div className="relative overflow-hidden">{mediaLayer}</div>
          {speakerTile("Falante 2")}
        </div>
      )}

      {effectiveLayout === "grid-3" && (
        <div className="absolute inset-0 grid grid-rows-2 gap-0.5 bg-primary/40">
          <div className="relative overflow-hidden">{mediaLayer}</div>
          <div className="grid grid-cols-2 gap-0.5">
            {speakerTile("Falante 2")}
            {speakerTile("Falante 3")}
          </div>
        </div>
      )}

      {effectiveLayout === "pip" && (
        <>
          {mediaLayer}
          <div className="absolute right-3 top-3 h-24 w-24 overflow-hidden rounded-xl border-2 border-primary bg-secondary shadow-lg">
            <div className="grid h-full place-items-center text-muted-foreground"><User className="size-6" /></div>
          </div>
        </>
      )}

      {/* AI badge when in auto */}
      {layout === "auto" && (
        <div className="absolute left-2 top-2 flex items-center gap-1 rounded-full border border-primary/60 bg-black/70 px-2 py-0.5 backdrop-blur">
          <Wand2 className="size-3 text-primary" />
          <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-primary">AI · {effectiveLayout}</span>
        </div>
      )}

      {/* Caption overlay */}
      <div className={cn("pointer-events-none absolute inset-0 flex justify-center px-4", captionAlign)}>
        <div className={cn("flex max-w-[240px] flex-wrap items-baseline justify-center gap-x-1.5 gap-y-1 text-center text-lg leading-tight", templateStyle.className, templateStyle.slug === "minimal-white" && "rounded-md bg-black/70 px-3 py-1.5")}>
          {visibleWords.map((word, i) => {
            const isActive = i === Math.min(2, wordIdx);
            return (
              <span key={`${word}-${i}`} className={cn("transition-colors duration-150", isActive && templateStyle.activeClassName, !isActive && "opacity-60")}>
                {word}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
