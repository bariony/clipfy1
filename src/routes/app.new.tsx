import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Wand2 } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { supabase } from "@/integrations/supabase/client";

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
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [language, setLanguage] = useState("auto");
  const [clipCount, setClipCount] = useState<number[]>([10]);
  const [minSec, setMinSec] = useState<number[]>([20]);
  const [maxSec, setMaxSec] = useState<number[]>([60]);

  const createProject = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("create_project_with_credits", {
        _title: name.trim(),
        _description: description.trim(),
        _source: "upload",
        _source_url: "",
        _storage_path: "",
        _language: language,
        _target_clip_count: clipCount[0],
        _min_clip_seconds: minSec[0],
        _max_clip_seconds: maxSec[0],
        _estimated_cost: 0,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      toast.success("Draft project created", {
        description: "Now upload the video inside the project.",
      });
      const id = (project as { id?: string } | null)?.id;
      if (id) navigate({ to: "/app/projects/$id", params: { id } });
      else navigate({ to: "/app/projects" });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Failed to create project";
      toast.error("Could not create project", { description: msg });
    },
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Give the project a name first.");
      return;
    }
    if (minSec[0] > maxSec[0]) {
      toast.error("Min clip duration must be ≤ max.");
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
            Create the draft first. Upload and processing happen inside the project.
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

          <Section title="Description" hint="Optional. Helps the AI understand your content.">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Interview with a founder on scaling early-stage teams..."
              rows={3}
            />
          </Section>

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

          <Section title="Clip generation" hint="Saved for the analysis step">
            <div className="space-y-6">
              <SliderRow
                label="Clips to generate"
                value={clipCount[0]}
                unit=" clips"
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

          <div className="flex items-center justify-between border-t border-border pt-6">
            <div className="font-mono text-xs text-muted-foreground">
              Draft creation: <span className="text-primary">0 credits</span>
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
                disabled={createProject.isPending}
              >
                <Wand2 className="mr-2 size-4" />
                {createProject.isPending ? "Creating..." : "Create draft"}
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

