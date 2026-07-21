UPDATE public.projects
SET
  status = 'draft',
  error_message = NULL,
  updated_at = now()
WHERE source = 'youtube'
  AND status = 'failed'
  AND error_message IS NOT NULL
  AND (
    error_message ILIKE '%Sign in to confirm%not a bot%'
    OR error_message ILIKE '%Use --cookies-from-browser%'
    OR error_message ILIKE '%Use --cookies for the authentication%'
    OR error_message ILIKE '%yt-dlp exit 1:%[youtube]%not a bot%'
  );