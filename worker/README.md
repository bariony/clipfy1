# Clipfy Render Worker (reference)

Serviço externo (GPU) que consome jobs de `render_jobs`, renderiza o clip
com FFmpeg + legendas animadas (Remotion recomendado) e faz callback
assinado para o app.

## Contrato

### 1. Receber job

Duas opções:

**Push (recomendado)** — o app faz `POST {RENDER_WORKER_URL}/jobs` com
`Authorization: Bearer $RENDER_WORKER_SECRET` e body `{ "job_id": "<uuid>" }`.
O worker então busca o job via Supabase (service role) usando o job_id.

**Poll (fallback)** — o worker consulta Supabase a cada N segundos:

```sql
select * from render_jobs where status = 'queued' order by created_at limit 1;
```

### 2. Processar

O campo `edl` (JSON) contém tudo:

```json
{
  "version": 1,
  "source": { "kind": "upload|youtube|url", "url": "https://..." },
  "output": { "bucket": "renders", "path": "<user>/<project>/<clip>-<ts>.mp4", "aspect_ratio": "9:16" },
  "clip": { "id": "...", "title": "...", "start": 12.4, "end": 42.1 },
  "captions": { "template": "hormozi-slam", "language": "pt", "segments": [...] },
  "layout": "auto|full|split-h|split-v|grid-3|pip",
  "caption_position": "top|middle|bottom"
}
```

Pipeline sugerido:

1. `yt-dlp` ou `curl` para baixar o `source.url`
2. `ffmpeg` para cortar `[start, end]` e reescalar para `aspect_ratio`
3. Se `layout=auto`, detectar rostos (mediapipe/insightface) e compor
   full/split/grid
4. Renderizar legendas por palavra via Remotion aplicando o `template`
5. Encodar `libx264 crf 20`, `-movflags +faststart`
6. Upload no bucket `renders` (service role):
   `PUT storage/v1/object/renders/<output.path>`

### 3. Callback assinado

`POST https://clipfy1.lovable.app/api/public/render-callback`

Headers:
- `content-type: application/json`
- `x-render-signature: <hex(hmac_sha256(RENDER_WORKER_SECRET, body))>`

Body:
```json
{
  "job_id": "<uuid>",
  "status": "processing|completed|failed",
  "progress": 42,
  "output_path": "<user>/<project>/<clip>-<ts>.mp4",
  "thumbnail_url": "https://...",
  "worker_id": "gpu-01",
  "error_message": null
}
```

Ao receber `completed`, o app gera uma URL assinada de 7 dias para o
arquivo em `renders/<output_path>` e marca o clip como `ready`.

## Variáveis

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RENDER_WORKER_SECRET` (mesmo valor que está no app)
- `APP_URL` (ex.: `https://clipfy1.lovable.app`)

## Deploy sugerido

- Runpod / Modal / Fly.io GPU
- Container Docker com `ffmpeg`, `node 20`, `yt-dlp`, Remotion CLI
- Concorrência: 1 job por GPU

## HMAC helper (Node)

```ts
import { createHmac } from "crypto";
const sig = createHmac("sha256", process.env.RENDER_WORKER_SECRET!)
  .update(body)
  .digest("hex");
```
