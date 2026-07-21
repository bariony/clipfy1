# Clipfy Render Worker — Deploy no EasyPanel (Hostinger VPS)

Worker Node.js que consome jobs de `render_jobs`, transcreve com Groq
Whisper (se necessário), corta com FFmpeg, queima legendas animadas
palavra-a-palavra (.ass) e faz upload via URL assinada — **não precisa de
Service Role Key**.

## Arquitetura

```
App (Lovable)  ──POST /jobs (Bearer)──▶  Worker (EasyPanel)
     ▲                                        │
     │                                        ├─ yt-dlp / curl (download)
     │                                        ├─ Groq Whisper (transcrição)
     │                                        ├─ FFmpeg (cut + crop + burn subs)
     │                                        └─ PUT signed URL → bucket "renders"
     │                                        │
     └──POST /api/public/render-callback ◀────┘   (HMAC-SHA256)
```

## Deploy no EasyPanel

### 1. Criar App
No painel EasyPanel:
1. Abre o **Project** `clipfy` → **+ Service** → **App**
2. Nome: `render-worker`
3. **Source** → **Git** (crie um repo com esse folder `worker/`) ou **Dockerfile**
   inline colando este Dockerfile

### 2. Build
- **Build Path**: `/` (raiz do repo/pasta com Dockerfile)
- EasyPanel detecta o Dockerfile automaticamente

### 3. Environment Variables
Aba **Environment**:
```
RENDER_WORKER_SECRET=<mesmo valor que está no app Lovable>
GROQ_API_KEY=<sua chave gsk_...>
APP_URL=https://clipfy1.lovable.app
WORKER_ID=vps-hostinger-01
CONCURRENCY=1
PORT=3000
# Necessário se o IP da VPS for bloqueado pelo YouTube:
# YTDLP_PROXY=http://usuario:senha@host:porta
# ou vários, um por linha ou separados por vírgula:
# YTDLP_PROXIES=http://user:pass@proxy1:porta,http://user:pass@proxy2:porta
# YTDLP_COOKIES_B64=<cookies.txt em base64 da conta operacional do Clipfy>
# Diarização (pyannote CPU) — amarra fala↔rosto e resolve foco errado da câmera:
# HF_TOKEN=hf_xxx  (crie em https://huggingface.co/settings/tokens
#                   e aceite os termos em https://huggingface.co/pyannote/speaker-diarization-3.1
#                   E em https://huggingface.co/pyannote/segmentation-3.0)
```

> ⚠️ **RENDER_WORKER_SECRET** precisa ser IDÊNTICO ao do app. Como o Lovable
> Cloud não revela secrets, use a mesma string aleatória em ambos: no
> Lovable use `update_secret` pra definir, aqui você cola o mesmo valor.

### 4. Domain / Port
Aba **Domains**:
- **Port**: `3000`
- Sem domínio? Deixa só o IP direto: `http://179.197.231.80:3000` (funciona pra push do app)

Aba **Deploy**: clica **Deploy**. Aguarda ~3-5 min (baixa ffmpeg + yt-dlp).

### 5. Configurar RENDER_WORKER_URL no app
No Lovable, adiciona o secret `RENDER_WORKER_URL=http://179.197.231.80:3000`
para o app saber onde enfileirar jobs.

### 6. Testar
```bash
curl http://179.197.231.80:3000/health
# → {"ok":true,"version":"youtube-rescue-v3","youtube":{"bgutil_pot":true,"proxy":true,...}}
```

Se `/health` não mostrar `version: "youtube-rescue-v3"`, o EasyPanel ainda está
rodando a imagem antiga. Faça rebuild/deploy sem cache.

O worker já vem com PO Token provider, runtime JS e múltiplos clients do
YouTube. Isso resolve parte dos bloqueios, mas **não limpa IP de VPS marcado**.
Quando aparecer `Sign in to confirm you’re not a bot`, a correção de produção é:

1. configurar `YTDLP_PROXY`/`YTDLP_PROXIES` com proxy residencial ou ISP limpo;
2. opcionalmente configurar `YTDLP_COOKIES_B64` com cookies server-side de uma
   conta operacional do Clipfy.

O cliente final não instala extensão, não fornece cookie e não vê isso.

## Endpoints

- `GET  /health` — status público (fila, jobs rodando)
- `POST /jobs` — recebe `{ job_id, edl }`, requer `Authorization: Bearer <secret>`

## EDL esperado

```json
{
  "version": 1,
  "source": { "kind": "upload|youtube|url", "url": "https://..." },
  "output": {
    "bucket": "renders",
    "path": "<user>/<project>/<clip>-<ts>.mp4",
    "upload_url": "https://<supabase>/storage/v1/object/upload/sign/...",
    "aspect_ratio": "9:16"
  },
  "clip": { "id": "...", "title": "...", "start": 12.4, "end": 42.1 },
  "captions": {
    "template": "hormozi-slam|neon-pulse|tiktok-chip|minimal-clean",
    "language": "pt|en|auto",
    "segments": [{ "words": [{ "word": "olá", "start": 12.5, "end": 12.7 }] }]
  },
  "caption_position": "top|middle|bottom"
}
```

Se `captions.segments` já vem com timing por palavra, pula o Groq. Caso
contrário, o worker transcreve o clip com `whisper-large-v3-turbo`.

## Callback assinado

`POST https://clipfy1.lovable.app/api/public/render-callback`

Headers: `x-render-signature: <hex(hmac_sha256(RENDER_WORKER_SECRET, body))>`

## Requisitos de VPS

- **KVM 1** (1 vCPU / 4GB): OK para clips < 3min, transcrição via Groq
- **KVM 2** (2 vCPU / 8GB): recomendado, roda 2 jobs em paralelo (`CONCURRENCY=2`)
- Disco: ≥ 20 GB (vídeos temporários ficam em `/tmp/clipfy/<job>`)

## Logs

No EasyPanel → aba **Logs** do serviço. Erros de FFmpeg vêm com os últimos
800 chars do stderr. Se ver `Downloader ffprobe` sumindo: verifique
`ffmpeg -version` no shell do container.
