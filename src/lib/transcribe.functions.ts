import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { sanitizeStoredProcessingError } from "./processing-errors";

const Input = z.object({ projectId: z.string().uuid() });

export const transcribeProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;


    // Carrega o projeto (RLS aplica)
    const { data: project, error: loadErr } = await supabase
      .from("projects")
      .select(
        "id, user_id, source, source_url, storage_path, language, status, description, target_clip_count",
      )
      .eq("id", data.projectId)
      .maybeSingle();
    if (loadErr) throw new Error(loadErr.message);
    if (!project) throw new Error("Project not found");
    if (project.user_id !== userId) throw new Error("Forbidden");

    const youtubeUrl = project.source === "youtube" ? project.source_url : null;
    const storagePath = project.storage_path;
    if (!youtubeUrl && !storagePath) {
      throw new Error("Adicione um vídeo ou uma URL do YouTube antes de processar.");
    }

    const transcribeJobId = crypto.randomUUID();

    // Marca como transcribing e cria um token da tentativa atual.
    // Callbacks antigos do worker não podem mais sobrescrever retries novos.
    const { error: markErr } = await supabase
      .from("projects")
      .update({
        status: "transcribing",
        error_message: null,
        transcribe_progress: 1,
        active_transcribe_job_id: transcribeJobId,
      })
      .eq("id", project.id);
    if (markErr) throw new Error(markErr.message);

    // -------- Worker path: YouTube ou Upload grande --------
    const workerUrl = process.env.RENDER_WORKER_URL;
    const workerSecret = process.env.RENDER_WORKER_SECRET;

    let workerSourceUrl: string | null = youtubeUrl;
    if (!workerSourceUrl && storagePath) {
      // Gera signed URL do upload pro worker baixar (24h)
      const { data: signed, error: signErr } = await supabase.storage
        .from("videos")
        .createSignedUrl(storagePath, 60 * 60 * 24);
      if (signErr || !signed?.signedUrl) {
        await supabase
          .from("projects")
          .update({
            status: "failed",
            error_message: signErr?.message ?? "Falha ao gerar URL do vídeo.",
            transcribe_progress: 0,
            active_transcribe_job_id: null,
          })
          .eq("id", project.id);
        throw new Error(signErr?.message || "Could not sign video URL");
      }
      workerSourceUrl = signed.signedUrl;
    }

    if (workerSourceUrl) {
      if (!workerUrl || !workerSecret) {
        await supabase
          .from("projects")
          .update({
            status: "failed",
            error_message: "Worker de transcrição não configurado.",
            transcribe_progress: 0,
            active_transcribe_job_id: null,
          })
          .eq("id", project.id);
        throw new Error("Worker de transcrição não configurado (RENDER_WORKER_URL/SECRET).");
      }

      const { getRequestUrl } = await import("@tanstack/react-start/server");
      const requestOrigin = getRequestUrl().origin;
      const publicOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(requestOrigin)
        ? "https://clipfy1.lovable.app"
        : requestOrigin;
      const callbackUrlObject = new URL("/api/public/transcribe-callback", publicOrigin);
      callbackUrlObject.searchParams.set("attempt_id", transcribeJobId);
      const callbackUrl = callbackUrlObject.toString();

      try {
        const res = await fetch(`${workerUrl.replace(/\/$/, "")}/transcribe`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${workerSecret}`,
          },
          body: JSON.stringify({
            job_id: project.id,
            transcribe_job_id: transcribeJobId,
            source_url: workerSourceUrl,
            language: project.language && project.language !== "auto" ? project.language : null,
            callback_url: callbackUrl,
          }),
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          const cleanDetail = sanitizeStoredProcessingError(detail) ?? detail.slice(0, 200);
          throw new Error(`Worker recusou (${res.status}): ${cleanDetail}`);
        }
      } catch (err) {
        const rawMessage = err instanceof Error ? err.message : "Falha ao contatar worker";
        const message = sanitizeStoredProcessingError(rawMessage) ?? rawMessage;
        await supabase
          .from("projects")
          .update({
            status: "failed",
            error_message: message.slice(0, 500),
            transcribe_progress: 0,
            active_transcribe_job_id: null,
          })
          .eq("id", project.id);
        throw new Error(message);
      }

      return { ok: true as const, dispatched: true as const, characters: 0, clips: 0 };
    }

    throw new Error("Nenhum arquivo de vídeo anexado ao projeto.");
  });

