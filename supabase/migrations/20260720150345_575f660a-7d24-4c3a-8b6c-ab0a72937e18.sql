
-- ENUMS
DO $$ BEGIN CREATE TYPE public.app_role AS ENUM ('admin','moderator','user'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.project_status AS ENUM ('draft','uploading','transcribing','analyzing','ready','failed','archived'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.project_source AS ENUM ('upload','youtube','url'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.clip_status AS ENUM ('suggested','rendering','ready','failed','discarded'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.credit_kind AS ENUM ('bonus','purchase','consumption','refund','adjustment'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- updated_at helper
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

-- PROFILES
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  avatar_url TEXT,
  credits INTEGER NOT NULL DEFAULT 60,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile read" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- USER ROLES
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own roles read" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- PROJECTS
CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  source project_source NOT NULL DEFAULT 'upload',
  source_url TEXT,
  storage_path TEXT,
  language TEXT DEFAULT 'pt',
  duration_seconds INTEGER,
  status project_status NOT NULL DEFAULT 'draft',
  target_clip_count INTEGER DEFAULT 8,
  min_clip_seconds INTEGER DEFAULT 20,
  max_clip_seconds INTEGER DEFAULT 60,
  virality_bias INTEGER DEFAULT 70,
  thumbnail_url TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own projects" ON public.projects FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX projects_user_idx ON public.projects(user_id, created_at DESC);
CREATE TRIGGER trg_projects_updated BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- TRANSCRIPTS
CREATE TABLE public.transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  language TEXT,
  full_text TEXT,
  segments JSONB,
  provider TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transcripts TO authenticated;
GRANT ALL ON public.transcripts TO service_role;
ALTER TABLE public.transcripts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own transcripts" ON public.transcripts FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX transcripts_project_idx ON public.transcripts(project_id);
CREATE TRIGGER trg_transcripts_updated BEFORE UPDATE ON public.transcripts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- CLIP CATEGORIES (public catalog)
CREATE TABLE public.clip_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.clip_categories TO authenticated;
GRANT ALL ON public.clip_categories TO service_role;
ALTER TABLE public.clip_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "catalog read" ON public.clip_categories FOR SELECT TO authenticated USING (true);

-- CAPTION TEMPLATES (public catalog)
CREATE TABLE public.caption_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  preview_url TEXT,
  style JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.caption_templates TO authenticated;
GRANT ALL ON public.caption_templates TO service_role;
ALTER TABLE public.caption_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "templates read" ON public.caption_templates FOR SELECT TO authenticated USING (true);

-- CLIPS
CREATE TABLE public.clips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category_id UUID REFERENCES public.clip_categories(id) ON DELETE SET NULL,
  template_id UUID REFERENCES public.caption_templates(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  hook TEXT,
  transcript_excerpt TEXT,
  start_seconds NUMERIC NOT NULL,
  end_seconds NUMERIC NOT NULL,
  virality_score INTEGER,
  status clip_status NOT NULL DEFAULT 'suggested',
  render_url TEXT,
  thumbnail_url TEXT,
  aspect_ratio TEXT DEFAULT '9:16',
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clips TO authenticated;
GRANT ALL ON public.clips TO service_role;
ALTER TABLE public.clips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own clips" ON public.clips FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX clips_project_idx ON public.clips(project_id, virality_score DESC);
CREATE TRIGGER trg_clips_updated BEFORE UPDATE ON public.clips FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- CREDIT TRANSACTIONS
CREATE TABLE public.credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  kind credit_kind NOT NULL,
  amount INTEGER NOT NULL,
  balance_after INTEGER,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.credit_transactions TO authenticated;
GRANT ALL ON public.credit_transactions TO service_role;
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own credits read" ON public.credit_transactions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own credits insert" ON public.credit_transactions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE INDEX credit_tx_user_idx ON public.credit_transactions(user_id, created_at DESC);

-- HANDLE NEW USER
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url, credits)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'avatar_url', 60)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user') ON CONFLICT DO NOTHING;
  INSERT INTO public.credit_transactions (user_id, kind, amount, balance_after, description)
  VALUES (NEW.id, 'bonus', 60, 60, 'Signup bonus');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- SEEDS: clip categories
INSERT INTO public.clip_categories (slug, name, description, icon, sort_order) VALUES
  ('hook','Hook','Ganchos irresistíveis de abertura','zap',1),
  ('story','Story','Momentos narrativos completos','book-open',2),
  ('insight','Insight','Ideias e sacadas de alto valor','lightbulb',3),
  ('quote','Quote','Frases memoráveis e citáveis','quote',4),
  ('howto','How-to','Passo a passo prático','list-checks',5),
  ('debate','Debate','Discussões e confrontos','swords',6),
  ('emotion','Emotion','Picos emocionais','heart',7),
  ('data','Data','Números e estatísticas','bar-chart-3',8),
  ('humor','Humor','Momentos engraçados','smile',9),
  ('cta','CTA','Chamadas para ação','megaphone',10)
ON CONFLICT (slug) DO NOTHING;

-- SEEDS: caption templates
INSERT INTO public.caption_templates (slug, name, description, style, sort_order) VALUES
  ('bold-yellow','Bold Yellow','Amarelo fluor com contorno preto','{"font":"Inter","weight":900,"fill":"#FDE047","stroke":"#000"}',1),
  ('karaoke-lime','Karaoke Lime','Realce palavra a palavra em lima','{"font":"Inter","weight":800,"highlight":"#D9F26D"}',2),
  ('minimal-white','Minimal White','Branco limpo com sombra sutil','{"font":"Inter","weight":700,"fill":"#FFF","shadow":"0 2px 6px rgba(0,0,0,.4)"}',3),
  ('mono-tech','Mono Tech','Monoespaçada estilo terminal','{"font":"JetBrains Mono","weight":600,"fill":"#D9F26D"}',4),
  ('news-ticker','News Ticker','Barra inferior estilo notícia','{"font":"Inter","weight":800,"bg":"#000","fill":"#FFF"}',5),
  ('pop-purple','Pop Purple','Roxo vibrante com pop','{"font":"Inter","weight":900,"fill":"#C4B5FD","stroke":"#1E1B4B"}',6),
  ('cinema-serif','Cinema Serif','Serifada estilo cinema','{"font":"Playfair Display","weight":700,"fill":"#FFF"}',7),
  ('meme-impact','Meme Impact','Estilo meme clássico','{"font":"Impact","weight":900,"fill":"#FFF","stroke":"#000"}',8)
ON CONFLICT (slug) DO NOTHING;
