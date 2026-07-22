import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/public/debug-read')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const secret = url.searchParams.get('s');
        if (secret !== process.env.RENDER_WORKER_SECRET) {
          return new Response('nope', { status: 401 });
        }
        const path = url.searchParams.get('path')!;
        const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
        const { data, error } = await supabaseAdmin.storage.from('renders').download(path);
        if (error || !data) return new Response(JSON.stringify({ error: error?.message }), { status: 500 });
        const text = await data.text();
        return new Response(text, { headers: { 'content-type': 'application/json' } });
      },
    },
  },
});
