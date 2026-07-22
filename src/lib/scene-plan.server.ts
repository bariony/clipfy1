// Gera scene_plan (edição dinâmica) para cada clipe usando GPT-4o-mini como
// "diarizador semântico" — infere falantes, beats emocionais e alterna layouts.
//
// Server-only. Chamado por generateAndSaveClipSuggestions após inserir os clips.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { ScenePlan, SceneStep, Speaker } from "./scene-plan";

export type Seg = { text: string; start: number; end: number };

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

function segmentsInRange(segments: Seg[], start: number, end: number): Seg[] {
  return segments.filter((s) => s.end > start && s.start < end);
}

function buildTimeline(segments: Seg[], startSec: number): string {
  return segments
    .slice(0, 60)
    .map((s) => {
      const t = Math.max(0, s.start - startSec);
      return `[${t.toFixed(1)}s] ${s.text}`;
    })
    .join("\n")
    .slice(0, 4000);
}

/** Fallback conservador: full por padrão. Dividir sem contexto piora o corte. */
function fallbackScenePlan(duration: number): ScenePlan {
  const scenes: SceneStep[] = [];
  const step = 6;
  let t = 0;
  while (t < duration) {
    const dur = Math.min(step, duration - t);
    scenes.push({
      t,
      dur,
      layout: "full",
      focus: "A",
      beat: "safe-full",
    });
    t += dur;
  }
  return {
    speakers: [
      { id: "A", label: "Falante A" },
      { id: "B", label: "Falante B" },
    ],
    scenes,
    generated_by: "fallback",
    generated_at: new Date().toISOString(),
  };
}

function coerceScenePlan(
  raw: unknown,
  duration: number,
): ScenePlan | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as {
    speakers?: Array<{ id?: string; label?: string }>;
    scenes?: Array<{
      t?: number;
      dur?: number;
      layout?: string;
      focus?: string;
      left?: string;
      right?: string;
      top?: string;
      bottom?: string;
      inset?: string;
      grid?: string[];
      beat?: string;
    }>;
  };
  const rawScenes = Array.isArray(obj.scenes) ? obj.scenes : [];
  const allowed = new Set(["full", "split", "stack", "pip", "quad", "broll"]);
  const scenes: SceneStep[] = rawScenes
    .map((s): SceneStep | null => {
      const t = Number(s.t);
      const dur = Number(s.dur);
      const layout = String(s.layout ?? "full");
      if (!Number.isFinite(t) || !Number.isFinite(dur) || dur <= 0) return null;
      if (!allowed.has(layout)) return null;
      return {
        t: Math.max(0, t),
        dur: Math.min(dur, duration),
        layout: layout as SceneStep["layout"],
        focus: s.focus ? String(s.focus).slice(0, 4) : undefined,
        left: s.left ? String(s.left).slice(0, 4) : undefined,
        right: s.right ? String(s.right).slice(0, 4) : undefined,
        top: s.top ? String(s.top).slice(0, 4) : undefined,
        bottom: s.bottom ? String(s.bottom).slice(0, 4) : undefined,
        inset: s.inset ? String(s.inset).slice(0, 4) : undefined,
        grid: Array.isArray(s.grid) ? s.grid.slice(0, 4).map((g) => String(g).slice(0, 4)) : undefined,
        beat: s.beat ? String(s.beat).slice(0, 30) : undefined,
      };
    })
    .filter((s): s is SceneStep => s !== null)
    .sort((a, b) => a.t - b.t);
  if (scenes.length === 0) return null;

  // Pós-processamento: permite edição dinâmica de verdade. Split/stack/pip/quad
  // são bem-vindos quando há segunda pessoa distinta; ainda bloqueamos
  // sequências longas do MESMO layout dividido para não virar poluição visual.
  const multiLayouts = new Set<SceneStep["layout"]>(["split", "stack", "pip", "quad"]);
  const maxMulti = Math.max(2, Math.floor(scenes.length * 0.6));
  let multiCount = 0;
  let sameMultiStreak = 0;
  let lastLayout: SceneStep["layout"] | null = null;
  for (const sc of scenes) {
    const isMulti = multiLayouts.has(sc.layout);
    if (!isMulti) {
      sameMultiStreak = 0;
      lastLayout = sc.layout;
      continue;
    }
    const hasSecond = Boolean(sc.right || sc.bottom || sc.inset || (Array.isArray(sc.grid) && sc.grid.length > 1));
    if (!hasSecond || multiCount >= maxMulti || (lastLayout === sc.layout && sameMultiStreak >= 2)) {
      sc.layout = "full";
      sc.right = undefined;
      sc.bottom = undefined;
      sc.inset = undefined;
      sc.grid = undefined;
      sameMultiStreak = 0;
      lastLayout = "full";
      continue;
    }
    multiCount++;
    sameMultiStreak = lastLayout === sc.layout ? sameMultiStreak + 1 : 1;
    lastLayout = sc.layout;
  }

  const speakers: Speaker[] = (obj.speakers ?? [])
    .filter((s) => s && s.id)
    .slice(0, 6)
    .map((s) => ({ id: String(s.id).slice(0, 4), label: String(s.label ?? s.id).slice(0, 40) }));
  if (speakers.length === 0) {
    // Deriva speakers a partir das cenas
    const used = new Set<string>();
    for (const sc of scenes) {
      [sc.focus, sc.left, sc.right, sc.top, sc.bottom, sc.inset, ...(sc.grid ?? [])].forEach((v) => {
        if (v) used.add(v);
      });
    }
    used.forEach((id) => speakers.push({ id, label: `Falante ${id}` }));
    if (speakers.length === 0) speakers.push({ id: "A", label: "Falante A" });
  }

  return {
    speakers,
    scenes,
    generated_by: "gpt-4o-mini",
    generated_at: new Date().toISOString(),
  };
}

async function generateScenePlanForClip(params: {
  startSeconds: number;
  endSeconds: number;
  segments: Seg[];
  apiKey: string;
}): Promise<ScenePlan> {
  const { startSeconds, endSeconds, segments, apiKey } = params;
  const duration = Math.max(1, endSeconds - startSeconds);
  const local = segmentsInRange(segments, startSeconds, endSeconds);
  const timeline = buildTimeline(local, startSeconds);

  // Sem transcrição: retorna fallback direto
  if (!timeline) return fallbackScenePlan(duration);

  const system = `Você é o diretor de edição do Clipfy. Analisa um corte curto (${duration.toFixed(1)}s) e planeja uma edição DINÂMICA, chamativa e inteligente — como um editor de shorts profissional (Opus, Hormozi, podcast clips). O objetivo é prender o olho: alternar foco, mostrar reação, dividir tela quando dois falam ou reagem.

REGRAS:
- Infira falantes a partir do texto (mudanças de tom, "eu", "você", vocativos, perguntas/respostas, risadas). Rotule A, B, C…
- Divida em CENAS curtas de 2-5 segundos. Cenas curtas = ritmo.
- Layouts: "full" (1 pessoa), "split" (2 lado a lado), "stack" (2 empilhados — MELHOR para podcast em 9:16), "pip" (grande + inset), "quad" (4), "broll".
- QUANDO O FALANTE MUDA: troque o foco IMEDIATAMENTE na próxima cena (nova cena com focus = novo falante). Não fique preso na pessoa anterior.
- QUANDO DOIS FALAM JUNTOS, HÁ REAÇÃO/RISADA, PERGUNTA-RESPOSTA RÁPIDA, OU CONFRONTO: use "stack" (preferido em 9:16) ou "split", com left/right (ou top/bottom) preenchidos com IDs DIFERENTES de falantes.
- Use "pip" quando alguém fala e a reação do outro importa. Use "quad" só se houver 4 pessoas ativas.
- Em uma cena dividida: os dois IDs precisam ser semanticamente DIFERENTES; nunca duas janelas do mesmo falante.
- Se só há 1 falante detectado no corte inteiro: use apenas "full" e alterne o zoom sutilmente entre cenas (mas ainda alterne cenas curtas).
- Evite 3+ cenas divididas iguais em sequência (varie stack → full → split → full…).
- Cenas contíguas (próxima t = t anterior + dur anterior). Última cena termina em duration.
- Responda SOMENTE JSON válido: {"speakers":[{"id":"A","label":"Host"},{"id":"B","label":"Convidado"}],"scenes":[{"t":0,"dur":2.4,"layout":"full","focus":"A","beat":"pergunta"},{"t":2.4,"dur":3.1,"layout":"stack","top":"A","bottom":"B","beat":"reacao"}]}`;

  const user = `Corte de ${duration.toFixed(1)}s (timestamps relativos ao início do corte).
Transcrição:
${timeline}

Gere o plano de cenas (JSON puro).`;

  try {
    const resp = await fetch(AI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
        "X-Lovable-AIG-SDK": "raw",
      },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini",
        temperature: 0.7,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    if (!resp.ok) return fallbackScenePlan(duration);

    const payload = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = payload.choices?.[0]?.message?.content ?? "";
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
    const parsed = JSON.parse(cleaned);
    const plan = coerceScenePlan(parsed, duration);
    return plan ?? fallbackScenePlan(duration);
  } catch {
    return fallbackScenePlan(duration);
  }
}

export async function generateScenePlansForClips({
  supabase,
  clips,
  segments,
  apiKey,
}: {
  supabase: SupabaseClient<Database>;
  clips: Array<{ id: string; startSeconds: number; endSeconds: number }>;
  segments: Seg[];
  apiKey: string;
}) {
  // Concorrência limitada pra não estourar o gateway
  const CONCURRENCY = 3;
  const queue = [...clips];
  const errors: string[] = [];

  async function worker() {
    while (queue.length > 0) {
      const c = queue.shift();
      if (!c) return;
      try {
        const plan = await generateScenePlanForClip({
          startSeconds: c.startSeconds,
          endSeconds: c.endSeconds,
          segments,
          apiKey,
        });
        const { error } = await supabase
          .from("clips")
          .update({ scene_plan: plan as never })
          .eq("id", c.id);
        if (error) errors.push(`${c.id}: ${error.message}`);
      } catch (err) {
        errors.push(`${c.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, clips.length) }, () => worker()));
  return { total: clips.length, errors: errors.length };
}

/** Regera scene_plan pra um único clipe (chamado sob demanda pelo drawer). */
export async function regenerateScenePlanForClip({
  supabase,
  clipId,
  apiKey,
}: {
  supabase: SupabaseClient<Database>;
  clipId: string;
  apiKey: string;
}) {
  const { data: clip, error: cErr } = await supabase
    .from("clips")
    .select("id, project_id, start_seconds, end_seconds")
    .eq("id", clipId)
    .maybeSingle();
  if (cErr) throw new Error(cErr.message);
  if (!clip) throw new Error("Clip not found");

  const { data: transcript } = await supabase
    .from("transcripts")
    .select("segments")
    .eq("project_id", clip.project_id)
    .maybeSingle();

  const raw = (transcript?.segments ?? []) as unknown;
  const segments: Seg[] = Array.isArray(raw)
    ? (raw as Seg[]).filter((s) => typeof s?.start === "number" && typeof s?.end === "number")
    : [];

  const plan = await generateScenePlanForClip({
    startSeconds: Number(clip.start_seconds),
    endSeconds: Number(clip.end_seconds),
    segments,
    apiKey,
  });

  const { error: uErr } = await supabase
    .from("clips")
    .update({ scene_plan: plan as never })
    .eq("id", clipId);
  if (uErr) throw new Error(uErr.message);

  return plan;
}
