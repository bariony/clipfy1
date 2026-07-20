import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  ChevronDown,
  Clapperboard,
  Layers,
  MonitorPlay,
  ScanFace,
  Sparkles,
  Wand2,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Clipfy — Long videos in. Viral clips out." },
      {
        name: "description",
        content:
          "AI clipping for YouTube Shorts, TikTok and Instagram Reels. Auto-transcribe, score viral moments, caption, and render in every format.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav />
      <Hero />
      <LogoStrip />
      <Benefits />
      <HowItWorks />
      <Pricing />
      <FAQ />
      <FinalCTA />
      <Footer />
    </div>
  );
}

/* ---------- Nav ---------- */
function Nav() {
  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <div className="flex items-center gap-8">
          <Link to="/" className="flex items-center gap-2">
            <div className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
              <Clapperboard className="size-4" strokeWidth={2.5} />
            </div>
            <span className="text-lg font-extrabold tracking-tighter">CLIPFY</span>
          </Link>
          <div className="hidden items-center gap-6 text-sm font-medium text-muted-foreground md:flex">
            <a href="#features" className="transition-colors hover:text-foreground">
              Features
            </a>
            <a href="#how" className="transition-colors hover:text-foreground">
              How it works
            </a>
            <a href="#pricing" className="transition-colors hover:text-foreground">
              Pricing
            </a>
            <a href="#faq" className="transition-colors hover:text-foreground">
              FAQ
            </a>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/auth"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Login
          </Link>
          <Button asChild size="sm" className="rounded-full font-bold">
            <Link to="/auth" search={{ mode: "signup" }}>
              Get Started
            </Link>
          </Button>
        </div>
      </div>
    </nav>
  );
}

/* ---------- Hero ---------- */
function Hero() {
  return (
    <section className="relative overflow-hidden px-6 pt-24 pb-16">
      <div className="pointer-events-none absolute top-0 left-1/2 h-96 w-full max-w-4xl -translate-x-1/2 rounded-full bg-primary/10 blur-[120px]" />

      <div className="relative z-10 mx-auto max-w-5xl text-center">
        <div className="animate-reveal mb-8 inline-flex items-center gap-2 rounded-full border border-border bg-white/5 px-3 py-1 font-mono text-[10px] tracking-widest text-primary uppercase">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
          </span>
          AI Analysis Engine v2.0
        </div>

        <h1 className="animate-reveal mb-6 text-balance text-5xl font-extrabold tracking-tight md:text-7xl [animation-delay:100ms]">
          Turn raw footage into <span className="italic text-primary">viral currency.</span>
        </h1>

        <p className="animate-reveal mx-auto mb-10 max-w-2xl text-pretty text-lg text-muted-foreground md:text-xl [animation-delay:200ms]">
          The AI video architect that finds your best moments, crops them for vertical, and
          generates captions that stop the scroll.
        </p>

        <div className="animate-reveal flex flex-col items-center justify-center gap-4 sm:flex-row [animation-delay:300ms]">
          <Button asChild size="lg" className="w-full rounded-xl font-extrabold sm:w-auto">
            <Link to="/auth" search={{ mode: "signup" }}>
              Start Clipping Free
            </Link>
          </Button>
          <Button
            asChild
            variant="outline"
            size="lg"
            className="w-full rounded-xl border-border bg-white/5 font-bold sm:w-auto"
          >
            <a href="#how">Watch Demo</a>
          </Button>
        </div>
      </div>

      <HeroProductMock />
    </section>
  );
}

function HeroProductMock() {
  return (
    <div className="animate-reveal mx-auto mt-20 max-w-6xl rounded-2xl border border-border bg-white/5 p-2 [animation-delay:400ms]">
      <div className="overflow-hidden rounded-xl bg-background shadow-2xl ring-1 ring-white/10">
        <div className="flex h-[500px]">
          {/* Rail */}
          <div className="flex w-12 flex-col items-center gap-6 border-r border-border py-4">
            <div className="size-6 rounded-md border border-primary/40 bg-primary/20" />
            <div className="size-6 rounded-md bg-white/5" />
            <div className="size-6 rounded-md bg-white/5" />
          </div>

          {/* Main */}
          <div className="flex flex-1 flex-col">
            <div className="flex h-10 items-center justify-between border-b border-border px-4">
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Editor / master_vlog_01.mp4
              </div>
              <div className="flex gap-2">
                <div className="size-2 rounded-full bg-white/10" />
                <div className="size-2 rounded-full bg-white/10" />
              </div>
            </div>

            <div className="grid flex-1 grid-cols-12 gap-px bg-border">
              {/* Viewport */}
              <div className="col-span-8 bg-background p-4">
                <div className="mb-4 grid aspect-video w-full place-items-center rounded-lg bg-white/5 ring-1 ring-white/10">
                  <div className="text-center">
                    <MonitorPlay className="mx-auto mb-2 size-8 text-primary/60" />
                    <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      AI Viewport Active
                    </div>
                  </div>
                </div>
                <div className="flex h-12 items-center gap-2 overflow-hidden rounded-md bg-white/5 px-3">
                  <div className="h-full w-1 bg-primary" />
                  <div className="font-mono text-[10px] opacity-40">00:12:44:02</div>
                  <div className="ml-auto flex gap-0.5">
                    {Array.from({ length: 40 }).map((_, i) => (
                      <div
                        key={i}
                        className={cn(
                          "w-0.5",
                          [3, 4, 5, 12, 13, 22, 23, 24, 34].includes(i)
                            ? "h-6 bg-primary/60"
                            : "h-3 bg-white/10",
                        )}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Suggestions */}
              <div className="col-span-4 flex flex-col gap-3 overflow-y-auto bg-background p-4">
                <div className="mb-1 font-mono text-xs font-bold text-primary">
                  AI SUGGESTIONS (4)
                </div>
                <SuggestionCard score={98} title="The Controversial Take" duration="0:45" active />
                <SuggestionCard score={82} title="Quick Insight" duration="0:38" />
                <SuggestionCard score={76} title="The Joke Clip" duration="0:22" />
                <SuggestionCard score={64} title="Origin Story" duration="0:58" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SuggestionCard({
  score,
  title,
  duration,
  active,
}: {
  score: number;
  title: string;
  duration: string;
  active?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3 transition-colors",
        active
          ? "border-primary/30 bg-primary/5"
          : "border-border bg-white/5 opacity-60 hover:opacity-100",
      )}
    >
      <div className="mb-2 flex items-start justify-between">
        <span
          className={cn(
            "px-1.5 font-mono text-[10px] font-bold",
            active ? "bg-primary text-primary-foreground" : "bg-white/10 text-foreground",
          )}
        >
          {score}% VIRAL SCORE
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">{duration}</span>
      </div>
      <div className="text-[11px] font-medium">{title}</div>
    </div>
  );
}

/* ---------- Logo Strip ---------- */
function LogoStrip() {
  return (
    <div className="overflow-hidden border-y border-border py-12">
      <div className="mx-auto max-w-7xl px-6">
        <div className="flex flex-wrap justify-center gap-x-16 gap-y-8 opacity-40 grayscale contrast-150">
          {["PODCAST-X", "STRIKE.MEDIA", "FLOWSTATE", "V-STUDIO", "NEXUS", "OFFRECORD"].map(
            (name) => (
              <span key={name} className="font-black tracking-widest">
                {name}
              </span>
            ),
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- Benefits ---------- */
function Benefits() {
  const items = [
    {
      icon: ScanFace,
      title: "Auto Transcription",
      body: "Word-for-word analysis in 40+ languages. 99% accuracy for perfect karaoke captions.",
    },
    {
      icon: Sparkles,
      title: "AI Viral Score",
      body: "Proprietary models predict performance based on hook strength and retention potential.",
    },
    {
      icon: Layers,
      title: "Multi-Format Render",
      body: "One-click export for TikTok (9:16), Reels (9:16), Shorts, and Square (1:1).",
    },
    {
      icon: Wand2,
      title: "Smart Reframe",
      body: "Face and object tracking keep the subject centered on every aspect ratio.",
    },
    {
      icon: Zap,
      title: "Fast Render Engine",
      body: "Parallel GPU rendering. Get your first clips in minutes, not hours.",
    },
    {
      icon: MonitorPlay,
      title: "Template Library",
      body: "Split-screen, gameplay overlays, canvas layouts, and karaoke caption presets.",
    },
  ];

  return (
    <section id="features" className="px-6 py-24">
      <div className="mx-auto max-w-7xl">
        <div className="mb-16">
          <div className="mb-4 font-mono text-xs uppercase tracking-[0.2em] text-primary">
            // Features
          </div>
          <h2 className="mb-4 text-3xl font-bold tracking-tight md:text-4xl">
            Engineered for virality
          </h2>
          <p className="max-w-xl text-muted-foreground">
            Every feature is tuned to the algorithm. From multi-format cropping to
            karaoke-style captions.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {items.map((it) => (
            <div
              key={it.title}
              className="group rounded-2xl border border-border bg-white/5 p-8 transition-colors hover:border-primary/40"
            >
              <div className="mb-6 grid size-10 place-items-center rounded-lg bg-primary/10">
                <it.icon className="size-5 text-primary" strokeWidth={2.25} />
              </div>
              <h3 className="mb-3 text-lg font-bold">{it.title}</h3>
              <p className="text-sm text-muted-foreground">{it.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- How it works ---------- */
function HowItWorks() {
  const steps = [
    { n: "01", title: "Upload source", body: "Paste a YouTube link or drop a file up to 4 GB." },
    { n: "02", title: "AI analysis", body: "Transcribe, score, and rank the most viral moments." },
    { n: "03", title: "Review clips", body: "Pick from 10–15 AI-suggested cuts. Trim if you want." },
    { n: "04", title: "Render & post", body: "Export 9:16, 1:1 or 16:9 with baked-in captions." },
  ];

  return (
    <section id="how" className="border-y border-border bg-white/[0.02] px-6 py-24">
      <div className="mx-auto max-w-7xl">
        <div className="mb-16 text-center">
          <div className="mb-4 font-mono text-xs uppercase tracking-[0.2em] text-primary">
            // Workflow
          </div>
          <h2 className="text-balance text-3xl font-bold tracking-tight md:text-4xl">
            From raw video to viral in four steps
          </h2>
        </div>

        <div className="grid gap-8 md:grid-cols-4">
          {steps.map((s) => (
            <div key={s.n} className="relative">
              <div className="mb-4 font-mono text-5xl font-extrabold text-border">{s.n}</div>
              <h4 className="mb-2 text-lg font-bold">{s.title}</h4>
              <p className="text-sm text-muted-foreground">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- Pricing ---------- */
function Pricing() {
  const tiers = [
    {
      name: "Starter",
      price: "$0",
      credits: "60 credits / mo",
      features: ["2h of long video", "Watermark", "720p export", "Community support"],
      cta: "Start Free",
      highlighted: false,
    },
    {
      name: "Creator",
      price: "$29",
      credits: "1,500 credits / mo",
      features: [
        "15h of long video",
        "No watermark",
        "4K render engine",
        "AI karaoke captions",
        "Priority queue",
      ],
      cta: "Go Pro",
      highlighted: true,
    },
    {
      name: "Studio",
      price: "$99",
      credits: "6,000 credits / mo",
      features: [
        "100h of long video",
        "Team seats",
        "API access",
        "Advanced templates",
        "SSO & audit log",
      ],
      cta: "Contact Sales",
      highlighted: false,
    },
  ];

  return (
    <section id="pricing" className="px-6 py-24">
      <div className="mx-auto max-w-7xl">
        <div className="mb-16 text-center">
          <div className="mb-4 font-mono text-xs uppercase tracking-[0.2em] text-primary">
            // Pricing
          </div>
          <h2 className="text-4xl font-bold tracking-tight">Choose your speed</h2>
        </div>

        <div className="grid gap-8 md:grid-cols-3">
          {tiers.map((t) => (
            <div
              key={t.name}
              className={cn(
                "relative flex flex-col rounded-2xl border p-8",
                t.highlighted
                  ? "border-primary bg-primary/5"
                  : "border-border bg-card",
              )}
            >
              {t.highlighted && (
                <div className="absolute -top-3 right-8 rounded bg-primary px-2 py-0.5 font-mono text-[10px] font-bold text-primary-foreground">
                  MOST POPULAR
                </div>
              )}
              <div
                className={cn(
                  "mb-4 font-mono text-sm uppercase tracking-widest",
                  t.highlighted ? "text-primary" : "text-muted-foreground",
                )}
              >
                {t.name}
              </div>
              <div className="mb-2 text-4xl font-extrabold">
                {t.price}
                <span className="text-sm font-normal text-muted-foreground">/mo</span>
              </div>
              <div className="mb-6 font-mono text-xs text-muted-foreground">{t.credits}</div>

              <ul className="mb-8 flex-1 space-y-3 text-sm">
                {t.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 font-mono">
                    <span className={t.highlighted ? "text-primary" : "text-muted-foreground"}>
                      +
                    </span>
                    <span className={t.highlighted ? "text-foreground/90" : "text-muted-foreground"}>
                      {f}
                    </span>
                  </li>
                ))}
              </ul>

              <Button
                asChild
                variant={t.highlighted ? "default" : "outline"}
                className={cn(
                  "w-full rounded-xl font-extrabold",
                  !t.highlighted && "border-border bg-transparent",
                )}
              >
                <Link to="/auth" search={{ mode: "signup" }}>
                  {t.cta}
                </Link>
              </Button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- FAQ ---------- */
function FAQ() {
  const items = [
    {
      q: "How does the AI choose the best clips?",
      a: "We analyze transcript sentiment, hook strength, retention curves, and audio dynamics to score each moment. You always have the final call.",
    },
    {
      q: "Which video sources are supported?",
      a: "YouTube links, direct MP4/MOV uploads up to 4 GB, and long-form podcast recordings.",
    },
    {
      q: "Can I customize the caption styles?",
      a: "Yes. Choose from karaoke, highlighted-word, standard, and fully custom styles — font, color, border, shadow, position, animation.",
    },
    {
      q: "What languages are supported?",
      a: "Transcription and captions in 40+ languages including Portuguese, English, Spanish, French, German and Japanese.",
    },
    {
      q: "Do you publish directly to TikTok / Reels / Shorts?",
      a: "Direct publishing is on our roadmap. Today you download the rendered clips and upload with your favorite tool.",
    },
  ];

  return (
    <section id="faq" className="border-y border-border bg-white/[0.02] px-6 py-24">
      <div className="mx-auto max-w-3xl">
        <div className="mb-12 text-center">
          <div className="mb-4 font-mono text-xs uppercase tracking-[0.2em] text-primary">
            // FAQ
          </div>
          <h2 className="text-4xl font-bold tracking-tight">Frequently asked</h2>
        </div>

        <div className="space-y-3">
          {items.map((it, i) => (
            <FAQItem key={i} q={it.q} a={it.a} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-border bg-card">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <span className="text-sm font-semibold">{q}</span>
        <ChevronDown
          className={cn(
            "size-4 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="border-t border-border px-5 py-4 text-sm text-muted-foreground">{a}</div>
      )}
    </div>
  );
}

/* ---------- Final CTA ---------- */
function FinalCTA() {
  return (
    <section className="relative overflow-hidden px-6 py-32 text-center">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent to-primary/5" />
      <div className="relative mx-auto max-w-3xl">
        <h2 className="mb-6 text-balance text-5xl font-extrabold italic tracking-tight md:text-6xl">
          Ready to go <span className="text-primary">viral</span>?
        </h2>
        <p className="mb-10 text-lg text-muted-foreground">
          Join creators saving 20+ hours a week on editing.
        </p>
        <Button asChild size="lg" className="rounded-xl px-10 py-6 text-lg font-extrabold">
          <Link to="/auth" search={{ mode: "signup" }}>
            Claim your free clips
          </Link>
        </Button>
      </div>
    </section>
  );
}

/* ---------- Footer ---------- */
function Footer() {
  return (
    <footer className="border-t border-border px-6 py-12">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-8 md:flex-row">
        <div className="flex flex-col items-center gap-2 md:items-start">
          <div className="flex items-center gap-2">
            <div className="grid size-6 place-items-center rounded-md bg-primary text-primary-foreground">
              <Clapperboard className="size-3.5" strokeWidth={2.5} />
            </div>
            <span className="text-lg font-extrabold tracking-tighter">CLIPFY</span>
          </div>
          <p className="font-mono text-xs text-muted-foreground">
            © {new Date().getFullYear()} CLIPFY LABS.
          </p>
        </div>
        <div className="flex gap-8 font-mono text-sm text-muted-foreground">
          <a href="#" className="transition-colors hover:text-primary">
            Privacy
          </a>
          <a href="#" className="transition-colors hover:text-primary">
            Terms
          </a>
          <a href="#" className="transition-colors hover:text-primary">
            Twitter / X
          </a>
        </div>
      </div>
    </footer>
  );
}
