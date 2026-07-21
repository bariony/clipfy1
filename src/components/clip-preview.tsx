import { useEffect, useMemo, useRef, useState } from "react";
import { Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { CaptionOverlay } from "@/components/caption-overlay";
import { getCaptionTemplate, segmentsToWords, type Word } from "@/lib/caption-templates";
import type { TranscriptSegment } from "@/lib/projects";

type Props = {
  source: "upload" | "youtube";
  videoUrl: string | null; // signed url for upload
  youtubeUrl: string | null;
  startSeconds: number;
  endSeconds: number;
  segments: TranscriptSegment[];
  templateSlug: string;
  aspectClass?: string;
  autoPlayOnHover?: boolean;
  showPlayButton?: boolean;
  controlledPlaying?: boolean; // for editor mode
  onTimeUpdate?: (t: number) => void;
  className?: string;
  /**
   * Quando presente, o preview reproduz o MP4 final renderizado
   * (com legenda/cortes já embutidos) — sem overlay de captions.
   */
  renderedUrl?: string | null;
};

export function ClipPreview({
  source,
  videoUrl,
  youtubeUrl,
  startSeconds,
  endSeconds,
  segments,
  templateSlug,
  aspectClass = "aspect-[9/16]",
  autoPlayOnHover = false,
  showPlayButton = true,
  controlledPlaying,
  onTimeUpdate,
  className,
  renderedUrl,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hovering, setHovering] = useState(false);
  const [currentTime, setCurrentTime] = useState(startSeconds);
  const [ytKey, setYtKey] = useState(0);

  const template = getCaptionTemplate(templateSlug);
  const words = useMemo<Word[]>(
    () => segmentsToWords(segments, startSeconds, endSeconds),
    [segments, startSeconds, endSeconds],
  );

  // Upload playback
  useEffect(() => {
    const v = videoRef.current;
    if (!v || source !== "upload") return;
    const onTime = () => {
      setCurrentTime(v.currentTime);
      onTimeUpdate?.(v.currentTime);
      if (v.currentTime >= endSeconds) {
        v.currentTime = startSeconds;
        if (!autoPlayOnHover || !hovering) v.pause();
      }
    };
    v.addEventListener("timeupdate", onTime);
    return () => v.removeEventListener("timeupdate", onTime);
  }, [source, startSeconds, endSeconds, autoPlayOnHover, hovering, onTimeUpdate]);

  // Autoplay-on-hover for upload
  useEffect(() => {
    if (!autoPlayOnHover || source !== "upload") return;
    const v = videoRef.current;
    if (!v) return;
    if (hovering) {
      if (v.currentTime < startSeconds || v.currentTime >= endSeconds) v.currentTime = startSeconds;
      v.play().catch(() => {});
    } else {
      v.pause();
      v.currentTime = startSeconds;
      setCurrentTime(startSeconds);
    }
  }, [hovering, autoPlayOnHover, source, startSeconds, endSeconds]);

  // Controlled play from parent (editor)
  useEffect(() => {
    if (source !== "upload" || controlledPlaying === undefined) return;
    const v = videoRef.current;
    if (!v) return;
    if (controlledPlaying) {
      if (v.currentTime < startSeconds || v.currentTime >= endSeconds) v.currentTime = startSeconds;
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, [controlledPlaying, source, startSeconds, endSeconds]);

  // For YouTube, we simulate a timer while "hovering" so captions play
  useEffect(() => {
    if (source !== "youtube") return;
    if (!autoPlayOnHover) return;
    if (!hovering) {
      setCurrentTime(startSeconds);
      setYtKey((k) => k + 1); // remount to restart embed
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const elapsed = (now - t0) / 1000;
      const t = startSeconds + (elapsed % Math.max(0.5, endSeconds - startSeconds));
      setCurrentTime(t);
      onTimeUpdate?.(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [hovering, autoPlayOnHover, source, startSeconds, endSeconds, onTimeUpdate]);

  const ytEmbed = useMemo(() => {
    if (!youtubeUrl) return null;
    try {
      const u = new URL(youtubeUrl);
      const id = u.hostname.includes("youtu.be") ? u.pathname.slice(1) : u.searchParams.get("v");
      if (!id) return null;
      const start = Math.floor(startSeconds);
      const end = Math.ceil(endSeconds);
      const autoplay = autoPlayOnHover && hovering ? 1 : 0;
      return `https://www.youtube-nocookie.com/embed/${id}?start=${start}&end=${end}&autoplay=${autoplay}&mute=1&controls=${autoPlayOnHover ? 0 : 1}&modestbranding=1&playsinline=1&rel=0&loop=1&playlist=${id}`;
    } catch {
      return null;
    }
  }, [youtubeUrl, startSeconds, endSeconds, autoPlayOnHover, hovering]);

  const showIdlePoster = source === "upload" ? !hovering && autoPlayOnHover : false;

  // Modo "final render": exibe o MP4 já processado (legenda/edição embutidas).
  if (renderedUrl) {
    return (
      <div
        onMouseEnter={() => autoPlayOnHover && setHovering(true)}
        onMouseLeave={() => autoPlayOnHover && setHovering(false)}
        className={cn(
          "relative w-full overflow-hidden rounded-xl border border-border bg-black",
          aspectClass,
          className,
        )}
      >
        <video
          src={renderedUrl}
          className="h-full w-full object-cover"
          playsInline
          muted
          loop
          preload="metadata"
          autoPlay={autoPlayOnHover && hovering}
          controls={!autoPlayOnHover}
          ref={(el) => {
            if (!el || !autoPlayOnHover) return;
            if (hovering) el.play().catch(() => {});
            else {
              el.pause();
              el.currentTime = 0;
            }
          }}
        />
        {showPlayButton && autoPlayOnHover && !hovering && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <span className="grid size-12 place-items-center rounded-full bg-black/60 backdrop-blur">
              <Play className="ml-0.5 size-6 text-white" />
            </span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      onMouseEnter={() => autoPlayOnHover && setHovering(true)}
      onMouseLeave={() => autoPlayOnHover && setHovering(false)}
      className={cn(
        "relative w-full overflow-hidden rounded-xl border border-border bg-black",
        aspectClass,
        className,
      )}
    >
      {source === "upload" ? (
        videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            className="h-full w-full object-cover"
            playsInline
            muted
            preload="metadata"
            onLoadedMetadata={(e) => {
              e.currentTarget.currentTime = startSeconds;
            }}
          />
        ) : (
          <div className="grid h-full place-items-center text-xs text-muted-foreground">Sem vídeo</div>
        )
      ) : ytEmbed ? (
        <iframe
          key={ytKey}
          src={ytEmbed}
          title="Preview"
          className="h-full w-full"
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
        />
      ) : (
        <div className="grid h-full place-items-center text-xs text-muted-foreground">URL inválida</div>
      )}

      <CaptionOverlay words={words} currentTime={currentTime} style={template} />

      {showPlayButton && showIdlePoster && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="grid size-12 place-items-center rounded-full bg-black/60 backdrop-blur">
            <Play className="ml-0.5 size-6 text-white" />
          </span>
        </div>
      )}
    </div>
  );
}
