// Clipfy Render Worker
// Recebe jobs via POST /jobs (autenticado com Bearer RENDER_WORKER_SECRET)
// Baixa o source, transcreve com Groq (se preciso), corta com FFmpeg, queima
// legendas animadas, faz upload assinado no bucket `renders` e callback HMAC.
import Fastify from "fastify";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdir, rm, readFile, writeFile, stat } from "node:fs/promises";
import fs, { createReadStream } from "node:fs";
import path from "node:path";
import { request as undiciRequest } from "undici";
import Groq from "groq-sdk";

const {
  PORT = "8080",
  RENDER_WORKER_SECRET,
  GROQ_API_KEY,
  APP_URL = "https://clipfy1.lovable.app",
  WORK_DIR = "/tmp/clipfy",
  WORKER_ID = "vps-01",
  CONCURRENCY = "1",
  BGUTIL_PROVIDER_PORT = "4416",
} = process.env;

if (!RENDER_WORKER_SECRET) throw new Error("RENDER_WORKER_SECRET obrigatório");
if (!GROQ_API_KEY) console.warn("[warn] GROQ_API_KEY não setado (transcrição off)");

const groq = GROQ_API_KEY ? new Groq({ apiKey: GROQ_API_KEY }) : null;
const app = Fastify({ logger: true });
const TRANSCRIBE_CHUNK_SECONDS = Math.max(
  15,
  parseInt(process.env.TRANSCRIBE_CHUNK_SECONDS ?? "180", 10),
);
const TRANSCRIBE_MIN_CHUNK_SECONDS = Math.max(
  5,
  parseInt(process.env.TRANSCRIBE_MIN_CHUNK_SECONDS ?? "15", 10),
);
const TRANSCRIBE_AUDIO_BITRATE = process.env.TRANSCRIBE_AUDIO_BITRATE ?? "32k";
const TRANSCRIBE_MAX_UPLOAD_BYTES = Math.max(
  1 * 1024 * 1024,
  parseInt(process.env.TRANSCRIBE_MAX_UPLOAD_MB ?? "18", 10) * 1024 * 1024,
);

// -------------------- fila em memória --------------------
const queue = [];
let running = 0;
const MAX = Math.max(1, parseInt(CONCURRENCY, 10));
let bgutilStarted = false;

// -------------------- callback assinado --------------------
async function callback(payload, targetUrl = `${APP_URL}/api/public/render-callback`) {
  const body = JSON.stringify(payload);
  const signature = createHmac("sha256", RENDER_WORKER_SECRET).update(body).digest("hex");
  const finalStatus = payload.status === "completed" || payload.status === "failed" || payload.status === "cancelled";
  const maxAttempts = finalStatus ? 10 : 4;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await undiciRequest(targetUrl,
        {
        method: "POST",
        headers: { "content-type": "application/json", "x-render-signature": signature },
        body,
        headersTimeout: 60000,
        bodyTimeout: 60000,
      });
      if (res.statusCode < 300) return true;
      const txt = await res.body.text();
      app.log.error({ attempt, status: res.statusCode, txt }, "callback falhou");
    } catch (err) {
      app.log.error({ attempt, err }, "callback network erro");
    }

    if (attempt < maxAttempts) {
      const delay = Math.min(45000, 1500 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 750);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  return false;
}

// -------------------- helpers --------------------
function sh(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
    let stderr = "";
    p.stderr.on("data", (d) => (stderr += d.toString()));
    p.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}: ${stderr.slice(-800)}`)),
    );
  });
}

function startBgutilProvider() {
  if (bgutilStarted || process.env.DISABLE_BGUTIL_POT === "1") return;
  const serverFile = "/opt/bgutil-ytdlp-pot-provider/server/build/main.js";
  if (!fs.existsSync(serverFile)) {
    app.log.warn("bgutil PO Token provider não encontrado; yt-dlp segue sem PO Token");
    return;
  }

  const p = spawn("node", [serverFile, "--port", BGUTIL_PROVIDER_PORT], {
    stdio: ["ignore", "ignore", "pipe"],
    env: process.env,
  });
  bgutilStarted = true;
  app.log.info({ port: BGUTIL_PROVIDER_PORT }, "bgutil PO Token provider iniciando");
  p.stderr.on("data", (d) => app.log.warn({ msg: d.toString().slice(-500) }, "bgutil stderr"));
  p.on("exit", (code) => {
    bgutilStarted = false;
    app.log.warn({ code }, "bgutil PO Token provider parou");
  });
}

function safeErrorMessage(err) {
  return String(err?.message ?? err)
    .replace(/--cookies\s+\S+/g, "--cookies [hidden]")
    .slice(-900);
}

function ytdlpCookieArgs() {
  const args = [];
  const cookiesFile = process.env.YTDLP_COOKIES_FILE;
  const cookiesBase64 = process.env.YTDLP_COOKIES_B64;
  const cookiesInline = process.env.YTDLP_COOKIES;

  if (cookiesFile && fs.existsSync(cookiesFile)) {
    args.push("--cookies", cookiesFile);
  } else if (cookiesBase64) {
    const p = "/tmp/yt-cookies.txt";
    try {
      fs.writeFileSync(p, Buffer.from(cookiesBase64, "base64").toString("utf8"), { mode: 0o600 });
      args.push("--cookies", p);
    } catch (err) {
      app.log.warn({ err }, "YTDLP_COOKIES_B64 inválido");
    }
  } else if (cookiesInline) {
    const p = "/tmp/yt-cookies.txt";
    try {
      fs.writeFileSync(p, cookiesInline, { mode: 0o600 });
      args.push("--cookies", p);
    } catch (err) {
      app.log.warn({ err }, "YTDLP_COOKIES inválido");
    }
  }

  return args;
}

function ytdlpRuntimeArgs() {
  const runtimes = [];
  if (fs.existsSync("/usr/local/bin/node")) runtimes.push("node:/usr/local/bin/node");
  if (fs.existsSync("/usr/local/bin/deno")) runtimes.push("deno:/usr/local/bin/deno");
  if (!runtimes.length) return [];
  return ["--js-runtimes", runtimes.join(",")];
}

const YTDLP_CLIENT_STRATEGIES = [
  { name: "mweb", extractor: "youtube:player_client=mweb" },
  { name: "web_creator", extractor: "youtube:player_client=web_creator" },
  { name: "android", extractor: "youtube:player_client=android" },
  { name: "android_vr", extractor: "youtube:player_client=android_vr" },
  { name: "ios", extractor: "youtube:player_client=ios" },
  { name: "web_safari", extractor: "youtube:player_client=web_safari" },
  { name: "tv_embedded", extractor: "youtube:player_client=tv_embedded" },
  { name: "web_embedded", extractor: "youtube:player_client=web_embedded" },
  { name: "default", extractor: "youtube:player_client=default" },
];

function ytdlpProxyPool() {
  const pool = [
    ...(process.env.YTDLP_PROXIES ?? "")
      .split(/[\n,]+/)
      .map((value) => value.trim())
      .filter(Boolean),
    ...(process.env.YTDLP_PROXY ? [process.env.YTDLP_PROXY.trim()] : []),
  ];
  return [...new Set(pool)];
}

function maskProxy(proxy) {
  if (!proxy) return "direct";
  try {
    const url = new URL(proxy);
    if (url.username) url.username = "***";
    if (url.password) url.password = "***";
    return url.toString();
  } catch {
    return "configured";
  }
}

// Args comuns pro yt-dlp: runtime JS explícito, cookies server-side opcionais,
// headers/retries e variações de player-client para aguentar bloqueios do YouTube.
function ytdlpCommonArgs(strategy = YTDLP_CLIENT_STRATEGIES[0], proxy = null) {
  const extractorArgs = [strategy.extractor];
  if (process.env.DISABLE_BGUTIL_POT !== "1") {
    extractorArgs.push(`youtubepot-bgutilhttp:base_url=http://127.0.0.1:${BGUTIL_PROVIDER_PORT}`);
  }

  const args = [
    ...ytdlpRuntimeArgs(),
    "--retries", "3",
    "--extractor-retries", "3",
    "--fragment-retries", "3",
    "--socket-timeout", "20",
    "--force-ipv4",
    "--geo-bypass",
    "--no-check-certificates",
    "--sleep-requests", "1",
    "--sleep-interval", "1",
    "--max-sleep-interval", "3",
    "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "--add-header", "Accept-Language:pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "--add-header", "Referer:https://www.youtube.com/",
    "--extractor-args", extractorArgs.join(";"),
    ...ytdlpCookieArgs(),
  ];

  if (proxy) {
    args.push("--proxy", proxy);
  }

  return args;
}

async function ytdlpWithFallback(formatArgs, outputPath, url, label) {
  let lastErr;
  const proxies = ytdlpProxyPool();
  const proxyAttempts = proxies.length > 0 ? proxies : [null];

  for (const proxy of proxyAttempts) {
    for (const strategy of YTDLP_CLIENT_STRATEGIES) {
      try {
        await sh("yt-dlp", [
          ...ytdlpCommonArgs(strategy, proxy),
          ...formatArgs,
          "-o", outputPath,
          url,
        ]);
        app.log.info({ strategy: strategy.name, proxy: maskProxy(proxy), label }, "yt-dlp ok");
        return;
      } catch (err) {
        lastErr = err;
        app.log.warn(
          { strategy: strategy.name, proxy: maskProxy(proxy), label, err: safeErrorMessage(err) },
          "yt-dlp fallback",
        );
      }
    }
  }

  const blocked = /confirm you.?re not a bot|cookies|sign in/i.test(safeErrorMessage(lastErr));
  const hint = blocked
    ? "YouTube bloqueou o IP do servidor. Configure YTDLP_PROXY/YTDLP_PROXIES com proxy residencial ou ISP limpo, ou YTDLP_COOKIES_B64 com cookies server-side da conta operacional do Clipfy. Cliente final não instala extensão nem envia cookie."
    : "Falha ao extrair mídia do YouTube depois de múltiplas estratégias.";
  throw new Error(`${hint} Último erro: ${safeErrorMessage(lastErr)}`);
}

async function download(url, dest) {
  // YouTube → yt-dlp; resto → curl
  if (/youtube\.com|youtu\.be/.test(url)) {
    await ytdlpWithFallback([
      "-f", "bv*[height<=1080]+ba/b[height<=1080]",
      "--merge-output-format", "mp4",
    ], dest, url, "download-video");
  } else {
    await sh("curl", ["-L", "--fail", "-o", dest, url]);
  }
}

async function ffprobeDuration(file) {
  return new Promise((resolve, reject) => {
    const p = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      file,
    ]);
    let out = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.on("close", (c) => (c === 0 ? resolve(parseFloat(out.trim())) : reject(new Error("ffprobe"))));
  });
}

function normalizeWords(words, offset = 0) {
  return (words ?? [])
    .map((w) => ({
      word: String(w.word ?? "").trim(),
      start: Number(w.start ?? 0) + offset,
      end: Number(w.end ?? 0) + offset,
    }))
    .filter((w) => w.word && Number.isFinite(w.start) && Number.isFinite(w.end));
}

function normalizeSegments(segments, words, offset = 0) {
  return (segments ?? [])
    .map((s) => {
      const start = Number(s.start ?? 0) + offset;
      const end = Number(s.end ?? 0) + offset;
      return {
        text: String(s.text ?? "").trim(),
        start,
        end,
        words: words.filter((w) => w.start >= start - 0.05 && w.end <= end + 0.05),
      };
    })
    .filter((s) => s.text && Number.isFinite(s.start) && Number.isFinite(s.end));
}

async function transcribeAudioFile(audioFile, language, offset = 0) {
  const audioStat = await stat(audioFile);
  if (audioStat.size > TRANSCRIBE_MAX_UPLOAD_BYTES) {
    throw new Error(
      `Chunk bloqueado antes do Whisper: ${Math.round(audioStat.size / 1024 / 1024)}MB > limite seguro de ${Math.round(TRANSCRIBE_MAX_UPLOAD_BYTES / 1024 / 1024)}MB.`,
    );
  }

  let tr;
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      tr = await groq.audio.transcriptions.create({
        file: createReadStream(audioFile),
        model: "whisper-large-v3-turbo",
        response_format: "verbose_json",
        timestamp_granularities: ["segment", "word"],
        language: language && language !== "auto" ? language : undefined,
      });
      break;
    } catch (err) {
      const msg = String(err?.message ?? err);
      if (/413|request entity too large|request_too_large/i.test(msg)) {
        throw new Error(
          `Groq recusou o chunk por tamanho (${Math.round(audioStat.size / 1024 / 1024)}MB). O worker vai precisar de chunks menores; erro original: ${msg.slice(0, 220)}`,
        );
      }
      const status = err?.status ?? err?.response?.status;
      const transient =
        /ECONNRESET|ETIMEDOUT|ENETUNREACH|EAI_AGAIN|socket hang up|Connection error|fetch failed|network|timeout/i.test(msg) ||
        status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
      if (!transient || attempt === maxAttempts) throw err;
      const delay = Math.min(30000, 1000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 500);
      app.log.warn(
        { attempt, delay_ms: delay, status, message: msg.slice(0, 200) },
        "groq transient error; retrying chunk",
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }


  const words = normalizeWords(tr.words, offset);
  const segments = normalizeSegments(tr.segments, words, offset);

  if (!segments.length && String(tr.text ?? "").trim()) {
    const duration = await ffprobeDuration(audioFile).catch(() => null);
    segments.push({
      text: String(tr.text ?? "").trim(),
      start: offset,
      end: offset + (Number.isFinite(duration) ? duration : 0),
      words,
    });
  }

  return {
    language: tr.language ?? language ?? null,
    text: String(tr.text ?? "").trim(),
    words,
    segments,
  };
}

async function transcribeMediaInChunks(mediaFile, jobDir, language, onProgress = async () => {}) {
  if (!groq) throw new Error("Worker sem GROQ_API_KEY");

  const duration = await ffprobeDuration(mediaFile).catch(() => null);
  const totalDuration = Number.isFinite(duration) && duration > 0 ? duration : null;
  const allSegments = [];
  const allText = [];
  let detectedLanguage = language ?? null;
  let chunkIndex = 0;
  let cursor = 0;

  while (totalDuration ? cursor < totalDuration - 0.25 : chunkIndex === 0) {
    const start = cursor;
    const remaining = totalDuration ? Math.max(1, totalDuration - start) : TRANSCRIBE_CHUNK_SECONDS;
    let chunkDuration = Math.min(TRANSCRIBE_CHUNK_SECONDS, remaining);
    let chunkFile;
    let chunkStat;

    for (;;) {
      chunkFile = path.join(jobDir, `audio-${String(chunkIndex + 1).padStart(3, "0")}-${Math.round(chunkDuration)}s.mp3`);
      await rm(chunkFile, { force: true }).catch(() => {});

      const ffmpegArgs = [
        "-y",
        ...(start > 0 ? ["-ss", String(start)] : []),
        "-i", mediaFile,
        ...(totalDuration ? ["-t", String(chunkDuration)] : []),
        "-vn",
        "-ac", "1",
        "-ar", "16000",
        "-codec:a", "libmp3lame",
        "-b:a", TRANSCRIBE_AUDIO_BITRATE,
        chunkFile,
      ];
      await sh("ffmpeg", ffmpegArgs);

      chunkStat = await stat(chunkFile);
      if (chunkStat.size <= TRANSCRIBE_MAX_UPLOAD_BYTES || chunkDuration <= TRANSCRIBE_MIN_CHUNK_SECONDS) break;

      app.log.warn(
        {
          chunk: chunkIndex + 1,
          size_mb: Math.round(chunkStat.size / 1024 / 1024),
          duration_seconds: Math.round(chunkDuration),
          max_mb: Math.round(TRANSCRIBE_MAX_UPLOAD_BYTES / 1024 / 1024),
        },
        "chunk de áudio grande; reduzindo duração antes de chamar Groq",
      );
      await rm(chunkFile, { force: true }).catch(() => {});
      chunkDuration = Math.max(TRANSCRIBE_MIN_CHUNK_SECONDS, Math.floor(chunkDuration / 2));
    }

    if (chunkStat.size > TRANSCRIBE_MAX_UPLOAD_BYTES) {
      throw new Error(
        `Mesmo o chunk mínimo ficou grande demais (${Math.round(chunkStat.size / 1024 / 1024)}MB). Configure TRANSCRIBE_AUDIO_BITRATE=16k ou reduza TRANSCRIBE_MIN_CHUNK_SECONDS.`,
      );
    }

    app.log.info(
      {
        chunk: chunkIndex + 1,
        start_seconds: Math.round(start),
        duration_seconds: Math.round(chunkDuration),
        size_mb: Number((chunkStat.size / 1024 / 1024).toFixed(2)),
      },
      "transcrevendo chunk seguro",
    );

    const tr = await transcribeAudioFile(chunkFile, language, start);
    detectedLanguage = tr.language ?? detectedLanguage;
    if (tr.text) allText.push(tr.text);
    allSegments.push(...tr.segments);

    await rm(chunkFile, { force: true }).catch(() => {});
    cursor = totalDuration ? start + chunkDuration : TRANSCRIBE_CHUNK_SECONDS;
    chunkIndex++;
    const progress = totalDuration
      ? 55 + Math.round(Math.min(1, cursor / totalDuration) * 30)
      : 85;
    await onProgress(Math.min(85, progress));
  }

  return {
    duration: totalDuration,
    language: detectedLanguage,
    full_text: allText.join(" ").replace(/\s+/g, " ").trim(),
    segments: allSegments,
  };
}

// Legendas .ass estilo karaokê palavra-a-palavra
function buildAssSubtitle(words, opts) {
  const { template = "hormozi-slam", position = "bottom", aspect = "9:16" } = opts;
  if (template === "none") return "";
  const [w, h] = aspect === "9:16" ? [1080, 1920] : aspect === "1:1" ? [1080, 1080] : [1920, 1080];

  // Presets por template
  const presets = {
    "hormozi-slam":  { font: "DejaVu Sans", size: 76, primary: "&H00FFFFFF", outline: "&H00000000", back: "&H00000000", bold: 1, borderStyle: 1, outlineW: 5, shadow: 2, marginV: 260 },
    "beasty":        { font: "DejaVu Sans", size: 78, primary: "&H00FFFFFF", outline: "&H00000000", back: "&H00000000", bold: 1, borderStyle: 1, outlineW: 6, shadow: 2, marginV: 270 },
    "mozi":          { font: "DejaVu Sans", size: 74, primary: "&H00FFFFFF", outline: "&H00000000", back: "&H00000000", bold: 1, borderStyle: 1, outlineW: 5, shadow: 2, marginV: 260 },
    "big-impact":    { font: "DejaVu Sans", size: 84, primary: "&H00FFFFFF", outline: "&H00000000", back: "&H00000000", bold: 1, borderStyle: 1, outlineW: 6, shadow: 2, marginV: 330 },
    "neon-pulse":    { font: "DejaVu Sans", size: 66, primary: "&H00FFFFFF", outline: "&H00FF00FF", back: "&H00000000", bold: 1, borderStyle: 1, outlineW: 4, shadow: 0, marginV: 280 },
    "tiktok-chip":   { font: "DejaVu Sans", size: 58, primary: "&H00FFFFFF", outline: "&H00000000", back: "&H99000000", bold: 1, borderStyle: 3, outlineW: 7, shadow: 0, marginV: 320 },
    "minimal-clean": { font: "DejaVu Sans", size: 58, primary: "&H00FFFFFF", outline: "&H00000000", back: "&H00000000", bold: 0, borderStyle: 1, outlineW: 3, shadow: 0, marginV: 220 },
  };
  const s = presets[template] ?? presets["hormozi-slam"];

  const alignment = position === "top" ? 8 : position === "middle" ? 5 : 2;

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${w}
PlayResY: ${h}
ScaledBorderAndShadow: yes
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Def,${s.font},${s.size},${s.primary},&H000000FF,${s.outline},${s.back},${s.bold},0,0,0,100,100,0,0,${s.borderStyle},${s.outlineW},${s.shadow},${alignment},130,130,${s.marginV},1
Style: Hi,${s.font},${s.size},&H0000FFFF,&H000000FF,${s.outline},${s.back},1,0,0,0,104,104,0,0,${s.borderStyle},${s.outlineW},${s.shadow},${alignment},130,130,${s.marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const fmt = (t) => {
    const H = Math.floor(t / 3600);
    const M = Math.floor((t % 3600) / 60);
    const S = (t % 60).toFixed(2).padStart(5, "0");
    return `${H}:${String(M).padStart(2, "0")}:${S}`;
  };

  // Agrupa palavras em linhas curtas para não estourar a largura no 9:16.
  const lines = [];
  let group = [];
  let chars = 0;
  const maxWords = aspect === "9:16" ? 3 : 5;
  const maxChars = aspect === "9:16" ? 22 : 36;
  for (const wd of words) {
    const clean = String(wd.word || "").replace(/[{}]/g, "").trim();
    const nextChars = chars + clean.length + (group.length ? 1 : 0);
    if (group.length > 0 && (group.length >= maxWords || nextChars > maxChars)) {
      lines.push(group);
      group = [];
      chars = 0;
    }
    group.push(wd);
    chars += clean.length + (group.length > 1 ? 1 : 0);
    if ((wd.word || "").match(/[.!?]$/)) {
      lines.push(group);
      group = [];
      chars = 0;
    }
  }
  if (group.length) lines.push(group);

  let events = "";
  for (const line of lines) {
    const lineStart = line[0].start;
    const lineEnd = line[line.length - 1].end;
    // Renderiza uma linha por palavra ativa — destaca palavra atual
    for (let i = 0; i < line.length; i++) {
      const wStart = line[i].start;
      const wEnd = line[i].end;
      const text = line
        .map((wd, j) => {
          const clean = String(wd.word || "").replace(/[{}]/g, "").trim();
          if (j === i) return `{\\rHi}${clean}{\\rDef}`;
          return clean;
        })
        .join(" ");
      events += `Dialogue: 0,${fmt(wStart)},${fmt(wEnd)},Def,,0,0,0,,${text}\n`;
    }
    void lineStart; void lineEnd;
  }

  return header + events;
}

function scenePlanWantsMultiCam(edl, aspect) {
  const layout = edl.layout;
  const scenes = Array.isArray(edl.scene_plan?.scenes) ? edl.scene_plan.scenes : [];
  const hasMultiScene = scenes.some((s) => ["split", "stack", "pip", "quad"].includes(String(s.layout)));
  return aspect === "9:16" && (layout === "split-v" || layout === "split-h" || (layout === "auto" && hasMultiScene));
}

function buildReframeFilter(edl, aw, ah) {
  const aspect = edl.output?.aspect_ratio ?? "9:16";
  if (scenePlanWantsMultiCam(edl, aspect)) {
    const topH = Math.floor(ah / 2);
    const bottomH = ah - topH;
    return {
      complex: true,
      filter:
        `[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,split=2[leftSrc][rightSrc];` +
        `[leftSrc]crop=iw*0.54:ih:0:0,scale=${aw}:${topH}:force_original_aspect_ratio=increase,crop=${aw}:${topH}[top];` +
        `[rightSrc]crop=iw*0.54:ih:iw*0.46:0,scale=${aw}:${bottomH}:force_original_aspect_ratio=increase,crop=${aw}:${bottomH}[bottom];` +
        `[top][bottom]vstack=inputs=2[v]`,
    };
  }

  return {
    complex: false,
    filter: `scale=iw*max(${aw}/iw\,${ah}/ih):ih*max(${aw}/iw\,${ah}/ih),crop=${aw}:${ah}`,
  };
}

async function transcribeIfNeeded(sourceFile, existingSegments, language) {
  const hasWords = Array.isArray(existingSegments) && existingSegments.some((s) => Array.isArray(s.words) && s.words.length > 0);
  if (hasWords) {
    // Achata para palavras
    const words = [];
    for (const seg of existingSegments) {
      for (const w of seg.words ?? []) {
        words.push({ word: w.word ?? w.text ?? "", start: w.start, end: w.end });
      }
    }
    if (words.length) return words;
  }
  if (!groq) return [];

  const renderTranscribeDir = `${sourceFile}.transcribe`;
  await mkdir(renderTranscribeDir, { recursive: true });
  try {
    const transcript = await transcribeMediaInChunks(sourceFile, renderTranscribeDir, language);
    return transcript.segments.flatMap((segment) => segment.words ?? []);
  } finally {
    await rm(renderTranscribeDir, { recursive: true, force: true }).catch(() => {});
  }
}

// -------------------- pipeline principal --------------------
async function processJob(job) {
  const { job_id, edl } = job;
  const jobDir = path.join(WORK_DIR, job_id);
  await mkdir(jobDir, { recursive: true });
  const callbackUrl = edl?.callback_url || `${APP_URL}/api/public/render-callback`;
  const sendCallback = (payload) => callback(payload, callbackUrl);

  await sendCallback({ job_id, status: "processing", progress: 5, worker_id: WORKER_ID });

  try {
    if (!edl?.source?.url) throw new Error("source.url ausente");
    if (!edl?.output?.upload_url) throw new Error("output.upload_url ausente (reenfileirar o job)");

    // 1. Download
    const srcExt = /youtube/.test(edl.source.url) ? "mp4" : "src";
    const srcFile = path.join(jobDir, `source.${srcExt}`);
    await download(edl.source.url, srcFile);
    await sendCallback({ job_id, status: "processing", progress: 25, worker_id: WORKER_ID });

    // 2. Corta trecho do clip
    const start = Math.max(0, Number(edl.clip.start ?? 0));
    const end = Number(edl.clip.end ?? 0);
    const duration = Math.max(1, end - start);
    const cutFile = path.join(jobDir, "cut.mp4");
    await sh("ffmpeg", [
      "-y", "-ss", String(start), "-i", srcFile, "-t", String(duration),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
      "-c:a", "aac", "-b:a", "128k",
      "-movflags", "+faststart",
      cutFile,
    ]);
    await sendCallback({ job_id, status: "processing", progress: 45, worker_id: WORKER_ID });

    // 3. Reframe aspect ratio. Para podcast horizontal em Shorts, quando há
    // múltiplos falantes, usa stack top/bottom em vez de crop central vazio.
    const aspect = edl.output.aspect_ratio ?? "9:16";
    const [aw, ah] = aspect === "9:16" ? [1080, 1920] : aspect === "1:1" ? [1080, 1080] : [1920, 1080];
    const framedFile = path.join(jobDir, "framed.mp4");
    const vf = buildReframeFilter(edl, aw, ah);
    if (vf.complex) {
      await sh("ffmpeg", [
        "-y", "-i", cutFile,
        "-filter_complex", vf.filter,
        "-map", "[v]", "-map", "0:a?",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-c:a", "copy",
        framedFile,
      ]);
    } else {
      await sh("ffmpeg", ["-y", "-i", cutFile, "-vf", vf.filter, "-c:a", "copy", framedFile]);
    }
    await sendCallback({ job_id, status: "processing", progress: 60, worker_id: WORKER_ID });

    // 4. Legendas (Groq se preciso, converte para timeline do trecho)
    const captionsEnabled = edl.captions?.enabled !== false && edl.captions?.template !== "none";
    const rawWords = captionsEnabled
      ? await transcribeIfNeeded(framedFile, edl.captions?.segments, edl.captions?.language)
      : [];
    // Se palavras vêm do transcript global, elas usam timestamp global — reajusta pro corte
    const words = rawWords
      .map((w) => ({ word: w.word, start: w.start - start, end: w.end - start }))
      .filter((w) => w.end > 0 && w.start < duration)
      .map((w) => ({ word: w.word, start: Math.max(0, w.start), end: Math.min(duration, w.end) }));

    const assFile = path.join(jobDir, "subs.ass");
    if (captionsEnabled && words.length > 0) {
      const ass = buildAssSubtitle(words, {
        template: edl.captions?.template,
        position: edl.caption_position,
        aspect,
      });
      await writeFile(assFile, ass, "utf8");
    }
    await sendCallback({ job_id, status: "processing", progress: 75, worker_id: WORKER_ID });

    // 5. Queima legendas
    const outFile = path.join(jobDir, "out.mp4");
    if (captionsEnabled && words.length > 0) {
      await sh("ffmpeg", [
        "-y", "-i", framedFile,
        "-vf", `ass=${assFile}`,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-c:a", "copy",
        "-movflags", "+faststart",
        outFile,
      ]);
    } else {
      // Sem transcrição — só copia
      await sh("ffmpeg", ["-y", "-i", framedFile, "-c", "copy", outFile]);
    }
    await sendCallback({ job_id, status: "processing", progress: 88, worker_id: WORKER_ID });

    // 6. Upload assinado pro Supabase Storage (bucket renders)
    const buf = await readFile(outFile);
    const st = await stat(outFile);
    const putRes = await undiciRequest(edl.output.upload_url, {
      method: "PUT",
      headers: {
        "content-type": "video/mp4",
        "content-length": String(st.size),
        "x-upsert": "true",
      },
      body: buf,
    });
    if (putRes.statusCode >= 300) {
      const txt = await putRes.body.text();
      throw new Error(`upload falhou ${putRes.statusCode}: ${txt.slice(0, 300)}`);
    }

    await sendCallback({
      job_id,
      status: "completed",
      progress: 100,
      output_path: edl.output.path,
      worker_id: WORKER_ID,
    });
  } catch (err) {
    app.log.error({ err, job_id }, "job falhou");
    await sendCallback({ job_id, status: "failed", error_message: String(err.message ?? err), worker_id: WORKER_ID });
  } finally {
    await rm(jobDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function tick() {
  while (running < MAX && queue.length) {
    const job = queue.shift();
    running++;
    processJob(job).finally(() => {
      running--;
      tick();
    });
  }
}

// -------------------- rotas --------------------
app.get("/", async () => ({ ok: true, service: "clipfy-render-worker", version: "youtube-rescue-v5-safe-groq-chunks" }));
app.get("/health", async () => ({
  ok: true,
  version: "youtube-rescue-v5-safe-groq-chunks",
  running,
  queued: queue.length,
  worker_id: WORKER_ID,
  transcribe: {
    chunk_seconds: TRANSCRIBE_CHUNK_SECONDS,
    min_chunk_seconds: TRANSCRIBE_MIN_CHUNK_SECONDS,
    audio_bitrate: TRANSCRIBE_AUDIO_BITRATE,
    max_upload_mb: Math.round(TRANSCRIBE_MAX_UPLOAD_BYTES / 1024 / 1024),
  },
  youtube: {
    bgutil_pot: bgutilStarted,
    cookies: ytdlpCookieArgs().length > 0,
    proxy: ytdlpProxyPool().length > 0,
    proxy_count: ytdlpProxyPool().length,
    proxy_mode: ytdlpProxyPool().length > 1 ? "pool" : ytdlpProxyPool().length === 1 ? "single" : "off",
  },
}));

app.post("/jobs", async (req, reply) => {
  const auth = req.headers["authorization"] ?? "";
  if (auth !== `Bearer ${RENDER_WORKER_SECRET}`) {
    return reply.code(401).send({ error: "unauthorized" });
  }
  const { job_id, edl } = req.body ?? {};
  if (!job_id || !edl) return reply.code(400).send({ error: "job_id e edl obrigatórios" });
  queue.push({ kind: "render", job_id, edl });
  tick();
  return { queued: true, position: queue.length };
});

// -------- Transcrição YouTube (yt-dlp + Groq) --------
async function processTranscribeJob(job) {
  const { job_id, transcribe_job_id, source_url, language, callback_url } = job;
  const jobDir = path.join(WORK_DIR, `t-${job_id}`);
  await mkdir(jobDir, { recursive: true });
  const cb = (payload) => callback({ job_id, transcribe_job_id, worker_id: WORKER_ID, ...payload }, callback_url);

  await cb({ status: "processing", progress: 10 });

  try {
    if (!groq) throw new Error("Worker sem GROQ_API_KEY");
    const isYT = /youtube\.com|youtu\.be/.test(source_url);
    const mediaFile = path.join(jobDir, isYT ? "src.m4a" : "src.mp4");

    if (isYT) {
      // Baixa só o áudio pra reduzir tempo/banda
      await ytdlpWithFallback(["-f", "bestaudio[ext=m4a]/bestaudio"], mediaFile, source_url, "transcribe-audio");
    } else {
      await sh("curl", ["-L", "--fail", "-o", mediaFile, source_url]);
    }
    await cb({ status: "processing", progress: 40 });

    await cb({ status: "processing", progress: 55 });

    const transcript = await transcribeMediaInChunks(mediaFile, jobDir, language, async (progress) => {
      await cb({ status: "processing", progress });
    });

    await cb({
      status: "completed",
      progress: 100,
      language: transcript.language ?? language ?? null,
      duration: transcript.duration,
      full_text: transcript.full_text,
      segments: transcript.segments,
    });
  } catch (err) {
    app.log.error({ err, job_id }, "transcribe falhou");
    await cb({ status: "failed", error_message: String(err.message ?? err) });
  } finally {
    await rm(jobDir, { recursive: true, force: true }).catch(() => {});
  }
}

app.post("/transcribe", async (req, reply) => {
  const auth = req.headers["authorization"] ?? "";
  if (auth !== `Bearer ${RENDER_WORKER_SECRET}`) {
    return reply.code(401).send({ error: "unauthorized" });
  }
  const { job_id, transcribe_job_id, source_url, language, callback_url } = req.body ?? {};
  if (!job_id || !source_url) return reply.code(400).send({ error: "job_id e source_url obrigatórios" });
  // Executa em background — callback assíncrono via HMAC
  processTranscribeJob({ job_id, transcribe_job_id, source_url, language, callback_url }).catch((err) =>
    app.log.error({ err, job_id }, "transcribe crash"),
  );
  return { accepted: true };
});

// Bootstrap
await mkdir(WORK_DIR, { recursive: true });
startBgutilProvider();
app.listen({ host: "0.0.0.0", port: parseInt(PORT, 10) }).then(() => {
  app.log.info(`clipfy worker rodando na porta ${PORT}`);
});
