
CREATE TYPE public.render_job_status AS ENUM ('queued','processing','completed','failed','cancelled');

CREATE TABLE public.render_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  clip_id UUID NOT NULL REFERENCES public.clips(id) ON DELETE CASCADE,
  status public.render_job_status NOT NULL DEFAULT 'queued',
  progress INT NOT NULL DEFAULT 0,
  edl JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_url TEXT,
  thumbnail_url TEXT,
  worker_id TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX render_jobs_clip_idx ON public.render_jobs (clip_id, created_at DESC);
CREATE INDEX render_jobs_user_idx ON public.render_jobs (user_id, created_at DESC);
CREATE INDEX render_jobs_status_idx ON public.render_jobs (status) WHERE status IN ('queued','processing');

GRANT SELECT, INSERT ON public.render_jobs TO authenticated;
GRANT ALL ON public.render_jobs TO service_role;

ALTER TABLE public.render_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own render jobs" ON public.render_jobs
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users insert own render jobs" ON public.render_jobs
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER set_render_jobs_updated_at
  BEFORE UPDATE ON public.render_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
