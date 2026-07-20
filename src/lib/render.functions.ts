import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Input = z.object({ clipId: z.string().uuid() });

export const enqueueClipRender = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: clip, error: clipErr } = await supabase
      .from("clips")
      .select("*")
      .eq("id", data.clipId)
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

    // Signed URL for uploaded source (worker downloads from here)
    let sourceUrl: string | null = null;
    if (project.source === "upload" && project.storage_path) {
      const { data: signed } = await supabase.storage
        .from("videos")
        .createSignedUrl(project.storage_path, 60 * 60 * 6);
      sourceUrl = signed?.signedUrl ?? null;
    } else if (project.source_url) {
      sourceUrl = project.source_url;
    }

    const templateSlug =
      (clip.metadata as { template_slug?: string } | null)?.template_slug ?? "hormozi-slam";

    const outputPath = `${userId}/${project.id}/${clip.id}-${Date.now()}.mp4`;

    // Signed PUT URL so the worker can upload the final MP4 without service-role key
    const { data: uploadSigned, error: uploadErr } = await supabase.storage
      .from("renders")
      .createSignedUploadUrl(outputPath);
    if (uploadErr) throw new Error(`upload url: ${uploadErr.message}`);

    const edl = {
      version: 1,
      source: { kind: project.source, url: sourceUrl },
      output: {
        bucket: "renders",
        path: outputPath,
        upload_url: uploadSigned.signedUrl,
        upload_token: uploadSigned.token,
        aspect_ratio:
          (project.preferences as { aspect_ratio?: string } | null)?.aspect_ratio ?? "9:16",
      },
      clip: {
        id: clip.id,
        title: clip.title,
        start: Number(clip.start_seconds),
        end: Number(clip.end_seconds),
      },
      captions: {
        template: templateSlug,
        language: transcript?.language ?? project.language ?? "auto",
        segments: transcript?.segments ?? [],
      },
      layout: (project.preferences as { layout_mode?: string } | null)?.layout_mode ?? "auto",
      caption_position:
        (project.preferences as { caption_position?: string } | null)?.caption_position ?? "bottom",
    };

    const { data: job, error: insertErr } = await supabase
      .from("render_jobs")
      .insert({
        user_id: userId,
        project_id: project.id,
        clip_id: clip.id,
        status: "queued",
        edl: edl as never,
      })
      .select("*")
      .single();
    if (insertErr) throw new Error(insertErr.message);

    // Best-effort worker notification. Worker polls /api/public/render-next as fallback.
    const workerUrl = process.env.RENDER_WORKER_URL;
    const workerSecret = process.env.RENDER_WORKER_SECRET;
    if (workerUrl && workerSecret) {
      try {
        await fetch(`${workerUrl.replace(/\/$/, "")}/jobs`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${workerSecret}`,
          },
          body: JSON.stringify({ job_id: job.id }),
        });
      } catch (err) {
        console.warn("[render] worker notify failed", err);
      }
    }

    return { jobId: job.id };
  });
