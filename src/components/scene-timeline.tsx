import { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  LAYOUT_COLOR,
  LAYOUT_LABEL,
  type ScenePlan,
  type SceneStep,
} from "@/lib/scene-plan";

type Props = {
  plan: ScenePlan;
  duration: number;
  currentTime?: number;
  onSceneClick?: (index: number, scene: SceneStep) => void;
  activeIndex?: number | null;
};

/**
 * Timeline horizontal do plano de cenas dinâmicas.
 * Cada barra colorida = uma cena com layout específico.
 * Playhead segue currentTime.
 */
export function SceneTimeline({
  plan,
  duration,
  currentTime = 0,
  onSceneClick,
  activeIndex,
}: Props) {
  const total = Math.max(1, duration);
  const scenes = plan.scenes;

  const playheadPct = useMemo(() => {
    const t = Math.max(0, Math.min(currentTime, total));
    return (t / total) * 100;
  }, [currentTime, total]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-primary">
          <span>// scene plan</span>
          <span className="rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-primary">
            {scenes.length} cena{scenes.length === 1 ? "" : "s"}
          </span>
          <span className="rounded-full border border-border bg-card/40 px-1.5 py-0.5 text-muted-foreground">
            {plan.speakers.length} falante{plan.speakers.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      {/* Barra */}
      <div className="relative h-9 w-full overflow-hidden rounded-lg border border-border bg-black/40">
        {scenes.map((s, i) => {
          const left = (s.t / total) * 100;
          const width = (s.dur / total) * 100;
          const active = activeIndex === i;
          return (
            <button
              key={`${s.t}-${i}`}
              type="button"
              onClick={() => onSceneClick?.(i, s)}
              className={cn(
                "absolute top-0 h-full border-r border-black/40 text-[9px] font-bold uppercase tracking-wider text-white/95 transition-all",
                LAYOUT_COLOR[s.layout],
                active ? "ring-2 ring-inset ring-white" : "hover:brightness-125",
              )}
              style={{ left: `${left}%`, width: `${Math.max(0.5, width)}%` }}
              title={`${LAYOUT_LABEL[s.layout]} · ${s.dur.toFixed(1)}s${s.beat ? ` · ${s.beat}` : ""}`}
            >
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center truncate px-1">
                {width > 6 ? LAYOUT_LABEL[s.layout] : ""}
              </span>
            </button>
          );
        })}

        {/* Playhead */}
        <div
          className="pointer-events-none absolute top-0 h-full w-[2px] bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]"
          style={{ left: `${playheadPct}%` }}
        />
      </div>

      {/* Legenda de falantes */}
      <div className="flex flex-wrap gap-1.5">
        {plan.speakers.map((sp) => (
          <span
            key={sp.id}
            className="rounded-full border border-border bg-card/60 px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
          >
            <span className="font-bold text-foreground">{sp.id}</span> · {sp.label}
          </span>
        ))}
      </div>
    </div>
  );
}
