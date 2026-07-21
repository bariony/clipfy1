import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

function safeEqualHex(a: string, b: string) {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length || ab.length === 0) return false;
  return timingSafeEqual(ab, bb);
}

// Allow-list for debug artifact filenames.
const ALLOWED = new Set([
  "tracks_report.json",
  "decisions.jsonl",
  "switches.json",
  "links_report.json",
  "camera_trace.jsonl",
  "lip_activity.json",
  "diagnosis.json",
  "manifest.json",
  "inspection.mp4",
]);

export const Route = createFileRoute("/api/public/render-debug-upload")({
  server: {
    handlers: {
      PUT: async ({ request }) => {
        const secret = process.env.RENDER_WORKER_SECRET;
        if (!secret) return new Response("Server misconfigured", { status: 500 });

        const url = new URL(request.url);
        const jobId = url.searchParams.get("job_id") ?? "";
        const filename = url.searchParams.get("filename") ?? "";
        const expires = Number(url.searchParams.get("expires") ?? "0");
        const signature = url.searchParams.get("sig") ?? "";

        if (!jobId || !filename || !expires || !signature) {
          return new Response("Missing upload token", { status: 400 });
        }
        if (!ALLOWED.has(filename)) {
          return new Response("Filename not allowed", { status: 400 });
        }
        if (Date.now() / 1000 > expires) {
          return new Response("Upload token expired", { status: 401 });
        }
        const expected = createHmac("sha256", secret)
          .update(`debug:${jobId}:${expires}`)
          .digest("hex");
        if (!safeEqualHex(signature, expected)) {
          return new Response("Invalid upload token", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: job } = await supabaseAdmin
          .from("render_jobs")
          .select("id, status")
          .eq("id", jobId)
          .maybeSingle();
        if (!job) return new Response("Job not found", { status: 404 });
        if (job.status === "cancelled") {
          return Response.json({ ok: true, stale: true });
        }

        const body = await request.arrayBuffer();
        if (body.byteLength === 0) return new Response("Empty file", { status: 400 });

        const objectPath = `${jobId}/debug/${filename}`;
        const contentType = filename.endsWith(".mp4")
          ? "video/mp4"
          : filename.endsWith(".jsonl")
            ? "application/x-ndjson"
            : "application/json";

        const { error: upErr } = await supabaseAdmin.storage
          .from("renders")
          .upload(objectPath, body, { contentType, upsert: true });
        if (upErr) return new Response(upErr.message, { status: 500 });

        return Response.json({ ok: true, path: objectPath });
      },
    },
  },
});
