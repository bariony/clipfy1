-- Marca render_jobs anteriores do clip caso-0 como substituídos,
-- para que o autoRender do ClipCard dispare um novo job com debug_reframe=true
UPDATE public.render_jobs
SET status = 'cancelled',
    error_message = 'substituído por novo render (debug caso-0)',
    updated_at = now()
WHERE clip_id = 'f46e7ac0-a525-46b4-a85b-04bf86b98705'
  AND status IN ('completed', 'failed', 'queued', 'processing');