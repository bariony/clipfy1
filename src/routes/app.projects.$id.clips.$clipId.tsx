import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Loader2,
  Pause,
  Play,
  Save,
  Scissors,
  Sparkles,
  Type,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import {
  clipQueryOptions,
  formatDuration,
  projectQueryOptions,
  transcriptQueryOptions,
  type Clip,
  type TranscriptSegment,
} from "@/lib/projects";

export const Route = createFileRoute("/app/projects/$id/clips/$clipId")({
  head: () => ({ meta: [{ title: "Clip editor — Clipfy" }] }),
  loader: async ({ params, context }) => {
    const [project, clip] = await Promise.all([
      context.queryClient.ensureQueryData(projectQueryOptions(params.id)),
      context.queryClient.ensureQueryData(clipQueryOptions(params.clipId)),
    ]);
    if (!project || !clip) throw notFound();
    context.queryClient.ensureQueryData(transcriptQueryOptions(params.id));
    return { title: clip.title };
  },
  component: ClipEditor,
  errorComponent: ({ error }) => (
    <div className="p-8 text-sm text-destructive">Falhou ao carregar: {error.message}</div>
  ),
  notFoundComponent: () => (
    <div className="p-8">
      <h2 className="text-2xl font-extrabold">Corte não encontrado</h2>
      <Button asChild className="mt-4 rounded-lg"><Link to="/app/projects">Voltar</Link></Button>
    </div>
  ),
});

// ---------- Caption templates (client-side presets) ----------
type CaptionStyle = {
  slug: string;
  name: string;
  description: string;
  container: string; // vertical placement
  wrap: string; // wrapper (font size + weight + tracking + text transform)
  base: string; // idle word classes
  highlight: string; // active word classes (color, bg, shadow, stroke)
  animation:
    | "cap-anim-pop"
    | "cap-anim-slam"
    | "cap-anim-bounce"
    | "cap-anim-glow"
    | "cap-anim-flip"
    | "cap-anim-jitter";
  chip?: boolean; // render each word as a chip (padding+bg)
};

// Heavy black stroke used by hormozi/tiktok styles
const STROKE_BLACK =
  "[-webkit-text-stroke:3px_#000] [paint-order:stroke_fill]";
const STROKE_THIN =
  "[-webkit-text-stroke:2px_#000] [paint-order:stroke_fill]";

const TEMPLATES: CaptionStyle[] = [
  {
    slug: "hormozi-slam",
    name: "Hormozi Slam",
    description: "Branco com traço preto, palavra ativa AMARELA gigante caindo na tela.",
    container: "bottom-[16%]",
    wrap: "text-3xl sm:text-4xl md:text-[44px] font-black uppercase tracking-tight leading-[1.05]",
    base: `text-white ${STROKE_BLACK}`,
    highlight: `text-yellow-300 ${STROKE_BLACK} drop-shadow-[0_6px_0_rgba(0,0,0,.9)]`,
    animation: "cap-anim-slam",
  },
  {
    slug: "neon-pulse",
    name: "Neon Pulse",
    description: "Ciano em glow, palavra ativa pulsando em lima neon.",
    container: "bottom-[14%]",
    wrap: "text-2xl sm:text-3xl md:text-[38px] font-extrabold uppercase tracking-wide",
    base: "text-cyan-200/85 [text-shadow:0_0_10px_rgba(103,232,249,.5),0_0_2px_#000]",
    highlight:
      "text-[hsl(var(--primary))] [text-shadow:0_0_18px_hsl(var(--primary)/.9),0_0_2px_#000]",
    animation: "cap-anim-glow",
  },
  {
    slug: "tiktok-chip",
    name: "TikTok Chip",
    description: "Cada palavra numa caixinha preta arredondada; ativa vira lima.",
    container: "bottom-[18%]",
    wrap: "text-xl sm:text-2xl md:text-[30px] font-black uppercase tracking-tight",
    base: "text-white bg-black/90 rounded-md px-2.5 py-1",
    highlight:
      "text-black bg-[hsl(var(--primary))] rounded-md px-2.5 py-1 shadow-[0_6px_0_rgba(0,0,0,.9)]",
    animation: "cap-anim-bounce",
    chip: true,
  },
  {
    slug: "gradient-rush",
    name: "Gradient Rush",
    description: "Palavra ativa em gradiente vibrante com leve rotação.",
    container: "bottom-[16%]",
    wrap: "text-3xl sm:text-4xl md:text-[42px] font-black uppercase tracking-tight",
    base: `text-white/85 ${STROKE_THIN}`,
    highlight:
      "bg-gradient-to-br from-[hsl(var(--primary))] via-yellow-300 to-orange-400 bg-clip-text text-transparent drop-shadow-[0_4px_10px_rgba(0,0,0,.6)]",
    animation: "cap-anim-jitter",
  },
  {
    slug: "karaoke-lime",
    name: "Karaoke Lime",
    description: "Karaokê clássico, ativa em lima com pop suave.",
    container: "bottom-[18%]",
    wrap: "text-2xl sm:text-3xl md:text-[36px] font-extrabold tracking-tight",
    base: "text-white/70 [text-shadow:0_2px_6px_rgba(0,0,0,.7)]",
    highlight:
      "text-[hsl(var(--primary))] [text-shadow:0_0_16px_hsl(var(--primary)/.75),0_2px_0_#000]",
    animation: "cap-anim-pop",
  },
  {
    slug: "flip-cinema",
    name: "Flip Cinema",
    description: "Cinemático, palavras giram no eixo X ao entrar.",
    container: "bottom-[12%]",
    wrap: "text-2xl sm:text-3xl md:text-[34px] font-semibold tracking-tight",
    base: "text-white/60 [text-shadow:0_2px_10px_rgba(0,0,0,.6)]",
    highlight:
      "text-white [text-shadow:0_0_14px_rgba(255,255,255,.5),0_2px_10px_rgba(0,0,0,.9)]",
    animation: "cap-anim-flip",
  },
  {
    slug: "big-impact",
    name: "Big Impact",
    description: "Textão gigantesco, cada palavra explode na tela.",
    container: "bottom-[22%]",
    wrap: "text-4xl sm:text-5xl md:text-[64px] font-black uppercase tracking-tighter leading-[0.95]",
    base: `text-white ${STROKE_BLACK} drop-shadow-[0_6px_0_#000]`,
    highlight: `text-[hsl(var(--primary))] ${STROKE_BLACK} drop-shadow-[0_8px_0_#000]`,
    animation: "cap-anim-slam",
  },
];

// ---------- Word-timing generation ----------
type Word = { text: string; start: number; end: number };

function segmentsToWords(segments: TranscriptSegment[], clipStart: number, clipEnd: number): Word[] {
  const words: Word[] = [];
  for (const seg of segments) {
    if (seg.end < clipStart || seg.start > clipEnd) continue;
    const tokens = seg.text.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const duration = Math.max(0.001, seg.end - seg.start);
    const per = duration / tokens.length;
    tokens.forEach((tok, i) => {
      const start = seg.start + i * per;
      const end = start + per;
      if (end < clipStart || start > clipEnd) return;
      words.push({ text: tok, start, end });
    });
  }
  return words;
}

// ---------- Component ----------
function ClipEditor() {
  const { id, clipId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: project } = useSuspenseQuery(projectQueryOptions(id));
  const { data: clip } = useSuspenseQuery(clipQueryOptions(clipId));
  const { data: transcript } = useSuspenseQuery(transcriptQueryOptions(id));

  if (!project || !clip) return null;

  const originalStart = Number(clip.start_seconds);
  const originalEnd = Number(clip.end_seconds);

  const [trim, setTrim] = useState<[number, number]>([originalStart, originalEnd]);
  const [templateSlug, setTemplateSlug] = useState<string>(
    (clip.metadata as { template_slug?: string } | null)?.template_slug ?? "hormozi-slam",
  );
  const [title, setTitle] = useState(clip.title);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [loadingUrl, setLoadingUrl] = useState(false);
  const [currentTime, setCurrentTime] = useState(originalStart);
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const template = TEMPLATES.find((t) => t.slug === templateSlug) ?? TEMPLATES[0];
  const segments = useMemo<TranscriptSegment[]>(() => {
    const raw = (transcript?.segments ?? []) as unknown;
    return Array.isArray(raw)
      ? (raw as TranscriptSegment[]).filter((s) => typeof s?.start === "number" && typeof s?.end === "number")
      : [];
  }, [transcript]);

  const words = useMemo(() => segmentsToWords(segments, trim[0], trim[1]), [segments, trim]);
  const activeWordIdx = useMemo(
    () => words.findIndex((w) => currentTime >= w.start && currentTime <= w.end),
    [words, currentTime],
  );

  // Load signed URL for uploaded video
  useEffect(() => {
    if (project.source !== "upload" || !project.storage_path) return;
    let cancelled = false;
    setLoadingUrl(true);
    supabase.storage
      .from("videos")
      .createSignedUrl(project.storage_path, 3600)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) toast.error("Não consegui carregar o vídeo.");
        setVideoUrl(data?.signedUrl ?? null);
        setLoadingUrl(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project.source, project.storage_path]);

  // Sync video time -> state, and enforce trim range
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => {
      setCurrentTime(v.currentTime);
      if (v.currentTime >= trim[1]) {
        v.pause();
        v.currentTime = trim[0];
        setPlaying(false);
      }
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
    };
  }, [trim]);

  const seek = (t: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = t;
    setCurrentTime(t);
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (v.currentTime < trim[0] || v.currentTime >= trim[1]) v.currentTime = trim[0];
      v.play();
    } else {
      v.pause();
    }
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const metadata = { ...((clip.metadata as object) ?? {}), template_slug: templateSlug };
      const { error } = await supabase
        .from("clips")
        .update({
          title,
          start_seconds: trim[0],
          end_seconds: trim[1],
          metadata: metadata as never,
        })
        .eq("id", clip.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Corte salvo.");
      qc.invalidateQueries({ queryKey: ["clip", clipId] });
      qc.invalidateQueries({ queryKey: ["projects", id, "clips"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Falha ao salvar."),
  });

  const clipDuration = Math.max(0, trim[1] - trim[0]);
  const localT = Math.max(0, currentTime - trim[0]);

  return (
    <div className="mx-auto max-w-7xl px-4 pb-24 pt-4 sm:px-6 lg:px-8">
      {/* Top bar */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm" className="rounded-lg">
            <Link to="/app/projects/$id" params={{ id }}>
              <ArrowLeft className="mr-1.5 size-4" /> Voltar
            </Link>
          </Button>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">// clip editor</div>
            <div className="text-lg font-extrabold leading-tight">{title || "Sem título"}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="border-border bg-transparent"
            onClick={() => navigate({ to: "/app/projects/$id", params: { id } })}
          >
            Cancelar
          </Button>
          <Button className="rounded-lg font-bold" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}
            Salvar corte
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Preview */}
        <div>
          <div className="relative overflow-hidden rounded-2xl border border-border bg-black">
            <div className="relative mx-auto aspect-[9/16] max-h-[70vh] bg-black">
              {project.source === "upload" ? (
                loadingUrl ? (
                  <div className="grid h-full place-items-center text-xs text-muted-foreground">Carregando vídeo…</div>
                ) : videoUrl ? (
                  <video
                    ref={videoRef}
                    src={videoUrl}
                    className="h-full w-full object-cover"
                    playsInline
                    onLoadedMetadata={(e) => {
                      e.currentTarget.currentTime = trim[0];
                    }}
                  />
                ) : (
                  <div className="grid h-full place-items-center text-xs text-destructive">Vídeo indisponível</div>
                )
              ) : project.source_url ? (
                <YoutubeEmbed url={project.source_url} start={trim[0]} end={trim[1]} />
              ) : (
                <div className="grid h-full place-items-center text-xs text-muted-foreground">Sem fonte de vídeo</div>
              )}

              {/* Caption overlay */}
              <CaptionOverlay words={words} activeIdx={activeWordIdx} style={template} />

              {/* Play button overlay for uploaded */}
              {project.source === "upload" && videoUrl && (
                <button
                  type="button"
                  onClick={togglePlay}
                  aria-label={playing ? "Pause" : "Play"}
                  className="group absolute inset-0 grid place-items-center"
                >
                  <span className={cn("grid size-16 place-items-center rounded-full bg-black/60 backdrop-blur transition-opacity", playing ? "opacity-0 group-hover:opacity-100" : "opacity-100")}>
                    {playing ? <Pause className="size-7 text-white" /> : <Play className="ml-1 size-8 text-white" />}
                  </span>
                </button>
              )}
            </div>
          </div>

          {/* Scrub bar */}
          <div className="mt-4 rounded-2xl border border-border bg-card p-4">
            <div className="mb-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              <span>{formatDuration(localT)}</span>
              <span>{formatDuration(clipDuration)}</span>
            </div>
            <Slider
              value={[currentTime]}
              min={trim[0]}
              max={trim[1]}
              step={0.05}
              onValueChange={(v) => seek(v[0])}
              disabled={project.source !== "upload" || !videoUrl}
            />
            <div className="mt-3 flex items-center justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="border-border bg-transparent"
                onClick={togglePlay}
                disabled={project.source !== "upload" || !videoUrl}
              >
                {playing ? <Pause className="mr-1.5 size-4" /> : <Play className="mr-1.5 size-4" />}
                {playing ? "Pausar" : "Reproduzir"}
              </Button>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-5">
          {/* Title & hook */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <Label htmlFor="clip-title" className="mb-2 block text-sm font-bold">Título</Label>
            <Input id="clip-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            {clip.hook && (
              <>
                <div className="mt-4 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">// hook</div>
                <p className="mt-1 text-sm text-muted-foreground">{clip.hook}</p>
              </>
            )}
            {clip.virality_score != null && (
              <div className="mt-4 flex items-center gap-2">
                <Sparkles className="size-3.5 text-primary" />
                <span className="font-mono text-[10px] uppercase tracking-widest text-primary">virality {clip.virality_score}%</span>
              </div>
            )}
          </div>

          {/* Trim */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="mb-3 flex items-center gap-2">
              <Scissors className="size-4 text-primary" />
              <h3 className="text-sm font-bold">Trim do corte</h3>
            </div>
            <TrimRange
              value={trim}
              min={0}
              max={Math.max(originalEnd + 30, 300)}
              onChange={(t) => {
                setTrim(t);
                if (currentTime < t[0] || currentTime > t[1]) seek(t[0]);
              }}
            />
            <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-xs">
              <div className="rounded-lg border border-border bg-background/40 px-3 py-2">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">in</div>
                <div>{formatDuration(trim[0])}</div>
              </div>
              <div className="rounded-lg border border-border bg-background/40 px-3 py-2">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">out</div>
                <div>{formatDuration(trim[1])}</div>
              </div>
            </div>
          </div>

          {/* Template */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="mb-3 flex items-center gap-2">
              <Type className="size-4 text-primary" />
              <h3 className="text-sm font-bold">Legenda animada</h3>
            </div>
            <div className="grid gap-2">
              {TEMPLATES.map((t) => (
                <button
                  key={t.slug}
                  type="button"
                  onClick={() => setTemplateSlug(t.slug)}
                  className={cn(
                    "rounded-xl border p-3 text-left transition-colors",
                    templateSlug === t.slug ? "border-primary bg-primary/10" : "border-border bg-background/40 hover:border-primary/40",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold">{t.name}</span>
                    {templateSlug === t.slug && <Check className="size-4 text-primary" />}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t.description}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Caption overlay ----------
function CaptionOverlay({ words, activeIdx, style }: { words: Word[]; activeIdx: number; style: CaptionStyle }) {
  if (words.length === 0) return null;
  // Window: current word + 2 before + 3 after (or first 6 if no active)
  const idx = activeIdx >= 0 ? activeIdx : 0;
  const start = Math.max(0, idx - 2);
  const windowWords = words.slice(start, start + 6);
  return (
    <div className={cn("pointer-events-none absolute inset-x-0 flex justify-center px-4", style.container)}>
      <div
        className={cn(
          "flex max-w-[94%] flex-wrap justify-center gap-x-2 gap-y-2 text-center",
          style.wrap,
        )}
      >
        {windowWords.map((w, i) => {
          const globalIdx = start + i;
          const isActive = globalIdx === activeIdx;
          return (
            <span
              // key retriggers the CSS animation each time this word becomes active
              key={`${globalIdx}-${isActive ? `A${activeIdx}` : "i"}`}
              className={cn(
                "inline-block will-change-transform",
                isActive ? style.highlight : style.base,
                isActive && style.animation,
              )}
            >
              {w.text}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Trim range (dual slider) ----------
function TrimRange({ value, min, max, onChange }: { value: [number, number]; min: number; max: number; onChange: (v: [number, number]) => void }) {
  return (
    <Slider
      value={[value[0], value[1]]}
      min={min}
      max={max}
      step={0.1}
      onValueChange={(v) => {
        if (v.length !== 2) return;
        const a = Math.min(v[0], v[1]);
        const b = Math.max(v[0], v[1]);
        if (b - a < 1) return; // enforce >=1s
        onChange([a, b]);
      }}
    />
  );
}

// ---------- YouTube embed ----------
function YoutubeEmbed({ url, start, end }: { url: string; start: number; end: number }) {
  const videoId = useMemo(() => {
    try {
      const u = new URL(url);
      if (u.hostname.includes("youtu.be")) return u.pathname.slice(1);
      return u.searchParams.get("v") ?? "";
    } catch {
      return "";
    }
  }, [url]);
  if (!videoId) return <div className="grid h-full place-items-center text-xs text-destructive">URL inválida</div>;
  const src = `https://www.youtube-nocookie.com/embed/${videoId}?start=${Math.floor(start)}&end=${Math.ceil(end)}&modestbranding=1&rel=0`;
  return (
    <iframe
      key={`${videoId}-${Math.floor(start)}-${Math.ceil(end)}`}
      src={src}
      title="YouTube preview"
      className="h-full w-full"
      allow="autoplay; encrypted-media; picture-in-picture"
      allowFullScreen
    />
  );
}
