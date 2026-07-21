import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { sanitizeStoredProcessingError } from "./processing-errors";

const Input = z.object({ projectId: z.string().uuid() });

const MAX_TRANSCRIBE_BYTES = 200 * 1024 * 1024; // 200MB safety cap

export const transcribeProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

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

    // -------- Caminho YouTube: delega pro worker (yt-dlp + Groq) --------
    if (youtubeUrl) {
      const workerUrl = process.env.RENDER_WORKER_URL;
      const workerSecret = process.env.RENDER_WORKER_SECRET;
      if (!workerUrl || !workerSecret) {
        await supabase
          .from("projects")
          .update({ status: "failed", error_message: "Worker de transcrição não configurado." })
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
            source_url: youtubeUrl,
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

    // -------- Caminho Upload: transcreve direto pelo AI Gateway --------
    try {
      if (!storagePath) throw new Error("Nenhum arquivo de vídeo anexado ao projeto.");

      const { data: signed, error: signErr } = await supabase.storage
        .from("videos")
        .createSignedUrl(storagePath, 60);
      if (signErr || !signed?.signedUrl)
        throw new Error(signErr?.message || "Could not sign video URL");

      const fileResp = await fetch(signed.signedUrl);
      if (!fileResp.ok) throw new Error(`Could not download video (${fileResp.status})`);
      const contentLen = Number(fileResp.headers.get("content-length") || 0);
      if (contentLen && contentLen > MAX_TRANSCRIBE_BYTES) {
        throw new Error(
          `File too large (${(contentLen / 1024 / 1024).toFixed(0)}MB). Max ${MAX_TRANSCRIBE_BYTES / 1024 / 1024}MB.`,
        );
      }
      const blob = await fileResp.blob();
      if (blob.size > MAX_TRANSCRIBE_BYTES) {
        throw new Error(`File too large (${(blob.size / 1024 / 1024).toFixed(0)}MB).`);
      }

      const ext = storagePath.split(".").pop()?.toLowerCase() || "mp4";
      const filename = `project-${project.id}.${ext}`;

      const form = new FormData();
      form.append("file", blob, filename);
      form.append("model", "openai/gpt-4o-transcribe");
      form.append("response_format", "json");
      if (project.language && project.language !== "auto")
        form.append("language", project.language);

      const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
        method: "POST",
        headers: { "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "raw" },
        body: form,
      });
      if (!aiResp.ok) {
        const errText = await aiResp.text().catch(() => "");
        if (aiResp.status === 429) throw new Error("AI rate limit hit. Please retry in a moment.");
        if (aiResp.status === 402) throw new Error("AI credits exhausted for this workspace.");
        throw new Error(`Transcription failed (${aiResp.status}): ${errText.slice(0, 300)}`);
      }

      const payload = (await aiResp.json()) as {
        text?: string;
        language?: string;
        duration?: number;
        segments?: Array<{ text?: string; start?: number; end?: number }>;
      };
      const fullText = (payload.text || "").trim();
      if (!fullText) throw new Error("Transcription returned empty text");

      const duration =
        payload.duration && Number.isFinite(payload.duration) ? Math.round(payload.duration) : null;
      const segments = (payload.segments ?? [])
        .map((s) => ({
          text: String(s.text ?? "").trim(),
          start: Math.max(0, Number(s.start) || 0),
          end: Math.max(Number(s.start) || 0, Number(s.end) || 0),
        }))
        .filter((s) => s.text.length > 0 && s.end > s.start);

      // Apaga transcrição/clips antigos
      await supabase.from("clips").delete().eq("project_id", project.id);
      await supabase.from("transcripts").delete().eq("project_id", project.id);

      const { error: insErr } = await supabase.from("transcripts").insert({
        project_id: project.id,
        user_id: userId,
        language: payload.language || project.language || null,
        full_text: fullText,
        segments: segments as never,
        provider: "lovable-ai:openai/gpt-4o-transcribe",
      });
      if (insErr) throw new Error(insErr.message);

      await supabase
        .from("projects")
        .update(
          duration !== null
            ? { status: "analyzing", duration_seconds: duration, transcribe_progress: 85 }
            : { status: "analyzing", transcribe_progress: 85 },
        )
        .eq("id", project.id);

      const { generateAndSaveClipSuggestions } = await import("./clip-suggest.server");
      const { getRequestUrl: _getUrl } = await import("@tanstack/react-start/server");
      const clipCount = await generateAndSaveClipSuggestions({
        supabase,
        userId,
        projectId: project.id,
        fullText,
        segments,
        brief: project.description,
        targetCount: project.target_clip_count,
        apiKey: key,
        origin: _getUrl().origin,
      });

      await supabase
        .from("projects")
        .update(
          duration !== null
            ? {
                status: "ready",
                duration_seconds: duration,
                error_message: null,
                transcribe_progress: 100,
                active_transcribe_job_id: null,
              }
            : {
                status: "ready",
                error_message: null,
                transcribe_progress: 100,
                active_transcribe_job_id: null,
              },
        )
        .eq("id", project.id);

      return {
        ok: true as const,
        dispatched: false as const,
        characters: fullText.length,
        clips: clipCount,
      };
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : "Transcription failed";
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
      throw err instanceof Error ? err : new Error(message);
    }
  });
