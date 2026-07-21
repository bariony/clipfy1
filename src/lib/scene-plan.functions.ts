import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Input = z.object({ clipId: z.string().uuid() });

/** Regera o plano de cenas dinâmicas de um corte (edição ponta-a-ponta). */
export const regenerateScenePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    // Confirma dono (RLS já faria, mas explicitamos)
    const { data: clip, error } = await supabase
      .from("clips")
      .select("id, user_id")
      .eq("id", data.clipId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!clip) throw new Error("Clip not found");
    if (clip.user_id !== userId) throw new Error("Forbidden");

    const { regenerateScenePlanForClip } = await import("./scene-plan.server");
    const plan = await regenerateScenePlanForClip({ supabase, clipId: data.clipId, apiKey: key });
    return { ok: true as const, scenes: plan.scenes.length, speakers: plan.speakers.length };
  });
