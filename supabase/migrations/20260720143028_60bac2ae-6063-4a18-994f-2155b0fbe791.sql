
-- =========================================================
-- ENUMS
-- =========================================================
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');

CREATE TYPE public.project_status AS ENUM (
  'draft','uploading','uploaded','transcribing','analyzing',
  'generating_clips','ready','rendering','completed','failed','canceled'
);

CREATE TYPE public.project_source AS ENUM ('upload','youtube');

CREATE TYPE public.clip_status AS ENUM ('suggested','approved','rejected','rendering','rendered','failed');

CREATE TYPE public.credit_kind AS ENUM ('grant','consume','refund','purchase','adjustment');

-- =========================================================
-- SHARED FUNCTIONS
-- =========================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- =========================================================
-- PROFILES
-- =========================================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  avatar_url TEXT,
  credits INTEGER NOT NULL DEFAULT 60,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own profile" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "Users insert own profile" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- USER ROLES
-- =========================================================
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  );
$$;

-- =========================================================
-- NEW USER HANDLER (profile + default role)
-- =========================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.credit_transactions (user_id, delta, balance_after, kind, description)
  VALUES (NEW.id, 60, 60, 'grant', 'Welcome bonus');

  RETURN NEW;
END;
$$;

-- =========================================================
-- CLIP CATEGORIES (seed / public read)
-- =========================================================
CREATE TABLE public.clip_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  emoji TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.clip_categories TO authenticated;
GRANT ALL ON public.clip_categories TO service_role;
ALTER TABLE public.clip_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Categories readable by authenticated" ON public.clip_categories
  FOR SELECT TO authenticated USING (is_active = true);
CREATE POLICY "Admins manage categories" ON public.clip_categories
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- =========================================================
-- CAPTION TEMPLATES (seed / public read)
-- =========================================================
CREATE TABLE public.caption_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  preview_url TEXT,
  style JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_premium BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.caption_templates TO authenticated;
GRANT ALL ON public.caption_templates TO service_role;
ALTER TABLE public.caption_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Templates readable by authenticated" ON public.caption_templates
  FOR SELECT TO authenticated USING (is_active = true);
CREATE POLICY "Admins manage templates" ON public.caption_templates
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- =========================================================
-- PROJECTS
-- =========================================================
CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  source_type public.project_source NOT NULL DEFAULT 'upload',
  source_url TEXT,
  storage_path TEXT,
  thumbnail_url TEXT,
  duration_sec INTEGER,
  language TEXT NOT NULL DEFAULT 'auto',
  category TEXT,
  target_clip_count INTEGER NOT NULL DEFAULT 10,
  min_clip_sec INTEGER NOT NULL DEFAULT 20,
  max_clip_sec INTEGER NOT NULL DEFAULT 60,
  status public.project_status NOT NULL DEFAULT 'draft',
  progress INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX projects_user_id_idx ON public.projects(user_id);
CREATE INDEX projects_status_idx ON public.projects(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own projects" ON public.projects
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own projects" ON public.projects
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own projects" ON public.projects
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own projects" ON public.projects
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER projects_set_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- TRANSCRIPTS
-- =========================================================
CREATE TABLE public.transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  language TEXT,
  raw_text TEXT,
  segments JSONB NOT NULL DEFAULT '[]'::jsonb,
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX transcripts_project_id_idx ON public.transcripts(project_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.transcripts TO authenticated;
GRANT ALL ON public.transcripts TO service_role;
ALTER TABLE public.transcripts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own transcripts" ON public.transcripts
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- =========================================================
-- CLIPS
-- =========================================================
CREATE TABLE public.clips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category_id UUID REFERENCES public.clip_categories(id) ON DELETE SET NULL,
  template_id UUID REFERENCES public.caption_templates(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  hook_text TEXT,
  transcript_excerpt TEXT,
  start_sec NUMERIC(10,3) NOT NULL,
  end_sec NUMERIC(10,3) NOT NULL,
  score NUMERIC(5,2),
  aspect_ratio TEXT NOT NULL DEFAULT '9:16',
  caption_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  status public.clip_status NOT NULL DEFAULT 'suggested',
  render_url TEXT,
  thumbnail_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX clips_project_id_idx ON public.clips(project_id);
CREATE INDEX clips_user_id_idx ON public.clips(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.clips TO authenticated;
GRANT ALL ON public.clips TO service_role;
ALTER TABLE public.clips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own clips" ON public.clips
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER clips_set_updated_at
  BEFORE UPDATE ON public.clips
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- CREDIT TRANSACTIONS
-- =========================================================
CREATE TABLE public.credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  delta INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  kind public.credit_kind NOT NULL,
  description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX credit_transactions_user_id_idx ON public.credit_transactions(user_id, created_at DESC);

GRANT SELECT ON public.credit_transactions TO authenticated;
GRANT ALL ON public.credit_transactions TO service_role;
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own transactions" ON public.credit_transactions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- =========================================================
-- AUTH TRIGGER
-- =========================================================
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================================================
-- SEED: clip categories
-- =========================================================
INSERT INTO public.clip_categories (slug, name, description, emoji, sort_order) VALUES
  ('hook',       'Hook',        'Attention-grabbing openers that stop the scroll.',        '🎯', 1),
  ('story',      'Story',       'Narrative-driven moments with a clear arc.',              '📖', 2),
  ('insight',    'Insight',     'Sharp takeaways and mental models.',                      '💡', 3),
  ('quote',      'Quote',       'Memorable one-liners worth sharing.',                     '💬', 4),
  ('reaction',   'Reaction',    'Emotional peaks: laughter, shock, awe.',                  '😲', 5),
  ('question',   'Question',    'Provocative questions that spark comments.',              '❓', 6),
  ('howto',      'How-to',      'Step-by-step tactical advice.',                           '🛠️', 7),
  ('debate',     'Debate',      'Contrarian takes and hot opinions.',                      '🔥', 8),
  ('data',       'Data drop',   'Numbers, stats, and receipts.',                           '📊', 9),
  ('meme',       'Meme moment', 'Highly remixable, culture-ready beats.',                  '🍿', 10);

-- =========================================================
-- SEED: caption templates
-- =========================================================
INSERT INTO public.caption_templates (slug, name, description, style, is_premium, sort_order) VALUES
  ('bold-yellow', 'Bold Yellow',
    'High-contrast bold captions with yellow highlight on keywords.',
    '{"font":"Inter","weight":900,"size":72,"case":"upper","color":"#FFFFFF","highlight":"#D6FF3D","stroke":"#000000","strokeWidth":6,"position":"center"}',
    false, 1),
  ('karaoke-lime', 'Karaoke Lime',
    'Word-by-word karaoke animation in signature lime.',
    '{"font":"Inter","weight":800,"size":64,"case":"upper","color":"#FFFFFF","highlight":"#B3FF00","animation":"karaoke","stroke":"#0A0A0A","strokeWidth":5,"position":"center"}',
    false, 2),
  ('minimal-white', 'Minimal White',
    'Clean, editorial white captions with subtle shadow.',
    '{"font":"Inter","weight":600,"size":54,"case":"sentence","color":"#FFFFFF","shadow":"0 2px 12px rgba(0,0,0,0.6)","position":"bottom"}',
    false, 3),
  ('mono-terminal', 'Mono Terminal',
    'Monospaced terminal-style captions for tech content.',
    '{"font":"JetBrains Mono","weight":700,"size":48,"case":"as-is","color":"#B3FF00","bg":"rgba(10,10,10,0.85)","position":"bottom"}',
    false, 4),
  ('neon-pop', 'Neon Pop',
    'Neon-glow captions with saturated pink accent.',
    '{"font":"Inter","weight":900,"size":68,"case":"upper","color":"#FFFFFF","highlight":"#FF3DCB","glow":true,"stroke":"#1A0033","strokeWidth":6,"position":"center"}',
    true, 5),
  ('cinema-serif', 'Cinema Serif',
    'Cinematic serif subtitles with letterbox framing.',
    '{"font":"Instrument Serif","weight":500,"size":46,"case":"sentence","color":"#F5F5F5","letterbox":true,"position":"bottom"}',
    true, 6),
  ('gradient-hype', 'Gradient Hype',
    'Animated gradient fill for high-energy edits.',
    '{"font":"Inter","weight":900,"size":76,"case":"upper","gradient":["#B3FF00","#3DFFF0","#FF3DCB"],"animation":"shine","stroke":"#000000","strokeWidth":6,"position":"center"}',
    true, 7),
  ('sticker-pop', 'Sticker Pop',
    'Bubble-sticker captions with playful bounce.',
    '{"font":"Inter","weight":900,"size":60,"case":"upper","color":"#0A0A0A","bg":"#FFFFFF","radius":24,"padding":18,"animation":"bounce","position":"center"}',
    false, 8);
