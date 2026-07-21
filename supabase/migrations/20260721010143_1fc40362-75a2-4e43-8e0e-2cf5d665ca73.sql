UPDATE public.render_jobs
SET status = 'failed',
    error_message = 'Exportação travada limpa automaticamente — exporte novamente.',
    completed_at = now(),
    updated_at = now()
WHERE status IN ('queued', 'processing')
  AND progress = 0
  AND created_at < now() - interval '90 seconds';