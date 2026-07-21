import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Input = z.object({
  projectId: z.string().uuid(),
  enabled: z.boolean(),
});

export const setProjectDebugReframe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("projects")
      .update({ debug_reframe: data.enabled })
      .eq("id", data.projectId);
    if (error) throw new Error(error.message);
    return { ok: true, enabled: data.enabled };
  });
