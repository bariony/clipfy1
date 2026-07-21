
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS slug text;
CREATE UNIQUE INDEX IF NOT EXISTS projects_slug_key ON public.projects (slug);

CREATE OR REPLACE FUNCTION public.generate_project_slug(_title text)
RETURNS text
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
  base text;
  suffix text;
  candidate text;
  attempts int := 0;
BEGIN
  base := lower(coalesce(_title, ''));
  base := translate(base,
    'áàâãäåéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
    'aaaaaaeeeeiiiiooooouuuucnaaaaaaeeeeiiiiooooouuuucn');
  base := regexp_replace(base, '[^a-z0-9]+', '-', 'g');
  base := trim(both '-' from base);
  base := substring(base from 1 for 32);
  IF base IS NULL OR base = '' THEN base := 'projeto'; END IF;

  LOOP
    suffix := lower(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 6));
    candidate := base || '-' || suffix;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.projects WHERE slug = candidate);
    attempts := attempts + 1;
    IF attempts > 5 THEN
      candidate := base || '-' || lower(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 10));
      EXIT;
    END IF;
  END LOOP;

  RETURN candidate;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_project_slug()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    NEW.slug := public.generate_project_slug(NEW.title);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS projects_set_slug ON public.projects;
CREATE TRIGGER projects_set_slug
  BEFORE INSERT ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.set_project_slug();

UPDATE public.projects
SET slug = public.generate_project_slug(title)
WHERE slug IS NULL;

ALTER TABLE public.projects ALTER COLUMN slug SET NOT NULL;
