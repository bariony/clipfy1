
CREATE OR REPLACE FUNCTION public.create_project_with_credits(
  _title text,
  _description text,
  _source project_source,
  _source_url text,
  _storage_path text,
  _language text,
  _target_clip_count integer,
  _min_clip_seconds integer,
  _max_clip_seconds integer,
  _estimated_cost integer
)
RETURNS public.projects
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _balance integer;
  _project public.projects;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;
  IF _estimated_cost IS NULL OR _estimated_cost < 0 THEN
    _estimated_cost := 0;
  END IF;

  SELECT credits INTO _balance FROM public.profiles WHERE id = _uid FOR UPDATE;
  IF _balance IS NULL THEN
    RAISE EXCEPTION 'profile missing' USING ERRCODE = 'P0002';
  END IF;
  IF _balance < _estimated_cost THEN
    RAISE EXCEPTION 'insufficient_credits' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.projects (
    user_id, title, description, source, source_url, storage_path,
    language, target_clip_count, min_clip_seconds, max_clip_seconds, status
  ) VALUES (
    _uid, _title, NULLIF(_description, ''), _source, NULLIF(_source_url, ''), NULLIF(_storage_path, ''),
    COALESCE(_language, 'auto'), _target_clip_count, _min_clip_seconds, _max_clip_seconds,
    CASE WHEN _source = 'upload' AND _storage_path IS NULL THEN 'draft'::project_status ELSE 'queued'::project_status END
  )
  RETURNING * INTO _project;

  IF _estimated_cost > 0 THEN
    UPDATE public.profiles SET credits = credits - _estimated_cost WHERE id = _uid RETURNING credits INTO _balance;
    INSERT INTO public.credit_transactions (user_id, project_id, kind, amount, balance_after, description)
    VALUES (_uid, _project.id, 'debit', -_estimated_cost, _balance, 'Project created: ' || _project.title);
  END IF;

  RETURN _project;
END;
$$;

REVOKE ALL ON FUNCTION public.create_project_with_credits(text,text,project_source,text,text,text,integer,integer,integer,integer) FROM public;
GRANT EXECUTE ON FUNCTION public.create_project_with_credits(text,text,project_source,text,text,text,integer,integer,integer,integer) TO authenticated;
