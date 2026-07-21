// Server-only helper to enqueue a render job for a clip.
// Reusable from server functions AND background flows (post-transcription auto-render).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export async function enqueueRenderForClip({
  supabase,
  clipId,
  origin,
}: {
  supabase: SupabaseClient<Database>;
  clipId: string;
  origin: string;
}): Promise<{ jobId: string } | { skipped: true; reason: string }> {
  const workerUrl = process.env.RENDER_WORKER_URL;
  const workerSecret = process.env.RENDER_WORKER_SECRET;
  if (!workerUrl || !workerSecret) {
    return { skipped: true, reason: "Worker de render não configurado." };
  }

  const { data: clip, error: clipErr } = await supabase
    .from("clips")
    .select("*")
    .eq("id", clipId)
    .maybeSingle();
  if (clipErr) throw new Error(clipErr.message);
  if (!clip) throw new Error("Clip não encontrado");

  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("*")
    .eq("id", clip.project_id)
    .maybeSingle();
  if (projErr) throw new Error(projErr.message);
  if (!project) throw new Error("Projeto não encontrado");

  const { data: transcript } = await supabase
    .from("transcripts")
    .select("segments, language")
    .eq("project_id", project.id)
    .maybeSingle();

  let sourceUrl: string | null = null;
  if (project.source === "upload" && project.storage_path) {
    const { data: signed } = await supabase.storage
      .from("videos")
      .createSignedUrl(project.storage_path, 60 * 60 * 6);
    sourceUrl = signed?.signedUrl ?? null;
  } else if (project.source_url) {
    sourceUrl = project.source_url;
  }

  const projectPreferences = (project.preferences as { aspect_ratio?: string; caption_template?: string; caption_position?: string; layout_mode?: string } | null) ?? {};
  const templateSlug =
    (clip.metadata as { template_slug?: string } | null)?.template_slug ??
    projectPreferences.caption_template ??
    "hormozi-slam";

  const { createHmac, randomUUID } = await import("crypto");

  const jobId = randomUUID();
  const outputPath = `${clip.user_id}/${project.id}/${clip.id}-${Date.now()}.mp4`;
  const expires = Math.floor(Date.now() / 1000) + 60 * 60 * 6;
  const signaturePayload = `${jobId}:${outputPath}:${expires}`;
  const uploadSignature = createHmac("sha256", workerSecret).update(signaturePayload).digest("hex");
  const publicOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(origin)
    ? "https://clipfy1.lovable.app"
    : origin;
  const uploadUrl = new URL("/api/public/render-upload", publicOrigin);
  uploadUrl.searchParams.set("job_id", jobId);
  uploadUrl.searchParams.set("path", outputPath);
  uploadUrl.searchParams.set("expires", String(expires));
  uploadUrl.searchParams.set("sig", uploadSignature);
  const callbackUrl = new URL("/api/public/render-callback", publicOrigin);

  const edl = {
    version: 1,
    source: { kind: project.source, url: sourceUrl },
    output: {
      bucket: "renders",
      path: outputPath,
      upload_url: uploadUrl.toString(),
      aspect_ratio: projectPreferences.aspect_ratio ?? "9:16",
    },
    clip: {
      id: clip.id,
      title: clip.title,
      start: Number(clip.start_seconds),
      end: Number(clip.end_seconds),
    },
    captions: {
      enabled: templateSlug !== "none",
      template: templateSlug,
      language: transcript?.language ?? project.language ?? "auto",
      segments: transcript?.segments ?? [],
    },
    scene_plan: clip.scene_plan ?? null,
    layout: projectPreferences.layout_mode ?? "auto",
    caption_position: projectPreferences.caption_position ?? "bottom",
    callback_url: callbackUrl.toString(),
  };

  // Marca jobs antigos como substituídos
  await supabase
    .from("render_jobs")
    .update({
      status: "failed",
      error_message: "Substituído por novo render.",
      completed_at: new Date().toISOString(),
    })
    .eq("clip_id", clip.id)
    .in("status", ["queued", "processing"]);

  const { data: job, error: insertErr } = await supabase
    .from("render_jobs")
    .insert({
      id: jobId,
      user_id: clip.user_id,
      project_id: project.id,
      clip_id: clip.id,
      status: "queued",
      edl: JSON.parse(JSON.stringify(edl)) as never,
    })
    .select("*")
    .single();
  if (insertErr) throw new Error(insertErr.message);

  try {
    const res = await fetch(`${workerUrl.replace(/\/$/, "")}/jobs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${workerSecret}`,
      },
      body: JSON.stringify({ job_id: job.id, edl }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const message = `Worker recusou o job (${res.status})${detail ? `: ${detail.slice(0, 180)}` : ""}`;
      await supabase
        .from("render_jobs")
        .update({ status: "failed", error_message: message, completed_at: new Date().toISOString() })
        .eq("id", job.id);
      throw new Error(message);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Falha ao chamar worker de render";
    await supabase
      .from("render_jobs")
      .update({ status: "failed", error_message: message, completed_at: new Date().toISOString() })
      .eq("id", job.id);
    throw err instanceof Error ? err : new Error(message);
  }

  return { jobId: job.id };
}

export async function autoEnqueueRendersForProject({
  supabase,
  projectId,
  origin,
}: {
  supabase: SupabaseClient<Database>;
  projectId: string;
  origin: string;
}) {
  const { data: clips } = await supabase
    .from("clips")
    .select("id")
    .eq("project_id", projectId);
  if (!clips) return 0;
  let ok = 0;
  for (const c of clips) {
    try {
      const res = await enqueueRenderForClip({ supabase, clipId: c.id, origin });
      if (!("skipped" in res)) ok += 1;
    } catch (err) {
      console.warn("[auto-render] falha no clip", c.id, err);
    }
  }
  return ok;
}
