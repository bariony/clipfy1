ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS active_transcribe_job_id uuid,
  ADD COLUMN IF NOT EXISTS transcribe_progress integer NOT NULL DEFAULT 0;

ALTER TABLE public.projects
  ADD CONSTRAINT projects_transcribe_progress_range
  CHECK (transcribe_progress >= 0 AND transcribe_progress <= 100) NOT VALID;

ALTER TABLE public.projects
  VALIDATE CONSTRAINT projects_transcribe_progress_range;

UPDATE public.projects
SET transcribe_progress = CASE
  WHEN status = 'ready' THEN 100
  WHEN status IN ('transcribing', 'analyzing') THEN GREATEST(transcribe_progress, 10)
  ELSE 0
END
WHERE transcribe_progress IS NULL OR transcribe_progress < 0 OR transcribe_progress > 100;