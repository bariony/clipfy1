import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, Play, Save, Sparkles, User, Users, Youtube } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export type ProjectPreferences = {
  caption_template?: CaptionTemplateSlug;
  caption_position?: CaptionPosition;
  layout_mode?: LayoutMode;
};

export type CaptionTemplateSlug = "karaoke-lime" | "bold-yellow" | "minimal-white" | "big-impact";
export type CaptionPosition = "top" | "middle" | "bottom";
export type LayoutMode = "full" | "split" | "pip";

const CAPTION_TEMPLATES: {
  slug: CaptionTemplateSlug;
  name: string;
  hint: string;
  className: string;
  activeClassName: string;
}[] = [
  {
    slug: "karaoke-lime",
    name: "Karaokê Lima",
    hint: "Palavra ativa em destaque neon",
    className: "text-white font-black uppercase tracking-tight",
    activeClassName: "text-primary",
  },
  {
    slug: "bold-yellow",
    name: "Bold Yellow",
    hint: "Amarelo cheio, estilo MrBeast",
    className: "text-yellow-300 font-black uppercase tracking-tight [text-shadow:_-2px_-2px_0_#000,2px_-2px_0_#000,-2px_2px_0_#000,2px_2px_0_#000]",
    activeClassName: "text-white",
  },
  {
    slug: "minimal-white",
    name: "Minimal Branco",
    hint: "Legenda limpa em caixa preta",
    className: "text-white font-semibold",
    activeClassName: "text-white",
  },
  {
    slug: "big-impact",
    name: "Big Impact",
    hint: "Palavra por vez, gigante",
    className: "text-white font-black uppercase text-3xl tracking-tighter [text-shadow:_0_4px_12px_rgba(0,0,0,0.9)]",
    activeClassName: "text-primary",
  },
];

const LAYOUTS: { slug: LayoutMode; name: string; hint: string; icon: typeof User }[] = [
  { slug: "full", name: "9:16 Full", hint: "Foco no apresentador", icon: User },
  { slug: "split", name: "Split-screen", hint: "2 falantes em cima/baixo", icon: Users },
  { slug: "pip", name: "Picture-in-picture", hint: "Câmera sobre tela", icon: Sparkles },
];

const POSITIONS: { slug: CaptionPosition; name: string }[] = [
  { slug: "top", name: "Topo" },
  { slug: "middle", name: "Meio" },
  { slug: "bottom", name: "Base" },
];

// Fake caption timeline (~10s loop) used for the preview
const MOCK_WORDS = [
  "isso", "aqui", "vai", "mudar", "sua", "forma", "de", "editar", "vídeos", "curtos", "pra", "sempre",
];

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
  const [layout, setLayout] = useState<LayoutMode>(initialPreferences.layout_mode ?? "full");
  const [saving, setSaving] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!storagePath) {
      setVideoUrl(null);
      return;
    }
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
        .update({ preferences: { caption_template: template, caption_position: position, layout_mode: layout } })
        .eq("id", projectId);
      if (error) throw error;
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  const templateStyle = useMemo(() => CAPTION_TEMPLATES.find((t) => t.slug === template)!, [template]);

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-5">
        <div className="mb-1 font-mono text-xs uppercase tracking-[0.2em] text-primary">// Passo 2 — Preferências</div>
        <h2 className="text-base font-extrabold">Escolha o visual antes de processar</h2>
        <p className="mt-1 text-sm text-muted-foreground">Preview real do seu vídeo com legenda simulada. A IA vai usar essas escolhas como padrão em todos os cortes.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        {/* Preview 9:16 */}
        <div className="mx-auto w-full max-w-[280px]">
          <PreviewFrame
            videoUrl={videoUrl}
            youtubeUrl={youtubeUrl}
            layout={layout}
            position={position}
            templateStyle={templateStyle}
          />
          <p className="mt-2 text-center font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Preview · legenda simulada
          </p>
        </div>

        {/* Controls */}
        <div className="space-y-5">
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

          <ControlGroup title="Formato do vídeo">
            <div className="grid grid-cols-3 gap-2">
              {LAYOUTS.map((l) => {
                const Icon = l.icon;
                return (
                  <button
                    key={l.slug}
                    type="button"
                    onClick={() => setLayout(l.slug)}
                    className={cn(
                      "flex flex-col items-center rounded-xl border p-3 text-center transition-colors",
                      layout === l.slug ? "border-primary bg-primary/10" : "border-border bg-background/40 hover:border-primary/40",
                    )}
                  >
                    <Icon className={cn("mb-1 size-4", layout === l.slug ? "text-primary" : "text-muted-foreground")} />
                    <span className="text-xs font-bold">{l.name}</span>
                    <span className="mt-0.5 text-[10px] text-muted-foreground">{l.hint}</span>
                  </button>
                );
              })}
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
}: {
  videoUrl: string | null;
  youtubeUrl: string | null;
  layout: LayoutMode;
  position: CaptionPosition;
  templateStyle: typeof CAPTION_TEMPLATES[number];
}) {
  const [wordIdx, setWordIdx] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Cycle mock words for karaoke preview
  useEffect(() => {
    const id = setInterval(() => setWordIdx((i) => (i + 1) % MOCK_WORDS.length), 380);
    return () => clearInterval(id);
  }, []);

  const captionAlign = position === "top" ? "items-start pt-6" : position === "middle" ? "items-center" : "items-end pb-8";
  const visibleWords = MOCK_WORDS.slice(Math.max(0, wordIdx - 2), wordIdx + 3);

  const youtubeEmbed = useMemo(() => {
    if (!youtubeUrl) return null;
    try {
      const u = new URL(youtubeUrl);
      const id = u.hostname.includes("youtu.be") ? u.pathname.slice(1) : u.searchParams.get("v");
      if (!id) return null;
      return `https://www.youtube.com/embed/${id}?autoplay=1&mute=1&controls=0&loop=1&playlist=${id}&modestbranding=1&playsinline=1`;
    } catch {
      return null;
    }
  }, [youtubeUrl]);

  const mediaLayer = (
    <div className="absolute inset-0">
      {videoUrl ? (
        <video ref={videoRef} src={videoUrl} className="h-full w-full object-cover" autoPlay muted loop playsInline />
      ) : youtubeEmbed ? (
        <iframe
          src={youtubeEmbed}
          className="h-full w-full scale-[1.8] object-cover"
          allow="autoplay; encrypted-media"
          title="preview"
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-secondary via-background to-secondary text-muted-foreground">
          {youtubeUrl ? <Youtube className="size-8" /> : <Play className="size-8" />}
          <span className="font-mono text-[10px] uppercase tracking-widest">sem fonte</span>
        </div>
      )}
    </div>
  );

  return (
    <div className="relative aspect-[9/16] w-full overflow-hidden rounded-2xl border border-border bg-black shadow-2xl">
      {layout === "full" && mediaLayer}
      {layout === "split" && (
        <div className="absolute inset-0 grid grid-rows-2 gap-0.5 bg-primary/40">
          <div className="relative overflow-hidden">{mediaLayer}</div>
          <div className="relative overflow-hidden bg-secondary">
            <div className="grid h-full place-items-center text-muted-foreground">
              <div className="text-center">
                <User className="mx-auto mb-1 size-6" />
                <div className="font-mono text-[10px] uppercase tracking-widest">Falante 2</div>
              </div>
            </div>
          </div>
        </div>
      )}
      {layout === "pip" && (
        <>
          {mediaLayer}
          <div className="absolute right-3 top-3 h-24 w-24 overflow-hidden rounded-xl border-2 border-primary bg-secondary shadow-lg">
            <div className="grid h-full place-items-center text-muted-foreground">
              <User className="size-6" />
            </div>
          </div>
        </>
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
