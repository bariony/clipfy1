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

    const workerUrl = process.env.RENDER_WORKER_URL;
    const workerSecret = process.env.RENDER_WORKER_SECRET;
    if (!workerUrl || !workerSecret) {
      throw new Error("Worker de render não configurado. Verifique RENDER_WORKER_URL e RENDER_WORKER_SECRET.");
    }

    const [{ createHmac, randomUUID }, { getRequestUrl }, { supabaseAdmin }] = await Promise.all([
      import("crypto"),
      import("@tanstack/react-start/server"),
      import("@/integrations/supabase/client.server"),
    ]);

    const jobId = randomUUID();
    const outputPath = `${userId}/${project.id}/${clip.id}-${Date.now()}.mp4`;
    const expires = Math.floor(Date.now() / 1000) + 60 * 60 * 6;
    const signaturePayload = `${jobId}:${outputPath}:${expires}`;
    const uploadSignature = createHmac("sha256", workerSecret).update(signaturePayload).digest("hex");
    const requestOrigin = getRequestUrl().origin;
    const publicOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(requestOrigin)
      ? "https://clipfy1.lovable.app"
      : requestOrigin;
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
      callback_url: callbackUrl.toString(),
    };

    if (!edl.output.upload_url) {
      throw new Error("Falha ao preparar upload do render. Tente exportar novamente.");
    }

    await supabaseAdmin
      .from("render_jobs")
      .update({
        status: "failed",
        error_message: "Exportação substituída por uma nova tentativa.",
        completed_at: new Date().toISOString(),
      })
      .eq("clip_id", clip.id)
      .eq("user_id", userId)
      .in("status", ["queued", "processing"]);

    const { data: job, error: insertErr } = await supabase
      .from("render_jobs")
      .insert({
        id: jobId,
        user_id: userId,
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
        await supabaseAdmin
          .from("render_jobs")
          .update({ status: "failed", error_message: message, completed_at: new Date().toISOString() })
          .eq("id", job.id);
        throw new Error(message);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Falha ao chamar worker de render";
      await supabaseAdmin
        .from("render_jobs")
        .update({ status: "failed", error_message: message, completed_at: new Date().toISOString() })
        .eq("id", job.id);
      throw new Error(message);
    }

    return { jobId: job.id };
  });
