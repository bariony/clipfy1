import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Input = z.object({ projectId: z.string().uuid() });

const MAX_TRANSCRIBE_BYTES = 200 * 1024 * 1024; // 200MB safety cap for Worker memory

export const transcribeProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    // Load the project (RLS scopes to owner)
    const { data: project, error: loadErr } = await supabase
      .from("projects")
      .select("id, user_id, source, source_url, storage_path, language, status")
      .eq("id", data.projectId)
      .maybeSingle();
    if (loadErr) throw new Error(loadErr.message);
    if (!project) throw new Error("Project not found");
    if (project.user_id !== userId) throw new Error("Forbidden");

    if (project.source === "youtube") {
      await supabase
        .from("projects")
        .update({ status: "failed", error_message: "YouTube ingestion is not yet available." })
        .eq("id", project.id);
      throw new Error("YouTube ingestion is not yet available. Please upload a file for now.");
    }
    if (!project.storage_path) throw new Error("No video file attached to this project");

    // Mark as transcribing
    const { error: markErr } = await supabase
      .from("projects")
      .update({ status: "transcribing", error_message: null })
      .eq("id", project.id);
    if (markErr) throw new Error(markErr.message);

    try {
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
        segments?: unknown;
      };
      const fullText = (payload.text || "").trim();
      if (!fullText) throw new Error("Transcription returned empty text");

      // Upsert transcript row (one per project)
      const { error: delErr } = await supabase
        .from("transcripts")
        .delete()
        .eq("project_id", project.id);
      if (delErr) throw new Error(delErr.message);

      const { error: insErr } = await supabase.from("transcripts").insert({
        project_id: project.id,
        user_id: userId,
        language: payload.language || project.language || null,
        full_text: fullText,
        segments: (payload.segments as object) ?? null,
        provider: "lovable-ai:openai/gpt-4o-transcribe",
      });
      if (insErr) throw new Error(insErr.message);

      // Advance status to analyzing (next fatia will pick this up)
      const patch: Record<string, unknown> = { status: "analyzing" };
      if (payload.duration && Number.isFinite(payload.duration)) {
        patch.duration_seconds = Math.round(payload.duration);
      }
      const { error: statusErr } = await supabase
        .from("projects")
        .update(patch)
        .eq("id", project.id);
      if (statusErr) throw new Error(statusErr.message);

      return { ok: true as const, characters: fullText.length };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Transcription failed";
      await supabase
        .from("projects")
        .update({ status: "failed", error_message: message.slice(0, 500) })
        .eq("id", project.id);
      throw err instanceof Error ? err : new Error(message);
    }
  });
