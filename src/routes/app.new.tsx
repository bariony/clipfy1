import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Link2, Upload, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/new")({
  head: () => ({ meta: [{ title: "New Project — Clipfy" }] }),
  component: NewProject,
});

const LANGUAGES = [
  { code: "auto", label: "Auto-detect" },
  { code: "en", label: "English" },
  { code: "pt", label: "Portuguese" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "ja", label: "Japanese" },
];

const CATEGORIES = [
  "Podcast",
  "Interview",
  "Keynote",
  "Vlog",
  "Livestream",
  "Tutorial",
  "Gaming",
  "Sports",
  "Other",
];

function NewProject() {
  const navigate = useNavigate();
  const [source, setSource] = useState<"upload" | "youtube">("upload");
  const [name, setName] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [description, setDescription] = useState("");
  const [language, setLanguage] = useState("auto");
  const [category, setCategory] = useState("Podcast");
  const [clipCount, setClipCount] = useState<number[]>([10]);
  const [minSec, setMinSec] = useState<number[]>([20]);
  const [maxSec, setMaxSec] = useState<number[]>([60]);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    await new Promise((r) => setTimeout(r, 700));
    setSubmitting(false);
    toast.success("Project created (UI stub)", {
      description: "Processing pipeline wires up when Cloud is enabled.",
    });
    navigate({ to: "/app/projects" });
  }

  return (
    <div className="px-6 py-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8">
          <div className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-primary">
            // Compose
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight">New project</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure the source and how the AI should carve up your video.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-8">
          {/* Name */}
          <Section title="Project name" hint="A short handle you'll recognize later.">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Podcast E42 · Founder mode"
              required
            />
          </Section>

          {/* Source */}
          <Section title="Source" hint="Upload a file or paste a YouTube URL.">
            <div className="mb-4 grid grid-cols-2 gap-2">
              <SourceTab
                active={source === "upload"}
                onClick={() => setSource("upload")}
                icon={Upload}
                label="Upload file"
                hint="Up to 4GB · MP4, MOV"
              />
              <SourceTab
                active={source === "youtube"}
                onClick={() => setSource("youtube")}
                icon={Link2}
                label="YouTube link"
                hint="Public URL"
              />
            </div>

            {source === "upload" ? (
              <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-card/40 px-6 py-12 text-center transition-colors hover:border-primary/40 hover:bg-primary/5">
                <Upload className="mb-3 size-6 text-primary" />
                <div className="text-sm font-semibold">Drop video here or click to upload</div>
                <div className="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  MP4 · MOV · MKV · Up to 4 GB
                </div>
                <input
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) toast(`Selected ${f.name}`);
                  }}
                />
              </label>
            ) : (
              <Input
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                placeholder="https://youtube.com/watch?v=..."
                inputMode="url"
              />
            )}
          </Section>

          {/* Description */}
          <Section
            title="Description"
            hint="Optional. Helps the AI understand your content."
          >
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Interview with a founder on scaling early-stage teams..."
              rows={3}
            />
          </Section>

          {/* Meta grid */}
          <div className="grid gap-6 md:grid-cols-2">
            <Section title="Language" hint="Transcription language">
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((l) => (
                    <SelectItem key={l.code} value={l.code}>
                      {l.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Section>

            <Section title="Category" hint="Style-tunes the AI">
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Section>
          </div>

          {/* Sliders */}
          <Section title="Clip generation" hint="How aggressive should the AI be?">
            <div className="space-y-6">
              <SliderRow
                label="Clips to generate"
                value={clipCount[0]}
                unit={` clips`}
                min={3}
                max={30}
                onChange={setClipCount}
              />
              <SliderRow
                label="Min clip duration"
                value={minSec[0]}
                unit="s"
                min={10}
                max={90}
                onChange={setMinSec}
              />
              <SliderRow
                label="Max clip duration"
                value={maxSec[0]}
                unit="s"
                min={20}
                max={180}
                onChange={setMaxSec}
              />
            </div>
          </Section>

          {/* Actions */}
          <div className="flex items-center justify-between border-t border-border pt-6">
            <div className="font-mono text-xs text-muted-foreground">
              Est. cost:{" "}
              <span className="text-primary">
                {clipCount[0] * 5} credits
              </span>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="border-border bg-transparent"
                onClick={() => navigate({ to: "/app/projects" })}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="lg"
                className="rounded-xl font-extrabold"
                disabled={submitting}
              >
                <Wand2 className="mr-2 size-4" />
                {submitting ? "Processing..." : "Process video"}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <Label className="text-sm font-semibold">{title}</Label>
        {hint && <span className="font-mono text-[10px] text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function SourceTab({
  active,
  onClick,
  icon: Icon,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-xl border p-3 text-left transition-colors",
        active
          ? "border-primary bg-primary/10"
          : "border-border bg-card hover:border-primary/40",
      )}
    >
      <div
        className={cn(
          "grid size-8 place-items-center rounded-lg",
          active ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground",
        )}
      >
        <Icon className="size-4" />
      </div>
      <div>
        <div className="text-sm font-bold">{label}</div>
        <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {hint}
        </div>
      </div>
    </button>
  );
}

function SliderRow({
  label,
  value,
  unit,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  onChange: (v: number[]) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="font-mono text-sm font-bold text-primary">
          {value}
          {unit}
        </span>
      </div>
      <Slider value={[value]} onValueChange={onChange} min={min} max={max} step={1} />
    </div>
  );
}
