import { cn } from "@/lib/utils";
import { STATUS_META, type ProjectStatus } from "@/lib/project-status";

const TONE: Record<(typeof STATUS_META)[ProjectStatus]["tone"], string> = {
  neutral: "border-border bg-secondary/60 text-muted-foreground",
  accent: "border-primary/30 bg-primary/10 text-primary",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  danger: "border-destructive/40 bg-destructive/10 text-destructive",
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
};

export function StatusPill({
  status,
  className,
}: {
  status: ProjectStatus;
  className?: string;
}) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest",
        TONE[meta.tone],
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {meta.label}
    </span>
  );
}
