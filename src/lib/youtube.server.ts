type Json3Event = {
  tStartMs?: number;
  dDurationMs?: number;
  segs?: Array<{ utf8?: string }>;
};

type CaptionTrack = {
  baseUrl?: string;
  languageCode?: string;
  name?: { simpleText?: string; runs?: Array<{ text?: string }> };
  kind?: string;
};

export type TranscriptSegment = {
  text: string;
  start: number;
  end: number;
};

export type YoutubeTranscriptResult = {
  text: string;
  language: string | null;
  duration: number | null;
  segments: TranscriptSegment[];
};

const YT_UPLOAD_HINT =
  "O YouTube bloqueou temporariamente essa requisição. Tente novamente em alguns minutos ou envie o arquivo do vídeo pelo upload.";

const BROWSER_HEADERS = {
  "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
} as const;

async function fetchWithRetry(url: string, init?: RequestInit, attempts = 3): Promise<Response> {
  let lastStatus = 0;
  for (let i = 0; i < attempts; i += 1) {
    const res = await fetch(url, init);
    if (res.ok) return res;
    lastStatus = res.status;
    if (res.status !== 429 && res.status < 500) return res;
    await new Promise((r) => setTimeout(r, 400 * (i + 1) + Math.random() * 300));
  }
  const err = new Error(`__yt_status_${lastStatus}`);
  (err as Error & { status?: number }).status = lastStatus;
  throw err;
}

async function fetchPlayerViaInnertube(videoId: string) {
  const res = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    headers: {
      ...BROWSER_HEADERS,
      "content-type": "application/json",
      "x-youtube-client-name": "1",
      "x-youtube-client-version": "2.20240101.00.00",
      origin: "https://www.youtube.com",
      referer: `https://www.youtube.com/watch?v=${videoId}`,
    },
    body: JSON.stringify({
      videoId,
      context: {
        client: {
          clientName: "WEB",
          clientVersion: "2.20240101.00.00",
          hl: "pt",
          gl: "BR",
        },
      },
    }),
  });
  if (!res.ok) {
    const err = new Error(`__yt_status_${res.status}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return (await res.json()) as {
    videoDetails?: { lengthSeconds?: string };
    captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } };
  };
}

export async function fetchYoutubeTranscript(sourceUrl: string): Promise<YoutubeTranscriptResult> {
  const videoId = extractYoutubeVideoId(sourceUrl);
  if (!videoId) throw new Error("URL do YouTube inválida.");

  let player: {
    videoDetails?: { lengthSeconds?: string };
    captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } };
  } | null = null;

  // Try HTML scrape first (with retry), then fall back to innertube JSON API.
  try {
    const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=pt&persist_hl=1`;
    const page = await fetchWithRetry(watchUrl, { headers: BROWSER_HEADERS });
    if (!page.ok) throw new Error(`__yt_status_${page.status}`);
    const html = await page.text();
    const playerJson = extractBalancedJson(html, "ytInitialPlayerResponse");
    if (playerJson) player = JSON.parse(playerJson);
  } catch {
    // fall through to innertube
  }

  if (!player) {
    try {
      player = await fetchPlayerViaInnertube(videoId);
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      if (status === 429) throw new Error(YT_UPLOAD_HINT);
      throw new Error("Não consegui abrir o vídeo do YouTube. Tente novamente ou envie o arquivo.");
    }
  }

  const tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  if (tracks.length === 0) {
    throw new Error(
      "Esse vídeo não tem legendas públicas disponíveis. Envie o arquivo do vídeo para transcrever direto.",
    );
  }

  const preferredTrack = chooseCaptionTrack(tracks);
  if (!preferredTrack?.baseUrl) throw new Error("Não encontrei uma faixa de legenda utilizável para esse vídeo.");

  const captionUrl = withQueryParam(preferredTrack.baseUrl, "fmt", "json3");
  const captions = await fetchWithRetry(captionUrl, { headers: BROWSER_HEADERS }).catch((err: Error & { status?: number }) => {
    if (err.status === 429) throw new Error(YT_UPLOAD_HINT);
    throw new Error(`Não consegui baixar as legendas do YouTube (${err.status ?? "erro"}).`);
  });
  if (!captions.ok) {
    if (captions.status === 429) throw new Error(YT_UPLOAD_HINT);
    throw new Error(`Não consegui baixar as legendas do YouTube (${captions.status}).`);
  }

  const payload = (await captions.json()) as { events?: Json3Event[] };
  const segments = (payload.events ?? [])
    .map((event) => {
      const text = (event.segs ?? [])
        .map((segment) => segment.utf8 ?? "")
        .join("")
        .replace(/\s+/g, " ")
        .trim();
      const start = Math.max(0, (event.tStartMs ?? 0) / 1000);
      const end = Math.max(start + 1, start + ((event.dDurationMs ?? 2500) / 1000));
      return { text, start, end };
    })
    .filter((segment) => segment.text.length > 0);

  const text = segments.map((segment) => segment.text).join(" ").replace(/\s+/g, " ").trim();
  if (!text) throw new Error("As legendas do YouTube vieram vazias.");

  const duration = Number(player.videoDetails?.lengthSeconds || 0);
  return {
    text,
    language: preferredTrack.languageCode ?? null,
    duration: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
    segments,
  };
}

function extractYoutubeVideoId(value: string) {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.replace(/^www\./, "");
    if (host === "youtu.be") return url.pathname.split("/").filter(Boolean)[0] ?? "";
    if (["youtube.com", "m.youtube.com", "music.youtube.com"].includes(host)) {
      if (url.pathname === "/watch") return url.searchParams.get("v") ?? "";
      const parts = url.pathname.split("/").filter(Boolean);
      if (["shorts", "embed", "live"].includes(parts[0])) return parts[1] ?? "";
    }
  } catch {
    return "";
  }
  return "";
}

function chooseCaptionTrack(tracks: CaptionTrack[]) {
  const manual = tracks.filter((track) => track.kind !== "asr");
  const candidates = manual.length > 0 ? manual : tracks;
  return (
    candidates.find((track) => track.languageCode?.toLowerCase().startsWith("pt")) ??
    candidates.find((track) => track.languageCode?.toLowerCase().startsWith("en")) ??
    candidates[0]
  );
}

function withQueryParam(rawUrl: string, key: string, value: string) {
  const url = new URL(rawUrl);
  url.searchParams.set(key, value);
  return url.toString();
}

function extractBalancedJson(source: string, marker: string) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return "";
  const start = source.indexOf("{", markerIndex);
  if (start < 0) return "";

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }

  return "";
}