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

// -------------------- fila em memória --------------------
const queue = [];
let running = 0;
const MAX = Math.max(1, parseInt(CONCURRENCY, 10));
let bgutilStarted = false;

// -------------------- callback assinado --------------------
async function callback(payload, targetUrl = `${APP_URL}/api/public/render-callback`) {
  const body = JSON.stringify(payload);
  const signature = createHmac("sha256", RENDER_WORKER_SECRET).update(body).digest("hex");
  try {
    const res = await undiciRequest(targetUrl,
      {
      method: "POST",
      headers: { "content-type": "application/json", "x-render-signature": signature },
      body,
      headersTimeout: 15000,
      bodyTimeout: 15000,
    });
    if (res.statusCode >= 300) {
      const txt = await res.body.text();
      app.log.error({ status: res.statusCode, txt }, "callback falhou");
    }
  } catch (err) {
    app.log.error({ err }, "callback network erro");
  }
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
  { name: "android", extractor: "youtube:player_client=android" },
  { name: "ios", extractor: "youtube:player_client=ios" },
  { name: "mweb", extractor: "youtube:player_client=mweb" },
  { name: "web_safari", extractor: "youtube:player_client=web_safari" },
  { name: "tv_embedded", extractor: "youtube:player_client=tv_embedded" },
  { name: "web_embedded", extractor: "youtube:player_client=web_embedded" },
  { name: "default", extractor: "youtube:player_client=default" },
];

// Args comuns pro yt-dlp: runtime JS explícito, cookies server-side opcionais,
// headers/retries e variações de player-client para aguentar bloqueios do YouTube.
function ytdlpCommonArgs(strategy = YTDLP_CLIENT_STRATEGIES[0]) {
  const extractorArgs = [strategy.extractor];
  if (process.env.DISABLE_BGUTIL_POT !== "1") {
    extractorArgs.push(`youtubepot-bgutilhttp:base_url=http://127.0.0.1:${BGUTIL_PROVIDER_PORT}`);
  }

  const args = [
    ...ytdlpRuntimeArgs(),
    "--retries", "3",
    "--extractor-retries", "3",
    "--fragment-retries", "3",
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

  if (process.env.YTDLP_PROXY) {
    args.push("--proxy", process.env.YTDLP_PROXY);
  }

  return args;
}

async function ytdlpWithFallback(formatArgs, outputPath, url, label) {
  let lastErr;
  for (const strategy of YTDLP_CLIENT_STRATEGIES) {
    try {
      await sh("yt-dlp", [
        ...ytdlpCommonArgs(strategy),
        ...formatArgs,
        "-o", outputPath,
        url,
      ]);
      app.log.info({ strategy: strategy.name, label }, "yt-dlp ok");
      return;
    } catch (err) {
      lastErr = err;
      app.log.warn({ strategy: strategy.name, label, err: safeErrorMessage(err) }, "yt-dlp fallback");
    }
  }

  const blocked = /confirm you.?re not a bot|cookies|sign in/i.test(safeErrorMessage(lastErr));
  const hint = blocked
    ? "YouTube bloqueou o IP do servidor. O worker já tentou Android/iOS/MWeb/Embedded; para esse vídeo/IP precisa de cookie/proxy server-side no EasyPanel, não do cliente final."
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

// Legendas .ass estilo karaokê palavra-a-palavra
function buildAssSubtitle(words, opts) {
  const { template = "hormozi-slam", position = "bottom", aspect = "9:16" } = opts;
  const [w, h] = aspect === "9:16" ? [1080, 1920] : aspect === "1:1" ? [1080, 1080] : [1920, 1080];

  // Presets por template
  const presets = {
    "hormozi-slam":  { font: "DejaVu Sans", size: 96, primary: "&H00FFFFFF", outline: "&H00000000", back: "&H00000000", bold: 1, borderStyle: 1, outlineW: 6, shadow: 2, marginV: 220 },
    "neon-pulse":    { font: "DejaVu Sans", size: 84, primary: "&H00FFFFFF", outline: "&H00FF00FF", back: "&H00000000", bold: 1, borderStyle: 1, outlineW: 4, shadow: 0, marginV: 260 },
    "tiktok-chip":   { font: "DejaVu Sans", size: 72, primary: "&H00FFFFFF", outline: "&H00000000", back: "&H99000000", bold: 1, borderStyle: 3, outlineW: 8, shadow: 0, marginV: 300 },
    "minimal-clean": { font: "DejaVu Sans", size: 68, primary: "&H00FFFFFF", outline: "&H00000000", back: "&H00000000", bold: 0, borderStyle: 1, outlineW: 3, shadow: 0, marginV: 200 },
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
Style: Def,${s.font},${s.size},${s.primary},&H000000FF,${s.outline},${s.back},${s.bold},0,0,0,100,100,0,0,${s.borderStyle},${s.outlineW},${s.shadow},${alignment},60,60,${s.marginV},1
Style: Hi,${s.font},${s.size},&H0000FFFF,&H000000FF,${s.outline},${s.back},1,0,0,0,110,110,0,0,${s.borderStyle},${s.outlineW},${s.shadow},${alignment},60,60,${s.marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const fmt = (t) => {
    const H = Math.floor(t / 3600);
    const M = Math.floor((t % 3600) / 60);
    const S = (t % 60).toFixed(2).padStart(5, "0");
    return `${H}:${String(M).padStart(2, "0")}:${S}`;
  };

  // Agrupa palavras em "linhas" de ~3-5 palavras
  const lines = [];
  let group = [];
  for (const wd of words) {
    group.push(wd);
    if (group.length >= 4 || (wd.word || "").match(/[.!?]$/)) {
      lines.push(group);
      group = [];
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

  // Extrai áudio (mono 16k) pra reduzir tamanho e acelerar
  const audio = sourceFile.replace(/\.[^.]+$/, ".wav");
  await sh("ffmpeg", ["-y", "-i", sourceFile, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", audio]);

  const tr = await groq.audio.transcriptions.create({
    file: createReadStream(audio),
    model: "whisper-large-v3-turbo",
    response_format: "verbose_json",
    timestamp_granularities: ["word"],
    language: language && language !== "auto" ? language : undefined,
  });

  return (tr.words ?? []).map((w) => ({ word: w.word, start: w.start, end: w.end }));
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

    // 3. Reframe aspect ratio (crop centralizado)
    const aspect = edl.output.aspect_ratio ?? "9:16";
    const [aw, ah] = aspect === "9:16" ? [1080, 1920] : aspect === "1:1" ? [1080, 1080] : [1920, 1080];
    const framedFile = path.join(jobDir, "framed.mp4");
    const vf = `scale=iw*max(${aw}/iw\\,${ah}/ih):ih*max(${aw}/iw\\,${ah}/ih),crop=${aw}:${ah}`;
    await sh("ffmpeg", ["-y", "-i", cutFile, "-vf", vf, "-c:a", "copy", framedFile]);
    await sendCallback({ job_id, status: "processing", progress: 60, worker_id: WORKER_ID });

    // 4. Legendas (Groq se preciso, converte para timeline do trecho)
    const rawWords = await transcribeIfNeeded(framedFile, edl.captions?.segments, edl.captions?.language);
    // Se palavras vêm do transcript global, elas usam timestamp global — reajusta pro corte
    const words = rawWords
      .map((w) => ({ word: w.word, start: w.start - start, end: w.end - start }))
      .filter((w) => w.end > 0 && w.start < duration)
      .map((w) => ({ word: w.word, start: Math.max(0, w.start), end: Math.min(duration, w.end) }));

    const assFile = path.join(jobDir, "subs.ass");
    if (words.length > 0) {
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
    if (words.length > 0) {
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
app.get("/", async () => ({ ok: true, service: "clipfy-render-worker" }));
app.get("/health", async () => ({ ok: true, running, queued: queue.length, worker_id: WORKER_ID }));

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
  const { job_id, source_url, language, callback_url } = job;
  const jobDir = path.join(WORK_DIR, `t-${job_id}`);
  await mkdir(jobDir, { recursive: true });
  const cb = (payload) => callback({ job_id, worker_id: WORKER_ID, ...payload }, callback_url);

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

    const wav = path.join(jobDir, "audio.wav");
    await sh("ffmpeg", ["-y", "-i", mediaFile, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav]);
    await cb({ status: "processing", progress: 60 });

    const duration = await ffprobeDuration(wav).catch(() => null);

    const tr = await groq.audio.transcriptions.create({
      file: createReadStream(wav),
      model: "whisper-large-v3-turbo",
      response_format: "verbose_json",
      timestamp_granularities: ["segment", "word"],
      language: language && language !== "auto" ? language : undefined,
    });

    // Constrói segmentos com palavras para karaokê
    const words = (tr.words ?? []).map((w) => ({ word: w.word, start: w.start, end: w.end }));
    const segments = (tr.segments ?? []).map((s) => ({
      text: String(s.text ?? "").trim(),
      start: Number(s.start ?? 0),
      end: Number(s.end ?? 0),
      words: words.filter((w) => w.start >= s.start && w.end <= s.end + 0.05),
    }));

    await cb({
      status: "completed",
      progress: 100,
      language: tr.language ?? language ?? null,
      duration,
      full_text: String(tr.text ?? "").trim(),
      segments,
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
  const { job_id, source_url, language, callback_url } = req.body ?? {};
  if (!job_id || !source_url) return reply.code(400).send({ error: "job_id e source_url obrigatórios" });
  // Executa em background — callback assíncrono via HMAC
  processTranscribeJob({ job_id, source_url, language, callback_url }).catch((err) =>
    app.log.error({ err, job_id }, "transcribe crash"),
  );
  return { accepted: true };
});

// Bootstrap
await mkdir(WORK_DIR, { recursive: true });
app.listen({ host: "0.0.0.0", port: parseInt(PORT, 10) }).then(() => {
  app.log.info(`clipfy worker rodando na porta ${PORT}`);
});
