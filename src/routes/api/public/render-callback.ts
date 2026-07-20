import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";

const Payload = z.object({
  job_id: z.string().uuid(),
  status: z.enum(["processing", "completed", "failed", "cancelled"]),
  progress: z.number().int().min(0).max(100).optional(),
  output_url: z.string().url().optional(),
  output_path: z.string().optional(), // path inside `renders` bucket
  thumbnail_url: z.string().url().optional(),
  worker_id: z.string().optional(),
  error_message: z.string().optional(),
});

function safeEqualHex(a: string, b: string) {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length || ab.length === 0) return false;
  return timingSafeEqual(ab, bb);
}

export const Route = createFileRoute("/api/public/render-callback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.RENDER_WORKER_SECRET;
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

        const update: {
          status: typeof parsed.status;
          worker_id?: string;
          error_message?: string | null;
          progress?: number;
          started_at?: string;
          completed_at?: string;
          output_url?: string;
          thumbnail_url?: string;
        } = {
          status: parsed.status,
          error_message: parsed.error_message ?? null,
        };
        if (parsed.worker_id) update.worker_id = parsed.worker_id;
        if (parsed.progress != null) update.progress = parsed.progress;
        if (parsed.status === "processing") update.started_at = new Date().toISOString();
        if (parsed.status !== "processing") update.completed_at = new Date().toISOString();
        if (parsed.output_url) update.output_url = parsed.output_url;
        if (parsed.thumbnail_url) update.thumbnail_url = parsed.thumbnail_url;

        const { data: job, error } = await supabaseAdmin
          .from("render_jobs")
          .update(update)
          .eq("id", parsed.job_id)
          .select("*")
          .maybeSingle();
        if (error) return new Response(error.message, { status: 500 });
        if (!job) return new Response("Job not found", { status: 404 });

        if (parsed.status === "completed") {
          // Build signed URL from storage path if provided
          let renderUrl = parsed.output_url ?? null;
          if (!renderUrl && parsed.output_path) {
            const { data: signed } = await supabaseAdmin.storage
              .from("renders")
              .createSignedUrl(parsed.output_path, 60 * 60 * 24 * 7);
            renderUrl = signed?.signedUrl ?? null;
          }
          await supabaseAdmin
            .from("clips")
            .update({
              status: "ready",
              render_url: renderUrl,
              thumbnail_url: parsed.thumbnail_url ?? undefined,
            })
            .eq("id", job.clip_id);
        } else if (parsed.status === "failed") {
          await supabaseAdmin
            .from("clips")
            .update({ status: "failed" })
            .eq("id", job.clip_id);
        } else if (parsed.status === "processing") {
          await supabaseAdmin
            .from("clips")
            .update({ status: "rendering" })
            .eq("id", job.clip_id);
        }

        return Response.json({ ok: true });
      },
    },
  },
});
