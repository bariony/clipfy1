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

export async function fetchYoutubeTranscript(sourceUrl: string): Promise<YoutubeTranscriptResult> {
  const videoId = extractYoutubeVideoId(sourceUrl);
  if (!videoId) throw new Error("URL do YouTube inválida.");

  const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=pt&persist_hl=1`;
  const page = await fetch(watchUrl, {
    headers: {
      "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
    },
  });
  if (!page.ok) throw new Error(`Não consegui abrir o vídeo do YouTube (${page.status}).`);

  const html = await page.text();
  const playerJson = extractBalancedJson(html, "ytInitialPlayerResponse");
  if (!playerJson) throw new Error("Não consegui ler os dados do vídeo no YouTube.");

  const player = JSON.parse(playerJson) as {
    videoDetails?: { lengthSeconds?: string };
    captions?: {
      playerCaptionsTracklistRenderer?: {
        captionTracks?: CaptionTrack[];
      };
    };
  };

  const tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  if (tracks.length === 0) {
    throw new Error(
      "Esse vídeo não tem legendas públicas disponíveis. Envie o arquivo do vídeo para transcrever direto.",
    );
  }

  const preferredTrack = chooseCaptionTrack(tracks);
  if (!preferredTrack?.baseUrl) throw new Error("Não encontrei uma faixa de legenda utilizável para esse vídeo.");

  const captionUrl = withQueryParam(preferredTrack.baseUrl, "fmt", "json3");
  const captions = await fetch(captionUrl, {
    headers: {
      "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
    },
  });
  if (!captions.ok) throw new Error(`Não consegui baixar as legendas do YouTube (${captions.status}).`);

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