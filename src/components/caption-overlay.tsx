import { cn } from "@/lib/utils";
import type { CaptionStyle, Word } from "@/lib/caption-templates";

export function CaptionOverlay({
  words,
  currentTime,
  style,
}: {
  words: Word[];
  currentTime: number;
  style: CaptionStyle;
}) {
  if (style.slug === "none" || words.length === 0) return null;
  const activeIdx = words.findIndex((w) => currentTime >= w.start && currentTime <= w.end);
  const idx = activeIdx >= 0 ? activeIdx : 0;
  const start = Math.max(0, idx - 2);
  const windowWords = words.slice(start, start + 6);

  return (
    <div className={cn("pointer-events-none absolute inset-x-0 flex justify-center px-5", style.container)}>
      <div className={cn("flex max-w-[88%] flex-wrap justify-center gap-x-1.5 gap-y-1.5 text-center [overflow-wrap:anywhere]", style.wrap)}>
        {windowWords.map((w, i) => {
          const globalIdx = start + i;
          const isActive = globalIdx === activeIdx;
          return (
            <span
              key={`${globalIdx}-${isActive ? `A${activeIdx}` : "i"}`}
              className={cn(
                "inline-block will-change-transform",
                isActive ? style.highlight : style.base,
                isActive && style.animation,
              )}
            >
              {w.text}
            </span>
          );
        })}
      </div>
    </div>
  );
}
