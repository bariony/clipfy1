import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Input = z.object({ clipId: z.string().uuid() });

export const enqueueClipRender = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { getRequestUrl } = await import("@tanstack/react-start/server");
    const { enqueueRenderForClip } = await import("./render.server");
    const origin = getRequestUrl().origin;
    const res = await enqueueRenderForClip({ supabase, clipId: data.clipId, origin });
    if ("skipped" in res) throw new Error(res.reason);
    return { jobId: res.jobId };
  });
