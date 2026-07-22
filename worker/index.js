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
import { buildReframePlan } from "./reframe.js";
import { emitDebugArtifacts } from "./debug-emit.js";

const WORKER_VERSION = "sprint1a-debug-evidence";

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
  const timeoutMs = finalStatus ? 600000 : 60000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await undiciRequest(targetUrl,
        {
        method: "POST",
        headers: { "content-type": "application/json", "x-render-signature": signature },
        body,
        headersTimeout: timeoutMs,
        bodyTimeout: timeoutMs,
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

function speakerColumnMap(edl) {
  const speakers = Array.isArray(edl.scene_plan?.speakers) ? edl.scene_plan.speakers : [];
  const cols = ["left", "right", "center"];
  const map = {};
  speakers.forEach((s, i) => {
    if (s?.id && i < 3) map[String(s.id)] = cols[i];
  });
  if (!map.A) map.A = "left";
  if (!map.B) map.B = "right";
  if (!map.C) map.C = "center";
  return map;
}

// -------------------- FACE TRACKING --------------------
// Roda o script Python face_track.py sobre o clipe cortado. Retorna sempre um
// objeto estruturado com { status, data? , error?, stage? } — NÃO retorna
// mais `null` silenciosamente. Sprint 1a: qualquer falha aqui é registrada
// para que o diagnóstico distinga "tracker rodou e não achou rosto" de
// "tracker não rodou".
async function runFaceTracker(videoPath, sampleFps = 2) {
  const started = Date.now();
  let fileExists = false;
  let fileSize = 0;
  try {
    const st = await stat(videoPath);
    fileExists = true;
    fileSize = st.size;
  } catch {}
  app.log.info(
    { event: "FACE_TRACKER_START", videoPath, fileExists, fileSize, sampleFps },
    "face tracker: start",
  );
  if (!fileExists) {
    const error = `video ausente: ${videoPath}`;
    app.log.error({ event: "FACE_TRACKER_FAILED", stage: "video_missing", error }, "face tracker: sem arquivo");
    return { status: "failed", stage: "video_missing", error };
  }

  const script = path.join(path.dirname(new URL(import.meta.url).pathname), "face_track.py");
  return await new Promise((resolve) => {
    const p = spawn("python3", [script, videoPath, String(sampleFps)], { stdio: ["ignore", "pipe", "pipe"] });
    let so = "", se = "";
    p.stdout.on("data", (d) => (so += d.toString()));
    p.stderr.on("data", (d) => (se += d.toString()));
    p.on("error", (err) => {
      app.log.error(
        { event: "FACE_TRACKER_FAILED", stage: "spawn", error: err.message, durationMs: Date.now() - started },
        "face tracker: spawn falhou",
      );
      resolve({ status: "failed", stage: "spawn", error: err.message, stderr: se.slice(-2000) });
    });
    p.on("close", (code) => {
      const durationMs = Date.now() - started;
      if (code !== 0) {
        app.log.error(
          { event: "FACE_TRACKER_FAILED", stage: "exit", exitCode: code, durationMs, stderr: se.slice(-2000) },
          "face tracker: exit != 0",
        );
        return resolve({ status: "failed", stage: "exit", error: `exit ${code}`, exitCode: code, stderr: se.slice(-2000) });
      }
      let data;
      try {
        data = JSON.parse(so);
      } catch (err) {
        app.log.error(
          { event: "FACE_TRACKER_FAILED", stage: "parse", error: err.message, durationMs, stdoutHead: so.slice(0, 500), stderr: se.slice(-2000) },
          "face tracker: JSON inválido",
        );
        return resolve({ status: "failed", stage: "parse", error: err.message, stderr: se.slice(-2000) });
      }
      if (data.status === "failed" || data.error) {
        app.log.error(
          { event: "FACE_TRACKER_FAILED", stage: data.stage ?? "internal", error: data.error, durationMs, stderr: se.slice(-2000) },
          "face tracker: retornou erro interno",
        );
        return resolve({ status: "failed", stage: data.stage ?? "internal", error: data.error, stderr: se.slice(-2000), data });
      }
      app.log.info(
        {
          event: "FACE_TRACKER_SUCCESS",
          durationMs,
          detector: data.detector,
          w: data.w,
          h: data.h,
          frames_processed: data.frames_processed ?? data.frames?.length ?? 0,
          detections: data.detections ?? null,
          tracks: data.tracks?.length ?? 0,
        },
        "face tracker: ok",
      );
      resolve({ status: "success", data, stderrTail: se.slice(-500) });
    });
  });
}

// Clusterização 1D simples: pega todos os centros X detectados, ordena,
// encontra o maior gap e divide em 2 clusters. Retorna {A:cx, B:cx} em pixels
// do vídeo original. Se só houver 1 cluster (single speaker), devolve center.
function clusterFaces(track) {
  if (!track || !track.frames) return null;
  const xs = [];
  for (const f of track.frames) {
    for (const [x, , w] of f.faces || []) xs.push(x + w / 2);
  }
  if (xs.length < 4) return null;
  xs.sort((a, b) => a - b);
  const span = xs[xs.length - 1] - xs[0];
  if (span < track.w * 0.18) {
    const mean = xs.reduce((s, v) => s + v, 0) / xs.length;
    return { single: mean, w: track.w, h: track.h };
  }
  let gapIdx = 0, gapVal = 0;
  for (let i = 1; i < xs.length; i++) {
    const g = xs[i] - xs[i - 1];
    if (g > gapVal) { gapVal = g; gapIdx = i; }
  }
  const left = xs.slice(0, gapIdx);
  const right = xs.slice(gapIdx);
  const mean = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
  return { A: mean(left), B: mean(right), w: track.w, h: track.h };
}

// Foco data-driven: agrupa detecções da janela em bins de ~8% da largura,
// pesa por área × score × contagem (rostos maiores e mais estáveis = foco),
// e aplica suavização temporal com o cx da cena anterior pra não pipocar.
// Retorna { cx } em pixels do vídeo ORIGINAL, ou null se sem detecções.
function faceGroupsInWindow(track, t0, t1, prevCx, diar) {
  if (!track || !track.frames || !track.w) return null;
  const binSize = Math.max(1, track.w * 0.075);
  const buckets = new Map();
  let sampledFrames = 0;
  for (const f of track.frames) {
    if (f.t < t0 - 0.25 || f.t > t1 + 0.25) continue;
    sampledFrames++;
    const frameKey = Math.round(f.t * 10);
    for (const [x, y, w, h, s] of f.faces || []) {
      if (w <= 0 || h <= 0) continue;
      const cx = x + w / 2;
      const cy = y + h / 2;
      const weight = (w * h) * Math.max(0.1, s ?? 0.5);
      const key = Math.round(cx / binSize);
      const b = buckets.get(key) || { sumX: 0, sumY: 0, sumW: 0, sumH: 0, wsum: 0, count: 0, frames: new Set() };
      b.sumX += cx * weight;
      b.sumY += cy * weight;
      b.sumW += w * weight;
      b.sumH += h * weight;
      b.wsum += weight;
      b.count += 1;
      b.frames.add(frameKey);
      buckets.set(key, b);
    }
  }
  if (buckets.size === 0) return null;
  const keys = [...buckets.keys()].sort((a, b) => a - b);
  const groups = [];
  for (const k of keys) {
    const b = buckets.get(k);
    const last = groups[groups.length - 1];
    if (last && k - last.lastK <= 1) {
      last.sumX += b.sumX; last.sumY += b.sumY;
      last.sumW += b.sumW; last.sumH += b.sumH;
      last.wsum += b.wsum; last.count += b.count;
      for (const frame of b.frames) last.frames.add(frame);
      last.lastK = k;
    } else {
      groups.push({ ...b, lastK: k });
    }
  }

  // Diarização: quem fala nesta janela e quanto tempo cada um fala?
  // active = [{speaker, talk}] ordenado por tempo falado desc.
  const active = diar?.turns ? activeSpeakersInWindow(diar.turns, t0, t1) : null;
  const dominantSpeaker = active?.[0]?.speaker;
  const dominantCentroid = dominantSpeaker ? diar?.speakerCentroids?.[dominantSpeaker] : null;
  const secondarySpeaker = active?.[1]?.speaker;
  const secondaryCentroid = secondarySpeaker ? diar?.speakerCentroids?.[secondarySpeaker] : null;

  const result = groups
    .filter((g) => g.wsum > 0)
    .map((g) => {
      const cx = g.sumX / g.wsum;
      const cy = g.sumY / g.wsum;
      const coverage = sampledFrames > 0 ? g.frames.size / sampledFrames : 0;
      let score = g.wsum * Math.log(1 + g.count) * (0.6 + Math.min(1, coverage));
      if (prevCx != null) {
        const dist = Math.abs(cx - prevCx) / track.w;
        if (dist < 0.15) score *= 1.35;
        else if (dist < 0.30) score *= 1.10;
      }
      // *** DIARIZATION BIAS ***
      // Foco vai pra quem está FALANDO agora, não pra quem só é mais visível.
      if (dominantCentroid != null) {
        const dSpk = Math.abs(cx - dominantCentroid) / track.w;
        if (dSpk < 0.12) score *= 2.4;      // é o falante dominante
        else if (dSpk < 0.22) score *= 1.4;
        else score *= 0.55;                  // não é quem está falando — penaliza
      }
      // Segundo falante (usado em stack/split) — bônus menor pra manter distinto.
      if (secondaryCentroid != null) {
        const dSec = Math.abs(cx - secondaryCentroid) / track.w;
        if (dSec < 0.12) score *= 1.15;
      }
      return { cx, cy, score, coverage, w: g.sumW / g.wsum, h: g.sumH / g.wsum };
    })
    .sort((a, b) => b.score - a.score);

  return result.length ? result : null;
}

function pickFocusCx(track, t0, t1, prevCx, diar) {
  const best = faceGroupsInWindow(track, t0, t1, prevCx, diar)?.[0];
  return best ? { cx: best.cx } : null;
}

// -------------------- DIARIZATION HELPERS --------------------
// Quanto tempo cada speaker fala dentro de [t0,t1] (em segundos).
function activeSpeakersInWindow(turns, t0, t1) {
  if (!Array.isArray(turns) || turns.length === 0) return null;
  const tally = new Map();
  for (const tr of turns) {
    const s = Math.max(t0, tr.start);
    const e = Math.min(t1, tr.end);
    if (e <= s) continue;
    tally.set(tr.speaker, (tally.get(tr.speaker) || 0) + (e - s));
  }
  if (tally.size === 0) return null;
  return [...tally.entries()]
    .map(([speaker, talk]) => ({ speaker, talk }))
    .sort((a, b) => b.talk - a.talk);
}

// Pra cada speaker, encontra o rosto que aparece MAIS TEMPO nas janelas em que
// ele está falando. É o mapa fala→rosto que resolve "câmera aponta pra pessoa errada".
function computeSpeakerCentroids(track, turns) {
  if (!track || !track.frames || !turns?.length) return {};
  const perSpeakerBins = new Map(); // speaker -> Map(binKey -> {sumX, sumY, wsum, count})
  const binSize = Math.max(1, track.w * 0.075);
  // Index turns por buckets de 0.5s pra lookup rápido
  const turnBuckets = new Map();
  for (const t of turns) {
    const s = Math.floor(t.start * 2), e = Math.ceil(t.end * 2);
    for (let k = s; k <= e; k++) {
      const arr = turnBuckets.get(k) || [];
      arr.push(t);
      turnBuckets.set(k, arr);
    }
  }
  const speakerAt = (time) => {
    const k = Math.round(time * 2);
    const cands = turnBuckets.get(k);
    if (!cands) return null;
    for (const t of cands) if (time >= t.start && time <= t.end) return t.speaker;
    return null;
  };
  for (const f of track.frames) {
    const speaker = speakerAt(f.t);
    if (!speaker) continue;
    let bins = perSpeakerBins.get(speaker);
    if (!bins) { bins = new Map(); perSpeakerBins.set(speaker, bins); }
    for (const [x, y, w, h, s] of f.faces || []) {
      if (w <= 0 || h <= 0) continue;
      const cx = x + w / 2, cy = y + h / 2;
      const weight = (w * h) * Math.max(0.1, s ?? 0.5);
      const key = Math.round(cx / binSize);
      const b = bins.get(key) || { sumX: 0, sumY: 0, wsum: 0, count: 0 };
      b.sumX += cx * weight; b.sumY += cy * weight;
      b.wsum += weight; b.count += 1;
      bins.set(key, b);
    }
  }
  const centroids = {};
  for (const [speaker, bins] of perSpeakerBins) {
    // Pega bin dominante (maior massa)
    let best = null;
    for (const b of bins.values()) if (!best || b.wsum > best.wsum) best = b;
    if (best && best.wsum > 0) {
      centroids[speaker] = { cx: best.sumX / best.wsum, cy: best.sumY / best.wsum, count: best.count };
    }
  }
  return centroids;
}

// Extrai áudio mono 16k pra diarização.
async function extractAudioForDiarize(cutFile, wavPath) {
  await sh("ffmpeg", ["-y", "-i", cutFile, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wavPath]);
}

// Roda diarize.py; retorna { status, data?, error?, stage? } — nunca `null`
// silencioso. Sprint 1a: qualquer falha aqui vira evidência explícita.
async function runDiarizer(wavPath) {
  const started = Date.now();
  if (!process.env.HF_TOKEN && !process.env.HUGGINGFACE_TOKEN) {
    app.log.warn({ event: "DIARIZE_SKIPPED", reason: "HF_TOKEN ausente" }, "diarize: pulando");
    return { status: "skipped", stage: "no_hf_token", error: "HF_TOKEN/HUGGINGFACE_TOKEN não configurado" };
  }
  let fileExists = false;
  let fileSize = 0;
  try {
    const st = await stat(wavPath);
    fileExists = true;
    fileSize = st.size;
  } catch {}
  app.log.info({ event: "DIARIZE_START", wavPath, fileExists, fileSize }, "diarize: start");
  if (!fileExists) {
    return { status: "failed", stage: "wav_missing", error: `wav ausente: ${wavPath}` };
  }
  const script = path.join(path.dirname(new URL(import.meta.url).pathname), "diarize.py");
  return await new Promise((resolve) => {
    const p = spawn("python3", [script, wavPath], { stdio: ["ignore", "pipe", "pipe"] });
    let so = "", se = "";
    p.stdout.on("data", (d) => (so += d.toString()));
    p.stderr.on("data", (d) => (se += d.toString()));
    p.on("error", (err) => {
      app.log.error({ event: "DIARIZE_FAILED", stage: "spawn", error: err.message, durationMs: Date.now() - started }, "diarize spawn falhou");
      resolve({ status: "failed", stage: "spawn", error: err.message, stderr: se.slice(-2000) });
    });
    p.on("close", (code) => {
      const durationMs = Date.now() - started;
      if (code !== 0) {
        app.log.error({ event: "DIARIZE_FAILED", stage: "exit", exitCode: code, durationMs, stderr: se.slice(-2000) }, "diarize exit != 0");
        return resolve({ status: "failed", stage: "exit", error: `exit ${code}`, exitCode: code, stderr: se.slice(-2000) });
      }
      let data;
      try { data = JSON.parse(so); } catch (err) {
        app.log.error({ event: "DIARIZE_FAILED", stage: "parse", error: err.message, durationMs, stderr: se.slice(-2000) }, "diarize JSON inválido");
        return resolve({ status: "failed", stage: "parse", error: err.message, stderr: se.slice(-2000) });
      }
      if (data.error) {
        app.log.error({ event: "DIARIZE_FAILED", stage: "internal", error: data.error, durationMs, stderr: se.slice(-2000) }, "diarize retornou erro");
        return resolve({ status: "failed", stage: "internal", error: data.error, stderr: se.slice(-2000), data });
      }
      app.log.info({ event: "DIARIZE_SUCCESS", durationMs, turns: data.turns?.length ?? 0, speakers: data.speakers?.length ?? 0 }, "diarize ok");
      resolve({ status: "success", data });
    });
  });
}


// Foco secundário: melhor grupo cuja distância do foco principal seja >= 20% da largura.
function pickSecondaryCx(track, t0, t1, excludeCx) {
  const groups = faceGroupsInWindow(track, t0, t1, null);
  const primary = groups?.find((g) => Math.abs(g.cx - excludeCx) < track.w * 0.12) ?? groups?.[0];
  const secondary = distinctFaceGroups(groups, primary, track?.w, 0.26)[0];
  return secondary ? { cx: secondary.cx, cy: secondary.cy, score: secondary.score } : null;
}

function distinctFaceGroups(groups, primary, trackW, minGapRatio = 0.26) {
  if (!Array.isArray(groups) || !primary || !trackW) return [];
  const minGap = trackW * minGapRatio;
  const minScore = primary.score * 0.28;
  return groups.filter(
    (g) =>
      Math.abs(g.cx - primary.cx) >= minGap &&
      g.score >= minScore &&
      g.coverage >= 0.25,
  );
}

function normalizedFace(group, track) {
  if (!group || !track?.w || !track?.h) return null;
  return {
    cx: Math.round((group.cx / track.w) * 1920),
    cy: Math.round((group.cy / track.h) * 1080),
    score: group.score,
    coverage: group.coverage,
  };
}

function cropX(cx, width) {
  return Math.max(0, Math.min(1920 - width, Math.round(cx - width / 2)));
}

function cropYForFace(cy, height) {
  return Math.max(0, Math.min(1080 - height, Math.round(cy - height * 0.34)));
}

function fullFocusFilter(norm, primary, sceneIndex) {
  const cx = primary?.cx ?? 960;
  const zoom = 1 + 0.045 * (sceneIndex % 3);
  const sliceW = Math.max(360, Math.round(608 / zoom));
  const sliceH = Math.max(720, Math.round(1080 / zoom));
  const x = cropX(cx, sliceW);
  const y = Math.max(0, Math.min(1080 - sliceH, Math.round((1080 - sliceH) / 2)));
  return `${norm},crop=${sliceW}:${sliceH}:${x}:${y},scale=1080:1920,setsar=1`;
}

function stackFilter(norm, primary, secondary) {
  const tileW = 760;
  const tileH = 675;
  const topX = cropX(primary.cx, tileW);
  const botX = cropX(secondary.cx, tileW);
  const topY = cropYForFace(primary.cy, tileH);
  const botY = cropYForFace(secondary.cy, tileH);
  return (
    `[0:v]${norm},split=2[a][b];` +
    `[a]crop=${tileW}:${tileH}:${topX}:${topY},scale=1080:960,setsar=1[top];` +
    `[b]crop=${tileW}:${tileH}:${botX}:${botY},scale=1080:960,setsar=1[bot];` +
    `[top][bot]vstack=inputs=2[v]`
  );
}

function pipFilter(norm, primary, secondary) {
  const mainW = 608;
  const insetW = 760;
  const insetH = 675;
  const mainX = cropX(primary.cx, mainW);
  const insX = cropX(secondary.cx, insetW);
  const insY = cropYForFace(secondary.cy, insetH);
  return (
    `[0:v]${norm},split=2[m][i];` +
    `[m]crop=${mainW}:1080:${mainX}:0,scale=1080:1920,setsar=1[main];` +
    `[i]crop=${insetW}:${insetH}:${insX}:${insY},scale=420:374,setsar=1[inset];` +
    `[main][inset]overlay=x=W-w-36:y=132[v]`
  );
}

function quadFilter(norm, people) {
  const tileW = 760;
  const tileH = 675;
  const filters = people.slice(0, 4).map((p, idx) => {
    const inLabel = String.fromCharCode(97 + idx);
    return `[${inLabel}]crop=${tileW}:${tileH}:${cropX(p.cx, tileW)}:${cropYForFace(p.cy, tileH)},scale=540:960,setsar=1[q${idx + 1}]`;
  });
  while (filters.length < 4) {
    const idx = filters.length;
    const inLabel = String.fromCharCode(97 + idx);
    const p = people[idx % people.length];
    filters.push(`[${inLabel}]crop=${tileW}:${tileH}:${cropX(p.cx, tileW)}:${cropYForFace(p.cy, tileH)},scale=540:960,setsar=1[q${idx + 1}]`);
  }
  return (
    `[0:v]${norm},split=4[a][b][c][d];` +
    `${filters.join(";")};` +
    `[q1][q2]hstack=inputs=2[t];[q3][q4]hstack=inputs=2[bt];[t][bt]vstack=inputs=2[v]`
  );
}

// Split-screen NATIVO: o vídeo original já é dividido esquerda/direita
// (moldura vertical no centro). Em vez de tentar "focar", preserva a
// composição: metade esquerda vira o topo 1080x960, metade direita a base.
function nativeSplitFilter(norm) {
  return (
    `[0:v]${norm},split=2[L][R];` +
    `[L]crop=960:1080:0:0,scale=1080:960,setsar=1[top];` +
    `[R]crop=960:1080:960:0,scale=1080:960,setsar=1[bot];` +
    `[top][bot]vstack=inputs=2[v]`
  );
}

// Agrega frames marcados split=true em janelas contíguas [t0,t1] com
// coverage mínima. Frames vêm com dt ~= 1/sample_fps (0.5s por padrão).
function nativeSplitWindows(track) {
  if (!track?.frames?.length) return [];
  const frames = track.frames;
  const dt = frames.length > 1 ? Math.max(0.2, frames[1].t - frames[0].t) : 0.5;
  const windows = [];
  let run = null;
  for (const f of frames) {
    if (f.split) {
      if (!run) run = { t0: f.t, t1: f.t + dt, hits: 1, total: 1 };
      else { run.t1 = f.t + dt; run.hits++; run.total++; }
    } else if (run) {
      run.total++;
      // permite 1 buraco pequeno
      if (f.t - run.t1 > dt * 1.5) {
        if (run.hits >= 3 && run.hits / run.total >= 0.6) windows.push({ t0: run.t0, t1: run.t1 });
        run = null;
      }
    }
  }
  if (run && run.hits >= 3 && run.hits / run.total >= 0.6) windows.push({ t0: run.t0, t1: run.t1 });
  return windows;
}

function sceneIsNativeSplit(windows, t0, t1) {
  if (!windows?.length) return false;
  const dur = Math.max(0.001, t1 - t0);
  let overlap = 0;
  for (const w of windows) {
    const s = Math.max(t0, w.t0);
    const e = Math.min(t1, w.t1);
    if (e > s) overlap += e - s;
  }
  return overlap / dur >= 0.6;
}



// Edição dinâmica por cena com centros de face REAIS.
// Estratégia: ignoramos os rótulos A/B do GPT (que erram na pessoa em cena)
// e escolhemos o foco pela MASSA VISUAL da janela (área × score × contagem).
// Suavizado com o foco da cena anterior pra não pipocar entre pessoas.
function buildSceneFilter(scene, i, aw, ah, speakerMap, ctx) {
  const requestedLayout = String(scene?.layout || "full");
  const norm = "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1";
  const t0 = scene.t;
  const t1 = scene.t + scene.dur;

  // 0) Composição do vídeo ORIGINAL: se a cena cai numa janela onde o
  // material já é split-screen nativo (moldura vertical no centro), NÃO
  // tenta focar em ninguém — preserva a composição original em stack.
  if (aw === 1080 && ah === 1920 && sceneIsNativeSplit(ctx?.splitWindows, t0, t1)) {
    if (ctx) { ctx.multiCount = (ctx.multiCount ?? 0) + 1; ctx.lastWasMulti = true; ctx.prevCxRaw = null; }
    return {
      complex: true,
      layout: "stack",
      requestedLayout,
      filter: nativeSplitFilter(norm),
      nativeSplit: true,
    };
  }



  // 1) Face-driven focus (pixels normalizados 1920x1080)
  let primaryFace = null;
  let secondaryFace = null;
  let extraFaces = [];
  if (ctx?.track && ctx.track.w > 0) {
    const groups = faceGroupsInWindow(ctx.track, t0, t1, ctx.prevCxRaw, ctx.diar);
    const primaryGroup = groups?.[0];
    if (primaryGroup) {
      ctx.prevCxRaw = primaryGroup.cx;
      primaryFace = normalizedFace(primaryGroup, ctx.track);
      extraFaces = distinctFaceGroups(groups, primaryGroup, ctx.track.w, 0.26)
        .map((g) => normalizedFace(g, ctx.track))
        .filter(Boolean);
      secondaryFace = extraFaces[0] ?? null;
    }
  }

  // 2) Fallback pra mapa de colunas (quando o tracker não achou rostos)
  const fallbackCx = (id) => {
    const col = speakerMap?.[id] || speakerMap?.A || "left";
    return col === "left" ? 480 : col === "right" ? 1440 : 960;
  };
  const primary = primaryFace ?? { cx: fallbackCx(scene.focus || "A"), cy: 430, score: 1, coverage: 1 };
  const secondaryFallbackId =
    scene.inset || scene.bottom || scene.right || ((scene.focus || "A") === "A" ? "B" : "A");
  const secondary = secondaryFace ?? { cx: fallbackCx(secondaryFallbackId), cy: 430, score: 0, coverage: 0 };
  const distinctEnough = Math.abs(primary.cx - secondary.cx) >= 1920 * 0.26;
  const hasRealSecondary = Boolean(secondaryFace && distinctEnough);
  const multiRequested = ["stack", "split", "pip", "quad"].includes(requestedLayout);
  const maxMulti = Math.max(1, Math.floor((ctx?.totalScenes ?? 1) * 0.25));
  const multiBudgetLeft = (ctx?.multiCount ?? 0) < maxMulti;
  const allowMultiNow = multiRequested && hasRealSecondary && multiBudgetLeft && !ctx?.lastWasMulti && scene.dur >= 2.2;
  let layout = requestedLayout;

  // Se não existe segunda pessoa visualmente distinta, não divide a tela.
  // Full correto é melhor que stack/split duplicado ou sem contexto.
  if (layout === "broll") layout = "full";
  if (["stack", "split", "pip"].includes(layout) && !allowMultiNow) layout = "full";
  if (layout === "quad" && (!allowMultiNow || extraFaces.length < 2)) layout = "full";

  const isVert = aw === 1080 && ah === 1920;

  if (isVert) {
    if (layout === "stack" || layout === "split") {
      if (ctx) { ctx.multiCount = (ctx.multiCount ?? 0) + 1; ctx.lastWasMulti = true; }
      return {
        complex: true,
        layout,
        requestedLayout,
        filter: stackFilter(norm, primary, secondary),
      };
    }
    if (layout === "pip") {
      if (ctx) { ctx.multiCount = (ctx.multiCount ?? 0) + 1; ctx.lastWasMulti = true; }
      return {
        complex: true,
        layout,
        requestedLayout,
        filter: pipFilter(norm, primary, secondary),
      };
    }
    if (layout === "quad") {
      if (ctx) { ctx.multiCount = (ctx.multiCount ?? 0) + 1; ctx.lastWasMulti = true; }
      return {
        complex: true,
        layout,
        requestedLayout,
        filter: quadFilter(norm, [primary, ...extraFaces].slice(0, 4)),
      };
    }
    if (layout === "broll") layout = "full";
    if (ctx) ctx.lastWasMulti = false;
    // full: zoom leve alternado sobre o rosto REAL do falante dominante
    return {
      complex: false,
      layout: "full",
      requestedLayout,
      filter: fullFocusFilter(norm, primary, i),
    };
  }


  return {
    complex: false,
    layout: "full",
    requestedLayout,
    filter: `scale=iw*max(${aw}/iw\\,${ah}/ih):ih*max(${aw}/iw\\,${ah}/ih),crop=${aw}:${ah},setsar=1`,
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
    await sendCallback({ job_id, status: "processing", progress: 40, worker_id: WORKER_ID });

    // 2.5. Face tracking do clipe cortado — descobre posições REAIS dos rostos
    // pra alimentar o crop por cena (substitui as colunas 480/1440 fixas).
    const pipelineStatus = {
      face_tracker: { status: "not_run" },
      diarize: { status: "not_run" },
      reframe_plan: { status: "not_run" },
    };
    const trackerRes = await runFaceTracker(cutFile, 4);
    pipelineStatus.face_tracker = {
      status: trackerRes.status,
      stage: trackerRes.stage ?? null,
      error: trackerRes.error ?? null,
      exit_code: trackerRes.exitCode ?? null,
      stderr_tail: (trackerRes.stderr ?? trackerRes.stderrTail ?? "").slice(-800),
      frames_processed: trackerRes.data?.frames_processed ?? trackerRes.data?.frames?.length ?? 0,
      detections: trackerRes.data?.detections ?? null,
      tracks: trackerRes.data?.tracks?.length ?? 0,
      detector: trackerRes.data?.detector ?? null,
      w: trackerRes.data?.w ?? 0,
      h: trackerRes.data?.h ?? 0,
    };
    const track = trackerRes.status === "success" ? trackerRes.data : null;
    const cluster = clusterFaces(track);
    if (cluster) {
      app.log.info({ detector: track?.detector, cluster: { A: cluster.A, B: cluster.B, single: cluster.single, w: cluster.w }, samples: track?.frames?.length }, "face tracker: clusters detectados");
    } else {
      app.log.info({ detector: track?.detector, tracker_status: trackerRes.status }, "face tracker: sem clusters (fallback colunas)");
    }
    await sendCallback({ job_id, status: "processing", progress: 48, worker_id: WORKER_ID });

    // 2.6. Diarização (pyannote CPU) — descobre QUEM fala QUANDO, e amarra
    // cada speaker ao rosto que mais aparece na tela enquanto ele fala.
    // Isso é o que faz a câmera parar de apontar pra pessoa errada.
    let diar = null;
    try {
      const wavPath = path.join(jobDir, "audio.wav");
      await extractAudioForDiarize(cutFile, wavPath);
      const diarRes = await runDiarizer(wavPath);
      pipelineStatus.diarize = {
        status: diarRes.status,
        stage: diarRes.stage ?? null,
        error: diarRes.error ?? null,
        exit_code: diarRes.exitCode ?? null,
        stderr_tail: (diarRes.stderr ?? "").slice(-800),
        turns: diarRes.data?.turns?.length ?? 0,
        speakers: diarRes.data?.speakers?.length ?? 0,
      };
      const diarResult = diarRes.status === "success" ? diarRes.data : null;
      if (diarResult?.turns?.length && track?.w) {
        const speakerCentroids = computeSpeakerCentroids(track, diarResult.turns);
        diar = { turns: diarResult.turns, speakers: diarResult.speakers, speakerCentroids };
        app.log.info({
          speakers: diarResult.speakers,
          turns: diarResult.turns.length,
          centroids: Object.fromEntries(
            Object.entries(speakerCentroids).map(([k, v]) => [k, { cx: Math.round(v.cx), count: v.count }])
          ),
        }, "diarize: fala↔rosto amarrados");
      } else if (diarResult?.turns?.length) {
        diar = { turns: diarResult.turns, speakers: diarResult.speakers, speakerCentroids: {} };
      }
    } catch (err) {
      pipelineStatus.diarize = { status: "failed", stage: "extract_audio", error: err?.message ?? String(err) };
      app.log.error({ event: "DIARIZE_FAILED", stage: "extract_audio", error: err?.message }, "diarização crashou");
    }
    await sendCallback({ job_id, status: "processing", progress: 55, worker_id: WORKER_ID });

    // 2.7. Auto-Reframe v2 — plano global. Se face tracker não rodou, o plano
    // não pode existir — isso precisa ser gritado, não escondido.
    let reframePlan = null;
    if (!track) {
      pipelineStatus.reframe_plan = {
        status: "skipped",
        stage: "no_face_tracker",
        error: "face tracker não produziu dados válidos; reframe não pôde iniciar",
      };
      app.log.warn({ event: "REFRAME_PLAN_SKIPPED", reason: "no_tracker" }, "reframe: pulado por falta de tracker");
    } else if (!track.tracks?.length) {
      pipelineStatus.reframe_plan = {
        status: "skipped",
        stage: "no_persistent_tracks",
        error: "face tracker rodou mas não gerou tracks persistentes",
      };
      app.log.warn({ event: "REFRAME_PLAN_SKIPPED", reason: "no_persistent_tracks", frames: track.frames?.length ?? 0, detections: track.detections ?? null }, "reframe: sem tracks persistentes");
    } else {
      try {
        reframePlan = buildReframePlan({ track, turns: diar?.turns || [], log: app.log });
        pipelineStatus.reframe_plan = {
          status: "success",
          samples: reframePlan?.cameraPath?.length ?? 0,
          links: Object.keys(reframePlan?.speakerLinks ?? {}).length,
        };
      } catch (err) {
        pipelineStatus.reframe_plan = { status: "failed", stage: "build", error: err?.message ?? String(err) };
        app.log.error({ event: "REFRAME_PLAN_FAILED", error: err?.message }, "reframe plan crashou");
      }
    }

    const reframeOk = pipelineStatus.reframe_plan.status === "success" && !!reframePlan;
    app.log.info(
      { event: "PIPELINE_STATUS", pipelineStatus, reframe_ok: reframeOk },
      "pipeline status snapshot",
    );

    // Sprint 1a — Modo Diagnóstico: emite artefatos sobre o pipeline atual.
    // NÃO modifica decisões. Só observa. Ver worker/DEBUG.md.
    if (edl?.debug?.enabled && edl?.debug?.upload_base) {
      try {
        await emitDebugArtifacts({
          jobId: job_id,
          uploadBase: edl.debug.upload_base,
          workerLog: app.log,
          track,
          turns: diar?.turns || [],
          speakers: diar?.speakers || [],
          reframePlan,
          pipelineStatus,
          clipStart: start,
          clipEnd: end,
          duration,
          version: WORKER_VERSION,
        });
      } catch (err) {
        app.log.warn({ err: err?.message }, "debug artifacts: falha (segue normalmente)");
      }
    }

    // Guarda pra usar no callback final.
    job.__pipelineStatus = pipelineStatus;
    job.__reframeOk = reframeOk;


    // 3. Reframe DINÂMICO por cena: cada cena do scene_plan vira um subclip
    // com layout/foco/zoom próprio, depois concatenamos. Sem plano, gera uma
    // cadência automática alternando full/broll com zoom para dar vida.
    const aspect = edl.output.aspect_ratio ?? "9:16";
    const [aw, ah] = aspect === "9:16" ? [1080, 1920] : aspect === "1:1" ? [1080, 1080] : [1920, 1080];
    const speakerMap = speakerColumnMap(edl);
    const splitWindows = nativeSplitWindows(track);
    if (splitWindows.length) {
      app.log.info({ windows: splitWindows.map((w) => ({ t0: +w.t0.toFixed(2), t1: +w.t1.toFixed(2) })) }, "split-screen nativo detectado no material original");
    }
    const sceneCtx = { track, cluster, diar, splitWindows, totalScenes: 1, multiCount: 0, lastWasMulti: false, plan: reframePlan };


    let plannedScenes = Array.isArray(edl.scene_plan?.scenes) ? edl.scene_plan.scenes : [];
    plannedScenes = plannedScenes
      .map((s) => ({
        t: Math.max(0, Number(s?.t) || 0),
        dur: Math.max(0.4, Number(s?.dur) || 0),
        layout: s?.layout,
        focus: s?.focus,
        left: s?.left,
        right: s?.right,
        top: s?.top,
        bottom: s?.bottom,
        inset: s?.inset,
      }))
      .filter((s) => s.t < duration)
      .map((s) => ({ ...s, dur: Math.min(s.dur, Math.max(0.4, duration - s.t)) }))
      .sort((a, b) => a.t - b.t);

    if (plannedScenes.length === 0) {
      // Cadência automática: cenas de ~3.5s alternando full (foco A/B) e broll
      const step = 3.5;
      let t = 0;
      let i = 0;
      while (t < duration) {
        const d = Math.min(step, duration - t);
        const mode = i % 4;
        plannedScenes.push({
          t,
          dur: d,
          layout: mode === 3 ? "broll" : "full",
          focus: mode % 2 === 0 ? "A" : "B",
        });
        t += d;
        i++;
      }
    }
    sceneCtx.totalScenes = plannedScenes.length;

    const sceneFiles = [];
    for (let i = 0; i < plannedScenes.length; i++) {
      const sc = plannedScenes[i];
      const t0 = sc.t, t1 = sc.t + sc.dur;
      const encArgs = [
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-c:a", "aac", "-b:a", "128k", "-ar", "48000",
        "-r", "30", "-pix_fmt", "yuv420p",
      ];

      // Plan-driven render (auto-reframe v2) — só para 9:16 e quando o plano existe
      // e a cena não cai em split-screen nativo (esse caminho preserva a composição).
      const useNativeSplit = aw === 1080 && ah === 1920 && sceneIsNativeSplit(sceneCtx.splitWindows, t0, t1);
      let planned = false;
      if (reframePlan && aw === 1080 && ah === 1920 && !useNativeSplit) {
        try {
          const samples = reframePlan.sliceRange(t0, t1).filter((s) => s.cam);
          if (samples.length >= 2) {
            // Agrupa amostras adjacentes com câmera quase constante
            const THRESH_X = reframePlan.frameW * 0.012;
            const THRESH_W = reframePlan.frameW * 0.02;
            const groups = [];
            for (const s of samples) {
              const last = groups[groups.length - 1];
              const dt = 0.1;
              if (!last) { groups.push({ tStart: s.t, tEnd: s.t + dt, cam: { ...s.cam }, trackId: s.trackId, reason: s.reason }); continue; }
              const dX = Math.abs(s.cam.sliceX - last.cam.sliceX);
              const dW = Math.abs(s.cam.sliceW - last.cam.sliceW);
              const same = dX < THRESH_X && dW < THRESH_W && s.trackId === last.trackId;
              if (same) {
                last.tEnd = s.t + dt;
                // média incremental — deriva suave da câmera dentro do grupo
                last.cam.sliceX = (last.cam.sliceX + s.cam.sliceX) / 2;
                last.cam.sliceY = (last.cam.sliceY + s.cam.sliceY) / 2;
                last.cam.sliceW = (last.cam.sliceW + s.cam.sliceW) / 2;
                last.cam.sliceH = (last.cam.sliceH + s.cam.sliceH) / 2;
              } else {
                groups.push({ tStart: s.t, tEnd: s.t + dt, cam: { ...s.cam }, trackId: s.trackId, reason: s.reason });
              }
            }
            groups[0].tStart = t0;
            groups[groups.length - 1].tEnd = t1;

            let k = 0;
            for (const g of groups) {
              const dur = Math.max(0.15, g.tEnd - g.tStart);
              const seg = path.join(jobDir, `scene-${String(i).padStart(3, "0")}-${String(k).padStart(2, "0")}.mp4`);
              const sw = Math.max(64, Math.min(reframePlan.frameW, Math.round(g.cam.sliceW)));
              const sh_ = Math.max(64, Math.min(reframePlan.frameH, Math.round(g.cam.sliceH)));
              const sx = Math.max(0, Math.min(reframePlan.frameW - sw, Math.round(g.cam.sliceX)));
              const sy = Math.max(0, Math.min(reframePlan.frameH - sh_, Math.round(g.cam.sliceY)));
              const vf = `crop=${sw}:${sh_}:${sx}:${sy},scale=1080:1920,setsar=1`;
              await sh("ffmpeg", ["-y", "-ss", g.tStart.toFixed(3), "-i", cutFile, "-t", dur.toFixed(3), "-vf", vf, ...encArgs, seg]);
              sceneFiles.push(seg);
              k++;
            }
            app.log.info({ scene: i, t0: +t0.toFixed(2), t1: +t1.toFixed(2), micro_segments: groups.length, trackIds: [...new Set(groups.map((g) => g.trackId))] }, "reframe v2: plano aplicado");
            planned = true;
          }
        } catch (err) {
          app.log.warn({ err: err?.message, scene: i }, "reframe plan render falhou, caindo pro legado");
        }
      }

      if (planned) continue;

      // Legacy path: buildSceneFilter (split nativo / stack / pip / full estático)
      const vf = buildSceneFilter(sc, i, aw, ah, speakerMap, sceneCtx);
      if (vf.requestedLayout && vf.layout && vf.requestedLayout !== vf.layout) {
        app.log.info({ scene: i, from: vf.requestedLayout, to: vf.layout }, "layout dividido bloqueado: sem pessoas distintas suficientes");
      }
      const sceneFile = path.join(jobDir, `scene-${String(i).padStart(3, "0")}.mp4`);
      const baseArgs = ["-y", "-ss", String(sc.t.toFixed(3)), "-i", cutFile, "-t", String(sc.dur.toFixed(3))];
      const encArgsFile = [...encArgs, sceneFile];
      try {
        if (vf.complex) {
          await sh("ffmpeg", [
            ...baseArgs,
            "-filter_complex", vf.filter,
            "-map", "[v]", "-map", "0:a?",
            ...encArgsFile,
          ]);
        } else {
          await sh("ffmpeg", [...baseArgs, "-vf", vf.filter, ...encArgsFile]);
        }
        sceneFiles.push(sceneFile);
      } catch (err) {
        app.log.warn({ err: err?.message, scene: i, layout: sc.layout }, "cena falhou, caindo pra full");
        let fCx = 480;
        if (track?.w) {
          const raw = pickFocusCx(track, sc.t, sc.t + sc.dur, sceneCtx.prevCxRaw, sceneCtx.diar);
          if (raw?.cx != null) fCx = Math.round((raw.cx / track.w) * 1920);
        } else {
          const fCol = speakerMap[sc.focus] || "left";
          fCx = fCol === "left" ? 480 : fCol === "right" ? 1440 : 960;
        }
        const fallback = `scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,crop=608:1080:${Math.max(0, Math.min(1312, fCx - 304))}:0,scale=1080:1920,setsar=1`;
        await sh("ffmpeg", [...baseArgs, "-vf", fallback, ...encArgsFile]);
        sceneFiles.push(sceneFile);
      }
    }

    const concatList = path.join(jobDir, "concat.txt");
    await writeFile(
      concatList,
      sceneFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"),
      "utf8",
    );
    const framedFile = path.join(jobDir, "framed.mp4");
    await sh("ffmpeg", [
      "-y", "-f", "concat", "-safe", "0", "-i", concatList,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
      "-c:a", "aac", "-b:a", "128k",
      "-movflags", "+faststart",
      framedFile,
    ]);
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
app.get("/", async () => ({ ok: true, service: "clipfy-render-worker", version: WORKER_VERSION }));
app.get("/health", async () => ({
  ok: true,
  version: WORKER_VERSION,
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
