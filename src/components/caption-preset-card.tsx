import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CaptionStyle } from "@/lib/caption-templates";

type Props = {
  template: CaptionStyle;
  selected: boolean;
  onSelect: () => void;
};

/**
 * Opus-style caption preset card.
 * Renders the template's sample phrase with a real word-by-word looping animation
 * so the user sees the actual look before choosing.
 */
export function CaptionPresetCard({ template, selected, onSelect }: Props) {
  const words = (template.sample ?? template.name).trim().split(/\s+/).filter(Boolean);
  const [activeIdx, setActiveIdx] = useState(0);
  const [animKey, setAnimKey] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveIdx((i) => (i + 1) % words.length);
      setAnimKey((k) => k + 1);
    }, 700);
    return () => clearInterval(interval);
  }, [words.length]);

  const wrapSize = "text-[13px] sm:text-sm font-black uppercase tracking-tight leading-[1.1]";

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-xl border text-left transition-all",
        selected
          ? "border-primary ring-2 ring-primary/40"
          : "border-border hover:border-primary/50 hover:-translate-y-0.5",
      )}
    >
      {template.badge && (
        <span
          className={cn(
            "absolute right-2 top-2 z-10 rounded-md px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider",
            template.badge === "Novo"
              ? "bg-primary text-primary-foreground"
              : "bg-yellow-400 text-black",
          )}
        >
          {template.badge}
        </span>
      )}

      {/* Preview canvas */}
      <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-gradient-to-br from-neutral-900 via-neutral-950 to-black px-3 py-2">
        {/* Faint film grain */}
        <div className="absolute inset-0 opacity-40 [background-image:radial-gradient(circle_at_30%_20%,rgba(255,255,255,.08),transparent_40%),radial-gradient(circle_at_70%_80%,rgba(255,255,255,.05),transparent_35%)]" />

        <div className={cn("relative z-10 max-w-full text-center", wrapSize, template.wrap.replace(/text-\S+|md:text-\S+|sm:text-\S+/g, ""))}>
          <span className="inline-flex flex-wrap justify-center gap-x-1 gap-y-0.5">
            {words.map((word, i) => {
              const isActive = i === activeIdx;
              return (
                <span
                  key={`${i}-${animKey}-${isActive}`}
                  className={cn(
                    "inline-block",
                    isActive ? template.highlight : template.base,
                    isActive && template.animation,
                  )}
                >
                  {word}
                </span>
              );
            })}
          </span>
        </div>

        {selected && (
          <span className="absolute bottom-2 right-2 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
            <Check className="size-3" strokeWidth={3} />
          </span>
        )}
      </div>

      {/* Meta */}
      <div className="border-t border-border bg-card px-3 py-2">
        <div className="truncate text-[12px] font-bold">{template.name}</div>
        <div className="mt-0.5 truncate text-[10px] leading-tight text-muted-foreground">
          {template.description}
        </div>
      </div>
    </button>
  );
}
