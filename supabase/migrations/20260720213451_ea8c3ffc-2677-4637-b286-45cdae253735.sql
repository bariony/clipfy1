UPDATE public.render_jobs
SET
  status = 'failed',
  error_message = 'Job criado sem URL de upload — exporte novamente após a correção.',
  completed_at = now(),
  updated_at = now()
WHERE status IN ('queued', 'processing')
  AND NOT jsonb_path_exists(edl, '$.output.upload_url');