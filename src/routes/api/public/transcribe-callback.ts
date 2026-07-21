import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";
import { sanitizeStoredProcessingError } from "@/lib/processing-errors";

const Word = z.object({ word: z.string(), start: z.number(), end: z.number() });
const Segment = z.object({
  text: z.string(),
  start: z.number(),
  end: z.number(),
  words: z.array(Word).optional(),
});

const Payload = z.object({
  job_id: z.string().uuid(), // = project_id
  status: z.enum(["processing", "completed", "failed"]),
  progress: z.number().int().min(0).max(100).optional(),
  language: z.string().nullable().optional(),
  duration: z.number().nullable().optional(),
  full_text: z.string().optional(),
  segments: z.array(Segment).optional(),
  error_message: z.string().optional(),
  worker_id: z.string().optional(),
});

function safeEqualHex(a: string, b: string) {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length || ab.length === 0) return false;
  return timingSafeEqual(ab, bb);
}

export const Route = createFileRoute("/api/public/transcribe-callback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.RENDER_WORKER_SECRET;
        const key = process.env.LOVABLE_API_KEY;
        if (!secret) return new Response("Server misconfigured", { status: 500 });

        const signature = request.headers.get("x-render-signature") ?? "";
        const body = await request.text();
        const expected = createHmac("sha256", secret).update(body).digest("hex");
        if (!safeEqualHex(signature, expected)) {
          return new Response("Invalid signature", { status: 401 });
        }

        let parsed: z.infer<typeof Payload>;
        try {
          parsed = Payload.parse(JSON.parse(body));
        } catch (err) {
          return new Response(`Invalid payload: ${(err as Error).message}`, { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Confirma que o projeto existe (job_id = project_id)
        const { data: project, error: projErr } = await supabaseAdmin
          .from("projects")
          .select("id, user_id, description, target_clip_count, language")
          .eq("id", parsed.job_id)
          .maybeSingle();
        if (projErr) return new Response(projErr.message, { status: 500 });
        if (!project) return new Response("Project not found", { status: 404 });

        if (parsed.status === "processing") {
          await supabaseAdmin
            .from("projects")
            .update({ status: "transcribing", error_message: null })
            .eq("id", project.id);
          return Response.json({ ok: true });
        }

        if (parsed.status === "failed") {
          const message =
            sanitizeStoredProcessingError(parsed.error_message) ?? "Transcription failed";
          await supabaseAdmin
            .from("projects")
            .update({ status: "failed", error_message: message.slice(0, 500) })
            .eq("id", project.id);
          return Response.json({ ok: true });
        }

        // completed
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });
        const segments = (parsed.segments ?? []).map((s) => ({
          text: s.text,
          start: s.start,
          end: s.end,
          words: s.words,
        }));
        const fullText =
          parsed.full_text?.trim() ||
          segments
            .map((s) => s.text)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
        if (!fullText) {
          await supabaseAdmin
            .from("projects")
            .update({ status: "failed", error_message: "Transcrição retornou vazia." })
            .eq("id", project.id);
          return new Response("empty transcript", { status: 400 });
        }

        // Substitui transcrição/clips anteriores
        await supabaseAdmin.from("clips").delete().eq("project_id", project.id);
        await supabaseAdmin.from("transcripts").delete().eq("project_id", project.id);

        const { error: insErr } = await supabaseAdmin.from("transcripts").insert({
          project_id: project.id,
          user_id: project.user_id,
          language: parsed.language ?? project.language ?? null,
          full_text: fullText,
          segments: segments as never,
          provider: "worker:groq/whisper-large-v3-turbo",
        });
        if (insErr) return new Response(insErr.message, { status: 500 });

        const duration =
          parsed.duration && Number.isFinite(parsed.duration) ? Math.round(parsed.duration) : null;
        await supabaseAdmin
          .from("projects")
          .update(
            duration !== null
              ? { status: "analyzing", duration_seconds: duration }
              : { status: "analyzing" },
          )
          .eq("id", project.id);

        const { generateAndSaveClipSuggestions } = await import("@/lib/clip-suggest.server");
        const flatSegs = segments.map((s) => ({ text: s.text, start: s.start, end: s.end }));
        const callbackOrigin = new URL(request.url).origin;
        try {
          await generateAndSaveClipSuggestions({
            supabase: supabaseAdmin,
            userId: project.user_id,
            projectId: project.id,
            fullText,
            segments: flatSegs,
            brief: project.description,
            targetCount: project.target_clip_count,
            apiKey: key,
            origin: callbackOrigin,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Falha ao gerar cortes";
          await supabaseAdmin
            .from("projects")
            .update({ status: "failed", error_message: message.slice(0, 500) })
            .eq("id", project.id);
          return new Response(message, { status: 500 });
        }

        await supabaseAdmin
          .from("projects")
          .update(
            duration !== null
              ? { status: "ready", duration_seconds: duration, error_message: null }
              : { status: "ready", error_message: null },
          )
          .eq("id", project.id);

        return Response.json({ ok: true });
      },
    },
  },
});
