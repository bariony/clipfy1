import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

function safeEqualHex(a: string, b: string) {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length || ab.length === 0) return false;
  return timingSafeEqual(ab, bb);
}

export const Route = createFileRoute("/api/public/render-upload")({
  server: {
    handlers: {
      PUT: async ({ request }) => {
        const secret = process.env.RENDER_WORKER_SECRET;
        if (!secret) return new Response("Server misconfigured", { status: 500 });

        const url = new URL(request.url);
        const jobId = url.searchParams.get("job_id") ?? "";
        const outputPath = url.searchParams.get("path") ?? "";
        const expires = Number(url.searchParams.get("expires") ?? "0");
        const signature = url.searchParams.get("sig") ?? "";

        if (!jobId || !outputPath || !expires || !signature) {
          return new Response("Missing upload token", { status: 400 });
        }
        if (Date.now() / 1000 > expires) {
          return new Response("Upload token expired", { status: 401 });
        }
        const expected = createHmac("sha256", secret)
          .update(`${jobId}:${outputPath}:${expires}`)
          .digest("hex");
        if (!safeEqualHex(signature, expected)) {
          return new Response("Invalid upload token", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: job, error: jobError } = await supabaseAdmin
          .from("render_jobs")
          .select("id, clip_id, edl, status")
          .eq("id", jobId)
          .maybeSingle();
        if (jobError) return new Response(jobError.message, { status: 500 });
        if (!job) return new Response("Job not found", { status: 404 });
        if (job.status === "cancelled") {
          return Response.json({ ok: true, stale: true });
        }

        const edlOutput = (job.edl as { output?: { path?: string } } | null)?.output;
        if (edlOutput?.path !== outputPath) {
          return new Response("Upload path mismatch", { status: 403 });
        }

        const file = await request.arrayBuffer();
        if (file.byteLength === 0) return new Response("Empty file", { status: 400 });

        const { error: uploadError } = await supabaseAdmin.storage
          .from("renders")
          .upload(outputPath, file, {
            contentType: request.headers.get("content-type") ?? "video/mp4",
            upsert: true,
          });
        if (uploadError) return new Response(uploadError.message, { status: 500 });

        const { data: signed } = await supabaseAdmin.storage
          .from("renders")
          .createSignedUrl(outputPath, 60 * 60 * 24 * 7);
        const renderUrl = signed?.signedUrl ?? null;

        await supabaseAdmin
          .from("render_jobs")
          .update({
            status: "completed",
            progress: 100,
            output_url: renderUrl,
            error_message: null,
            completed_at: new Date().toISOString(),
          })
          .eq("id", jobId);

        await supabaseAdmin
          .from("clips")
          .update({ status: "ready", render_url: renderUrl })
          .eq("id", job.clip_id);

        return Response.json({ ok: true });
      },
    },
  },
});