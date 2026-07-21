// Scene Plan — plano de edição dinâmica ponta-a-ponta
// Estrutura salva em clips.scene_plan (jsonb)
//
// Cada corte tem um plano com:
//  - speakers: quem são os falantes detectados (A, B, C…)
//  - scenes: sequência de cenas ao longo do clipe, com layout dinâmico
//
// Layouts suportados:
//  - full   : foco total em 1 falante (crop no rosto)
//  - split  : dois falantes lado a lado
//  - stack  : dois falantes empilhados (top/bottom, formato 9:16)
//  - pip    : um falante grande + inset do outro
//  - quad   : 4 quadrantes (grupo)
//  - broll  : b-roll (imagem/gráfico), voz continua

export type SceneLayout = "full" | "split" | "stack" | "pip" | "quad" | "broll";

export type SceneStep = {
  /** Tempo (segundos, relativo ao início do clipe) */
  t: number;
  /** Duração da cena em segundos */
  dur: number;
  /** Layout escolhido para essa cena */
  layout: SceneLayout;
  /** Falante em foco (ou principal em PiP) */
  focus?: string;
  /** Para split: falante à esquerda */
  left?: string;
  /** Para split: falante à direita */
  right?: string;
  /** Para stack: em cima */
  top?: string;
  /** Para stack: embaixo */
  bottom?: string;
  /** Para pip: inset (canto) */
  inset?: string;
  /** Para quad: ordem dos 4 quadrantes */
  grid?: string[];
  /** Motivo/emoção detectada — "grito", "risada", "polêmica", "silêncio" */
  beat?: string;
};

export type Speaker = {
  id: string; // "A", "B", "C"…
  label: string; // "Host", "Convidado", "Speaker A"…
};

export type ScenePlan = {
  speakers: Speaker[];
  scenes: SceneStep[];
  generated_by?: string;
  generated_at?: string;
};

export function isScenePlan(value: unknown): value is ScenePlan {
  if (!value || typeof value !== "object") return false;
  const p = value as Partial<ScenePlan>;
  return Array.isArray(p.scenes) && Array.isArray(p.speakers);
}

/** Retorna a cena ativa no tempo `t` (segundos relativo ao início do clipe). */
export function getSceneAt(plan: ScenePlan | null | undefined, t: number): SceneStep | null {
  if (!plan) return null;
  const scenes = plan.scenes;
  if (!Array.isArray(scenes) || scenes.length === 0) return null;
  // Binary-ish walk (scenes já ordenadas)
  for (let i = scenes.length - 1; i >= 0; i--) {
    const s = scenes[i];
    if (typeof s.t === "number" && s.t <= t) return s;
  }
  return scenes[0];
}

export const LAYOUT_LABEL: Record<SceneLayout, string> = {
  full: "Full",
  split: "Split",
  stack: "Stack",
  pip: "PiP",
  quad: "Quad",
  broll: "B-roll",
};

export const LAYOUT_COLOR: Record<SceneLayout, string> = {
  full: "bg-primary/70",
  split: "bg-fuchsia-500/70",
  stack: "bg-cyan-500/70",
  pip: "bg-amber-500/70",
  quad: "bg-emerald-500/70",
  broll: "bg-slate-500/70",
};
