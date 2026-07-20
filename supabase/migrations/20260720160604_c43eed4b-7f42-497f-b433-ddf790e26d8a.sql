REVOKE EXECUTE ON FUNCTION public.create_project_with_credits(text, text, project_source, text, text, text, integer, integer, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_project_with_credits(text, text, project_source, text, text, text, integer, integer, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_project_with_credits(text, text, project_source, text, text, text, integer, integer, integer, integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM authenticated;