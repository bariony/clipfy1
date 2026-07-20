import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Link2, Upload, Wand2, X, FileVideo } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
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

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB
const ACCEPTED = "video/mp4,video/quicktime,video/webm,video/x-matroska";


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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const [source, setSource] = useState<"upload" | "youtube">("upload");
  const [name, setName] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState("");
  const [language, setLanguage] = useState("auto");
  const [clipCount, setClipCount] = useState<number[]>([10]);
  const [minSec, setMinSec] = useState<number[]>([20]);
  const [maxSec, setMaxSec] = useState<number[]>([60]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);

  const { data: profile } = useQuery(profileQueryOptions());
  const estimatedCost = clipCount[0] * 5;
  const balance = profile?.credits ?? 0;
  const insufficient = balance < estimatedCost;

  function pickFile(f: File | null) {
    if (!f) return;
    if (!f.type.startsWith("video/")) {
      toast.error("Please choose a video file (mp4, mov, webm, mkv).");
      return;
    }
    if (f.size > MAX_FILE_SIZE) {
      toast.error("File too large", { description: "Max 500MB for now." });
      return;
    }
    setFile(f);
    if (!name.trim()) setName(f.name.replace(/\.[^.]+$/, ""));
  }

  async function uploadWithProgress(f: File): Promise<string> {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    const userId = sess.session?.user.id;
    if (!token || !userId) throw new Error("Not authenticated");

    const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
    const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
    const ext = f.name.split(".").pop()?.toLowerCase() || "mp4";
    const safeExt = ext.replace(/[^a-z0-9]/g, "").slice(0, 8) || "mp4";
    const path = `${userId}/${crypto.randomUUID()}.${safeExt}`;
    const url = `${SUPABASE_URL}/storage/v1/object/videos/${path}`;

    return new Promise<string>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;
      xhr.open("POST", url, true);
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.setRequestHeader("apikey", SUPABASE_KEY);
      xhr.setRequestHeader("x-upsert", "false");
      xhr.setRequestHeader("cache-control", "3600");
      if (f.type) xhr.setRequestHeader("content-type", f.type);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          setUploadProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
      xhr.onload = () => {
        xhrRef.current = null;
        if (xhr.status >= 200 && xhr.status < 300) resolve(path);
        else {
          let msg = `Upload failed (${xhr.status})`;
          try {
            const parsed = JSON.parse(xhr.responseText);
            if (parsed?.message) msg = parsed.message;
          } catch {
            /* noop */
          }
          reject(new Error(msg));
        }
      };
      xhr.onerror = () => {
        xhrRef.current = null;
        reject(new Error("Network error during upload"));
      };
      xhr.onabort = () => {
        xhrRef.current = null;
        reject(new Error("Upload cancelled"));
      };
      xhr.send(f);
    });
  }

  const createProject = useMutation({
    mutationFn: async () => {
      let storagePath = "";
      if (source === "upload" && file) {
        setUploading(true);
        setUploadProgress(0);
        try {
          storagePath = await uploadWithProgress(file);
        } finally {
          setUploading(false);
        }
      }
      const { data, error } = await supabase.rpc("create_project_with_credits", {
        _title: name.trim(),
        _description: description.trim(),
        _source: source,
        _source_url: source === "youtube" ? youtubeUrl.trim() : "",
        _storage_path: storagePath,
        _language: language,
        _target_clip_count: clipCount[0],
        _min_clip_seconds: minSec[0],
        _max_clip_seconds: maxSec[0],
        _estimated_cost: estimatedCost,
      });
      if (error) {
        // If RPC fails after upload, try to clean up the file
        if (storagePath) await supabase.storage.from("videos").remove([storagePath]).catch(() => {});
        throw error;
      }
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
      } else if (msg === "Upload cancelled") {
        toast.info("Upload cancelled");
      } else {
        toast.error("Could not create project", { description: msg });
      }
    },
  });

  function cancelUpload() {
    xhrRef.current?.abort();
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Give the project a name first.");
      return;
    }
    if (source === "upload" && !file) {
      toast.error("Choose a video file to upload.");
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
              <FileDropzone
                file={file}
                progress={uploadProgress}
                uploading={uploading}
                onPick={pickFile}
                onClear={() => {
                  setFile(null);
                  setUploadProgress(0);
                }}
                onCancel={cancelUpload}
                inputRef={fileInputRef}
              />

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
                {uploading ? `Uploading ${uploadProgress}%` : createProject.isPending ? "Creating..." : "Create project"}

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

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function FileDropzone({
  file,
  progress,
  uploading,
  onPick,
  onClear,
  onCancel,
  inputRef,
}: {
  file: File | null;
  progress: number;
  uploading: boolean;
  onPick: (f: File | null) => void;
  onClear: () => void;
  onCancel: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [dragging, setDragging] = useState(false);

  if (file) {
    return (
      <div className="rounded-xl border border-border bg-card/60 p-4">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-lg bg-primary/15 text-primary">
            <FileVideo className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{file.name}</div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              {formatBytes(file.size)}
              {uploading ? ` · uploading ${progress}%` : " · ready"}
            </div>
          </div>
          {uploading ? (
            <Button type="button" variant="outline" size="sm" onClick={onCancel} className="border-border bg-transparent">
              Cancel
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onClear}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Remove file"
            >
              <X className="size-4" />
            </Button>
          )}
        </div>
        {uploading && (
          <div className="mt-3">
            <Progress value={progress} className="h-1.5" />
          </div>
        )}
      </div>
    );
  }

  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const dropped = e.dataTransfer.files?.[0];
        if (dropped) onPick(dropped);
      }}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors",
        dragging ? "border-primary bg-primary/5" : "border-border bg-card/40 hover:border-primary/50",
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        className="hidden"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      />
      <Upload className="mb-3 size-6 text-muted-foreground" />
      <div className="text-sm font-semibold">Drop your video here or click to browse</div>
      <div className="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        MP4 · MOV · WEBM · MKV — up to 500MB
      </div>
    </label>
  );
}

