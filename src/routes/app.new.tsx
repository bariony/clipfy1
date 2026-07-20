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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { profileQueryOptions } from "@/lib/projects";

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

function NewProject() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [source, setSource] = useState<"upload" | "youtube">("upload");
  const [name, setName] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [description, setDescription] = useState("");
  const [language, setLanguage] = useState("auto");
  const [clipCount, setClipCount] = useState<number[]>([10]);
  const [minSec, setMinSec] = useState<number[]>([20]);
  const [maxSec, setMaxSec] = useState<number[]>([60]);

  const { data: profile } = useQuery(profileQueryOptions());
  const estimatedCost = clipCount[0] * 5;
  const balance = profile?.credits ?? 0;
  const insufficient = balance < estimatedCost;

  const createProject = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("create_project_with_credits", {
        _title: name.trim(),
        _description: description.trim(),
        _source: source,
        _source_url: source === "youtube" ? youtubeUrl.trim() : "",
        _storage_path: "",
        _language: language,
        _target_clip_count: clipCount[0],
        _min_clip_seconds: minSec[0],
        _max_clip_seconds: maxSec[0],
        _estimated_cost: estimatedCost,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      toast.success("Project created", {
        description: `${estimatedCost} credits deducted.`,
      });
      const id = (project as { id?: string } | null)?.id;
      if (id) navigate({ to: "/app/projects/$id", params: { id } });
      else navigate({ to: "/app/projects" });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Failed to create project";
      if (msg.includes("insufficient_credits")) {
        toast.error("Insufficient credits", {
          description: `You need ${estimatedCost} credits (you have ${balance}).`,
        });
      } else {
        toast.error("Could not create project", { description: msg });
      }
    },
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Give the project a name first.");
      return;
    }
    if (source === "youtube" && !youtubeUrl.trim()) {
      toast.error("Paste a YouTube URL.");
      return;
    }
    if (minSec[0] > maxSec[0]) {
      toast.error("Min clip duration must be ≤ max.");
      return;
    }
    if (insufficient) {
      toast.error("Insufficient credits", {
        description: `You need ${estimatedCost} credits (you have ${balance}).`,
      });
      return;
    }
    createProject.mutate();
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
          <Section title="Project name" hint="A short handle you'll recognize later.">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Podcast E42 · Founder mode"
              required
            />
          </Section>

          <Section title="Source" hint="Upload a file or paste a YouTube URL.">
            <div className="mb-4 grid grid-cols-2 gap-2">
              <SourceTab
                active={source === "upload"}
                onClick={() => setSource("upload")}
                icon={Upload}
                label="Upload file"
                hint="MP4 · MOV · WEBM"
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
              <div className="rounded-xl border border-dashed border-border bg-card/40 px-6 py-8 text-center">
                <Upload className="mx-auto mb-3 size-6 text-muted-foreground" />
                <div className="text-sm font-semibold">Create the project first</div>
                <div className="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Upload the video on the project screen with progress and cancel controls
                </div>
              </div>
            ) : (
              <Input
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                placeholder="https://youtube.com/watch?v=..."
                inputMode="url"
              />
            )}
          </Section>

          <Section title="Description" hint="Optional. Helps the AI understand your content.">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Interview with a founder on scaling early-stage teams..."
              rows={3}
            />
          </Section>

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
            <Section title="Credits balance" hint="Deducted on create">
              <div className="flex h-10 items-center justify-between rounded-md border border-border bg-secondary/40 px-3 font-mono text-sm">
                <span className="text-muted-foreground">Available</span>
                <span className={cn("font-bold", insufficient ? "text-destructive" : "text-primary")}>
                  {balance} cr
                </span>
              </div>
            </Section>
          </div>

          <Section title="Clip generation" hint="How aggressive should the AI be?">
            <div className="space-y-6">
              <SliderRow label="Clips to generate" value={clipCount[0]} unit=" clips" min={3} max={30} onChange={setClipCount} />
              <SliderRow label="Min clip duration" value={minSec[0]} unit="s" min={10} max={90} onChange={setMinSec} />
              <SliderRow label="Max clip duration" value={maxSec[0]} unit="s" min={20} max={180} onChange={setMaxSec} />
            </div>
          </Section>

          <div className="flex items-center justify-between border-t border-border pt-6">
            <div className="font-mono text-xs text-muted-foreground">
              Est. cost:{" "}
              <span className={cn(insufficient ? "text-destructive" : "text-primary")}>
                {estimatedCost} credits
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
                disabled={createProject.isPending || insufficient}
              >
                <Wand2 className="mr-2 size-4" />
                {createProject.isPending ? "Creating..." : "Create project"}

              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
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
        active ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/40",
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
        <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{hint}</div>
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

