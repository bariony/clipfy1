ALTER TABLE public.clips ADD COLUMN IF NOT EXISTS scene_plan jsonb;
ALTER TABLE public.transcripts ADD COLUMN IF NOT EXISTS speakers jsonb;