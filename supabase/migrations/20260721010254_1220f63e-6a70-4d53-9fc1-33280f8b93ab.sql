DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'render_jobs_active_requires_upload_url'
      AND conrelid = 'public.render_jobs'::regclass
  ) THEN
    ALTER TABLE public.render_jobs
      ADD CONSTRAINT render_jobs_active_requires_upload_url
      CHECK (
        status NOT IN ('queued', 'processing')
        OR COALESCE(length(edl #>> '{output,upload_url}'), 0) > 0
      );
  END IF;
END $$;