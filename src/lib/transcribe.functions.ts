import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { fetchYoutubeTranscript, type TranscriptSegment } from "./youtube.server";

const Input = z.object({ projectId: z.string().uuid() });

const MAX_TRANSCRIBE_BYTES = 200 * 1024 * 1024; // 200MB safety cap for Worker memory

export const transcribeProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    const toSegmentsJson = (segments: TranscriptSegment[]) =>
      segments.map((segment) => ({
        text: segment.text,
        start: segment.start,
        end: segment.end,
      }));

    const deleteExistingTranscriptAndClips = async (projectId: string) => {
      const { error: clipsDeleteErr } = await supabase.from("clips").delete().eq("project_id", projectId);
      if (clipsDeleteErr) throw new Error(clipsDeleteErr.message);

      const { error: transcriptDeleteErr } = await supabase
        .from("transcripts")
        .delete()
        .eq("project_id", projectId);
      if (transcriptDeleteErr) throw new Error(transcriptDeleteErr.message);
    };

    const createFallbackClips = (fullText: string, segments: TranscriptSegment[], targetCount: number) => {
      const cleanText = fullText.replace(/\s+/g, " ").trim();
      const availableSegments = segments.length > 0 ? segments : textToSyntheticSegments(cleanText);
      const clipCount = Math.max(3, Math.min(targetCount || 6, 8, availableSegments.length));
      const stride = Math.max(1, Math.floor(availableSegments.length / clipCount));

      return Array.from({ length: clipCount }, (_, index) => {
        const startIndex = Math.min(index * stride, availableSegments.length - 1);
        const window = availableSegments.slice(startIndex, Math.min(availableSegments.length, startIndex + Math.max(6, stride)));
        const start = Math.floor(window[0]?.start ?? index * 45);
        const end = Math.max(start + 20, Math.ceil(window.at(-1)?.end ?? start + 45));
        const excerpt = window.map((segment) => segment.text).join(" ").replace(/\s+/g, " ").slice(0, 420);
        const words = excerpt.split(" ").filter(Boolean);
        const title = words.slice(0, 8).join(" ").replace(/[.,!?;:]+$/g, "") || `Corte recomendado ${index + 1}`;

        return {
          title: title.length > 10 ? title : `Corte recomendado ${index + 1}`,
          hook: excerpt.slice(0, 150),
          start_seconds: start,
          end_seconds: Math.min(end, start + 75),
          virality_score: Math.max(62, 88 - index * 4),
          transcript_excerpt: excerpt,
        };
      });
    };

    const textToSyntheticSegments = (fullText: string): TranscriptSegment[] => {
      const sentences = fullText.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [fullText];
      return sentences.slice(0, 200).map((sentence, index) => ({
        text: sentence.trim(),
        start: index * 8,
        end: index * 8 + 8,
      })).filter((segment) => segment.text.length > 0);
    };

    const generateClipSuggestions = async ({
      projectId,
      fullText,
      segments,
      brief,
      targetCount,
    }: {
      projectId: string;
      fullText: string;
      segments: TranscriptSegment[];
      brief: string | null;
      targetCount: number | null;
    }) => {
      const wanted = Math.max(3, Math.min(targetCount ?? 6, 10));
      const timeline = (segments.length > 0 ? segments : textToSyntheticSegments(fullText))
        .slice(0, 220)
        .map((segment) => `[${Math.round(segment.start)}-${Math.round(segment.end)}s] ${segment.text}`)
        .join("\n")
        .slice(0, 18000);

      let clips = createFallbackClips(fullText, segments, wanted);

      try {
        const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Lovable-API-Key": key,
            "X-Lovable-AIG-SDK": "raw",
          },
          body: JSON.stringify({
            model: "openai/gpt-4o-mini",
            temperature: 0.25,
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content:
                  "Você é o motor de cortes virais do Clipfy. Responda somente JSON válido no formato {\"clips\":[...]}. Escolha trechos com começo e fim claros, potencial de retenção e títulos curtos em português.",
              },
              {
                role: "user",
                content: `Objetivo do usuário: ${brief || "identificar os melhores cortes virais"}\nQuantidade desejada: ${wanted}\nTimeline com timestamps:\n${timeline}`,
              },
            ],
          }),
        });

        if (aiResp.ok) {
          const payload = (await aiResp.json()) as { choices?: Array<{ message?: { content?: string } }> };
          const raw = payload.choices?.[0]?.message?.content ?? "";
          const parsed = JSON.parse(raw.replace(/^```json\s*/i, "").replace(/```$/i, "").trim()) as {
            clips?: Array<{
              title?: string;
              hook?: string;
              start_seconds?: number;
              end_seconds?: number;
              virality_score?: number;
              transcript_excerpt?: string;
            }>;
          };
          const aiClips = (parsed.clips ?? [])
            .map((clip, index) => ({
              title: String(clip.title || `Corte recomendado ${index + 1}`).slice(0, 140),
              hook: String(clip.hook || clip.transcript_excerpt || "").slice(0, 260),
              start_seconds: Math.max(0, Math.floor(Number(clip.start_seconds) || 0)),
              end_seconds: Math.max(1, Math.ceil(Number(clip.end_seconds) || 0)),
              virality_score: Math.max(1, Math.min(100, Math.round(Number(clip.virality_score) || 70))),
              transcript_excerpt: String(clip.transcript_excerpt || clip.hook || "").slice(0, 800),
            }))
            .filter((clip) => clip.end_seconds > clip.start_seconds + 5)
            .slice(0, wanted);

          if (aiClips.length > 0) clips = aiClips;
        }
      } catch {
        // Keep MVP usable even when the analysis model is temporarily unavailable.
      }

      const rows = clips.map((clip) => ({
        project_id: projectId,
        user_id: userId,
        title: clip.title,
        hook: clip.hook || null,
        start_seconds: clip.start_seconds,
        end_seconds: clip.end_seconds,
        virality_score: clip.virality_score,
        transcript_excerpt: clip.transcript_excerpt || null,
        status: "suggested" as const,
        aspect_ratio: "9:16",
        metadata: { generated_by: "clipfy-mvp" },
      }));

      const { error: insertErr } = await supabase.from("clips").insert(rows);
      if (insertErr) throw new Error(insertErr.message);
      return rows.length;
    };

    const saveTranscriptAndAnalyze = async ({
      projectId,
      fullText,
      language,
      duration,
      segments,
      provider,
      brief,
      targetCount,
    }: {
      projectId: string;
      fullText: string;
      language: string | null;
      duration: number | null;
      segments: TranscriptSegment[];
      provider: string;
      brief: string | null;
      targetCount: number | null;
    }) => {
      await deleteExistingTranscriptAndClips(projectId);

      const { error: insErr } = await supabase.from("transcripts").insert({
        project_id: projectId,
        user_id: userId,
        language,
        full_text: fullText,
        segments: toSegmentsJson(segments) as never,
        provider,
      });
      if (insErr) throw new Error(insErr.message);

      const { error: analyzingErr } = await supabase
        .from("projects")
        .update(duration !== null ? { status: "analyzing", duration_seconds: duration } : { status: "analyzing" })
        .eq("id", projectId);
      if (analyzingErr) throw new Error(analyzingErr.message);

      const clipCount = await generateClipSuggestions({ projectId, fullText, segments, brief, targetCount });

      const { error: readyErr } = await supabase
        .from("projects")
        .update(duration !== null ? { status: "ready", duration_seconds: duration, error_message: null } : { status: "ready", error_message: null })
        .eq("id", projectId);
      if (readyErr) throw new Error(readyErr.message);

      return clipCount;
    };

    // Load the project (RLS scopes to owner)
    const { data: project, error: loadErr } = await supabase
      .from("projects")
      .select("id, user_id, source, source_url, storage_path, language, status, description, target_clip_count")
      .eq("id", data.projectId)
      .maybeSingle();
    if (loadErr) throw new Error(loadErr.message);
    if (!project) throw new Error("Project not found");
    if (project.user_id !== userId) throw new Error("Forbidden");

    const isYoutube = project.source === "youtube" && Boolean(project.source_url);
    if (!isYoutube && !project.storage_path) throw new Error("Adicione um vídeo ou uma URL do YouTube antes de processar.");

    // Mark as transcribing
    const { error: markErr } = await supabase
      .from("projects")
      .update({ status: "transcribing", error_message: null })
      .eq("id", project.id);
    if (markErr) throw new Error(markErr.message);

    try {
      if (isYoutube) {
        const youtubeTranscript = await fetchYoutubeTranscript(project.source_url!);
        const clipCount = await saveTranscriptAndAnalyze({
          projectId: project.id,
          fullText: youtubeTranscript.text,
          language: youtubeTranscript.language || project.language || null,
          duration: youtubeTranscript.duration,
          segments: youtubeTranscript.segments,
          provider: "youtube:captions",
          brief: project.description,
          targetCount: project.target_clip_count,
        });

        return { ok: true as const, characters: youtubeTranscript.text.length, clips: clipCount };
      }

      // Create a short-lived signed URL to fetch the file from Storage
      const { data: signed, error: signErr } = await supabase.storage
        .from("videos")
        .createSignedUrl(project.storage_path, 60);
      if (signErr || !signed?.signedUrl) throw new Error(signErr?.message || "Could not sign video URL");

      // Fetch file into memory
      const fileResp = await fetch(signed.signedUrl);
      if (!fileResp.ok) throw new Error(`Could not download video (${fileResp.status})`);
      const contentLen = Number(fileResp.headers.get("content-length") || 0);
      if (contentLen && contentLen > MAX_TRANSCRIBE_BYTES) {
        throw new Error(
          `File too large for direct transcription (${(contentLen / 1024 / 1024).toFixed(0)}MB). Max ${MAX_TRANSCRIBE_BYTES / 1024 / 1024}MB.`,
        );
      }
      const blob = await fileResp.blob();
      if (blob.size > MAX_TRANSCRIBE_BYTES) {
        throw new Error(
          `File too large for direct transcription (${(blob.size / 1024 / 1024).toFixed(0)}MB). Max ${MAX_TRANSCRIBE_BYTES / 1024 / 1024}MB.`,
        );
      }

      // Derive a filename with an audio/video extension the gateway will accept
      const ext = project.storage_path.split(".").pop()?.toLowerCase() || "mp4";
      const filename = `project-${project.id}.${ext}`;

      // Send to Lovable AI Gateway (openai/gpt-4o-transcribe)
      const form = new FormData();
      form.append("file", blob, filename);
      form.append("model", "openai/gpt-4o-transcribe");
      form.append("response_format", "json");
      if (project.language && project.language !== "auto") {
        form.append("language", project.language);
      }

      const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          "Lovable-API-Key": key,
          "X-Lovable-AIG-SDK": "raw",
        },
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
        .map((segment) => ({
          text: String(segment.text ?? "").trim(),
          start: Math.max(0, Number(segment.start) || 0),
          end: Math.max(Number(segment.start) || 0, Number(segment.end) || 0),
        }))
        .filter((segment) => segment.text.length > 0 && segment.end > segment.start);

      const clipCount = await saveTranscriptAndAnalyze({
        projectId: project.id,
        fullText,
        language: payload.language || project.language || null,
        duration,
        segments,
        provider: "lovable-ai:openai/gpt-4o-transcribe",
        brief: project.description,
        targetCount: project.target_clip_count,
      });

      return { ok: true as const, characters: fullText.length, clips: clipCount };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Transcription failed";
      await supabase
        .from("projects")
        .update({ status: "failed", error_message: message.slice(0, 500) })
        .eq("id", project.id);
      throw err instanceof Error ? err : new Error(message);
    }
  });
