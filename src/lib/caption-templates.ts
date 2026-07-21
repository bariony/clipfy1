import type { TranscriptSegment } from "@/lib/projects";

export type CaptionStyle = {
  slug: string;
  name: string;
  description: string;
  container: string; // vertical placement
  wrap: string; // wrapper (font size + weight + tracking + text transform)
  base: string; // idle word classes
  highlight: string; // active word classes
  animation:
    | "cap-anim-pop"
    | "cap-anim-slam"
    | "cap-anim-bounce"
    | "cap-anim-glow"
    | "cap-anim-flip"
    | "cap-anim-jitter";
  chip?: boolean;
  badge?: "Novo" | "Popular";
  /** Sample phrase used in the gallery preview card. */
  sample?: string;
};

const STROKE_BLACK = "[-webkit-text-stroke:3px_#000] [paint-order:stroke_fill]";
const STROKE_THIN = "[-webkit-text-stroke:2px_#000] [paint-order:stroke_fill]";

export const CAPTION_TEMPLATES: CaptionStyle[] = [
  {
    slug: "none",
    name: "Sem legenda",
    description: "Exporta o vídeo limpo, sem texto queimado.",
    container: "bottom-[16%]",
    wrap: "text-xl font-bold",
    base: "text-transparent",
    highlight: "text-transparent",
    animation: "cap-anim-pop",
    sample: "SEM TEXTO",
  },
  {
    slug: "hormozi-slam",
    name: "Hormozi Slam",
    description: "Branco com traço preto, palavra ativa amarela.",
    container: "bottom-[16%]",
    wrap: "text-xl sm:text-2xl md:text-[34px] font-black uppercase tracking-tight leading-[1.05]",
    base: `text-white ${STROKE_BLACK}`,
    highlight: `text-yellow-300 ${STROKE_BLACK} drop-shadow-[0_6px_0_rgba(0,0,0,.9)]`,
    animation: "cap-anim-slam",
    badge: "Popular",
    sample: "VAI VIRALIZAR AGORA",
  },
  {
    slug: "beasty",
    name: "Beasty",
    description: "MrBeast: amarelo neon com traço preto grosso.",
    container: "bottom-[16%]",
    wrap: "text-xl sm:text-2xl md:text-[34px] font-black uppercase tracking-tight leading-[1.05]",
    base: `text-white ${STROKE_BLACK}`,
    highlight: `text-[#facc15] ${STROKE_BLACK} drop-shadow-[0_4px_0_#000]`,
    animation: "cap-anim-pop",
    badge: "Popular",
    sample: "OLHA ISSO AQUI",
  },
  {
    slug: "youshaei",
    name: "Youshaei",
    description: "Minimal, branco fino, ativa em azul elétrico.",
    container: "bottom-[16%]",
    wrap: "text-xl sm:text-2xl md:text-[30px] font-bold tracking-tight",
    base: "text-white/85 [text-shadow:0_2px_8px_rgba(0,0,0,.7)]",
    highlight: "text-[#3b82f6] [text-shadow:0_2px_10px_rgba(59,130,246,.55)]",
    animation: "cap-anim-pop",
    sample: "A ideia é simples",
  },
  {
    slug: "mozi",
    name: "Mozi",
    description: "Verde vibrante estilo TikTok Mozi.",
    container: "bottom-[16%]",
    wrap: "text-xl sm:text-2xl md:text-[32px] font-black uppercase tracking-tight",
    base: `text-white ${STROKE_BLACK}`,
    highlight: `text-[#22c55e] ${STROKE_BLACK} drop-shadow-[0_5px_0_#000]`,
    animation: "cap-anim-slam",
    sample: "COMEÇOU A GUERRA",
  },
  {
    slug: "glitch-infinite",
    name: "Glitch Infinite",
    description: "Ativa treme e brilha, vibe cyberpunk.",
    container: "bottom-[15%]",
    wrap: "text-xl sm:text-2xl md:text-[32px] font-extrabold uppercase tracking-widest",
    base: "text-white/80 [text-shadow:0_0_8px_rgba(255,255,255,.3)]",
    highlight:
      "text-[#f97316] [text-shadow:1px_0_0_#ef4444,-1px_0_0_#3b82f6,0_0_18px_rgba(249,115,22,.7)]",
    animation: "cap-anim-jitter",
    badge: "Novo",
    sample: "SEM VOLTA AGORA",
  },
  {
    slug: "karaoke-lime",
    name: "Karaokê",
    description: "Karaokê clássico em lima, palavra por palavra.",
    container: "bottom-[18%]",
    wrap: "text-xl sm:text-2xl md:text-[30px] font-extrabold tracking-tight",
    base: "text-white/70 [text-shadow:0_2px_6px_rgba(0,0,0,.7)]",
    highlight:
      "text-[hsl(var(--primary))] [text-shadow:0_0_16px_hsl(var(--primary)/.75),0_2px_0_#000]",
    animation: "cap-anim-pop",
    sample: "Canta comigo agora",
  },
  {
    slug: "deep-diver",
    name: "Deep Diver",
    description: "Cinzento sóbrio, ativa em preto sobre lima.",
    container: "bottom-[16%]",
    wrap: "text-lg sm:text-xl md:text-[26px] font-bold tracking-tight",
    base: "text-white/70 [text-shadow:0_1px_4px_rgba(0,0,0,.7)]",
    highlight:
      "text-black bg-[hsl(var(--primary))] rounded-sm px-2 py-0.5",
    animation: "cap-anim-bounce",
    chip: true,
    sample: "Entrando fundo agora",
  },
  {
    slug: "pod-p",
    name: "Pod P",
    description: "Estilo podcast: magenta com sombra.",
    container: "bottom-[16%]",
    wrap: "text-xl sm:text-2xl md:text-[30px] font-extrabold uppercase tracking-tight",
    base: `text-white ${STROKE_THIN}`,
    highlight: `text-[#ec4899] ${STROKE_THIN} drop-shadow-[0_4px_0_#000]`,
    animation: "cap-anim-pop",
    sample: "PAPO REAL AGORA",
  },
  {
    slug: "popline",
    name: "Popline",
    description: "Sublinhado colorido, texto limpo.",
    container: "bottom-[16%]",
    wrap: "text-xl sm:text-2xl md:text-[30px] font-bold tracking-tight",
    base: "text-white [text-shadow:0_2px_6px_rgba(0,0,0,.7)]",
    highlight:
      "text-white [box-shadow:inset_0_-8px_0_hsl(var(--primary))] px-1",
    animation: "cap-anim-pop",
    badge: "Novo",
    sample: "Presta atenção nisso",
  },
  {
    slug: "seamless-bounce",
    name: "Seamless Bounce",
    description: "Ativa quica com verde suave.",
    container: "bottom-[16%]",
    wrap: "text-xl sm:text-2xl md:text-[30px] font-extrabold tracking-tight",
    base: "text-white/85 [text-shadow:0_2px_6px_rgba(0,0,0,.7)]",
    highlight:
      "text-white bg-[hsl(var(--primary))]/85 rounded-full px-3 py-0.5",
    animation: "cap-anim-bounce",
    chip: true,
    badge: "Novo",
    sample: "Vamos com tudo",
  },
  {
    slug: "tiktok-chip",
    name: "TikTok Chip",
    description: "Cada palavra numa caixinha; ativa vira lima.",
    container: "bottom-[18%]",
    wrap: "text-lg sm:text-xl md:text-[26px] font-black uppercase tracking-tight",
    base: "text-white bg-black/90 rounded-md px-2 py-0.5",
    highlight:
      "text-black bg-[hsl(var(--primary))] rounded-md px-2 py-0.5 shadow-[0_6px_0_rgba(0,0,0,.9)]",
    animation: "cap-anim-bounce",
    chip: true,
    sample: "OLHA A CENA",
  },
  {
    slug: "neon-pulse",
    name: "Neon Pulse",
    description: "Ciano em glow, ativa pulsando em lima.",
    container: "bottom-[14%]",
    wrap: "text-xl sm:text-2xl md:text-[32px] font-extrabold uppercase tracking-wide",
    base: "text-cyan-200/85 [text-shadow:0_0_10px_rgba(103,232,249,.5),0_0_2px_#000]",
    highlight:
      "text-[hsl(var(--primary))] [text-shadow:0_0_18px_hsl(var(--primary)/.9),0_0_2px_#000]",
    animation: "cap-anim-glow",
    sample: "NEON NA CARA",
  },
  {
    slug: "gradient-rush",
    name: "Gradient Rush",
    description: "Ativa em gradiente vibrante.",
    container: "bottom-[16%]",
    wrap: "text-xl sm:text-2xl md:text-[32px] font-black uppercase tracking-tight",
    base: `text-white/85 ${STROKE_THIN}`,
    highlight:
      "bg-gradient-to-br from-[hsl(var(--primary))] via-yellow-300 to-orange-400 bg-clip-text text-transparent drop-shadow-[0_4px_10px_rgba(0,0,0,.6)]",
    animation: "cap-anim-jitter",
    sample: "SOBE O GRÁFICO",
  },
  {
    slug: "flip-cinema",
    name: "Flip Cinema",
    description: "Cinemático, palavras giram ao entrar.",
    container: "bottom-[12%]",
    wrap: "text-xl sm:text-2xl md:text-[28px] font-semibold tracking-tight",
    base: "text-white/60 [text-shadow:0_2px_10px_rgba(0,0,0,.6)]",
    highlight:
      "text-white [text-shadow:0_0_14px_rgba(255,255,255,.5),0_2px_10px_rgba(0,0,0,.9)]",
    animation: "cap-anim-flip",
    sample: "Cena por cena",
  },
  {
    slug: "big-impact",
    name: "Big Impact",
    description: "Textão gigante que explode.",
    container: "bottom-[22%]",
    wrap: "text-2xl sm:text-3xl md:text-[40px] font-black uppercase tracking-tighter leading-[0.95]",
    base: `text-white ${STROKE_BLACK} drop-shadow-[0_6px_0_#000]`,
    highlight: `text-[hsl(var(--primary))] ${STROKE_BLACK} drop-shadow-[0_8px_0_#000]`,
    animation: "cap-anim-slam",
    sample: "IMPACTO TOTAL",
  },
];

export const DEFAULT_TEMPLATE_SLUG = "hormozi-slam";

export function getCaptionTemplate(slug: string | null | undefined): CaptionStyle {
  return CAPTION_TEMPLATES.find((t) => t.slug === slug) ?? CAPTION_TEMPLATES.find((t) => t.slug === DEFAULT_TEMPLATE_SLUG) ?? CAPTION_TEMPLATES[0];
}

export type AspectRatio = "9:16" | "1:1" | "16:9";
export type LayoutMode = "auto" | "full" | "split-h" | "split-v" | "pip";

export type ProjectPreferences = {
  caption_template?: string;
  aspect_ratio?: AspectRatio;
  layout_mode?: LayoutMode;
};

export const ASPECTS: { slug: AspectRatio; label: string; hint: string; className: string }[] = [
  { slug: "9:16", label: "9:16", hint: "Reels · Shorts · TikTok", className: "aspect-[9/16]" },
  { slug: "1:1", label: "1:1", hint: "Feed quadrado", className: "aspect-square" },
  { slug: "16:9", label: "16:9", hint: "YouTube · LinkedIn", className: "aspect-video" },
];

export const LAYOUTS: { slug: LayoutMode; label: string; hint: string }[] = [
  { slug: "auto", label: "IA Recomenda", hint: "Detecta falantes por cena" },
  { slug: "full", label: "Full", hint: "Foco total no rosto" },
  { slug: "split-h", label: "Lado a lado", hint: "2 pessoas horizontal" },
  { slug: "split-v", label: "Empilhado", hint: "2 pessoas vertical" },
  { slug: "pip", label: "PiP", hint: "Câmera sobre tela" },
];

// --- Word timings from transcript segments ---
export type Word = { text: string; start: number; end: number };

export function segmentsToWords(
  segments: TranscriptSegment[],
  clipStart: number,
  clipEnd: number,
): Word[] {
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
