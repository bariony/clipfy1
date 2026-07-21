// Server-only helper: gera sugestões de clips a partir de uma transcrição
// e persiste no banco. Usado por transcribeProject (upload) e pelo
// endpoint de callback do worker (YouTube).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type Seg = { text: string; start: number; end: number };

type ClipCandidate = {
  title: string;
  hook: string;
  start_seconds: number;
  end_seconds: number;
  virality_score: number;
  transcript_excerpt: string;
  score_reason?: string;
};

function textToSyntheticSegments(fullText: string): Seg[] {
  const sentences = fullText.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [fullText];
  return sentences
    .slice(0, 200)
    .map((sentence, index) => ({
      text: sentence.trim(),
      start: index * 8,
      end: index * 8 + 8,
    }))
    .filter((s) => s.text.length > 0);
}

function normalizeClipBounds(params: {
  start: number;
  end: number;
  minClipSeconds?: number | null;
  maxClipSeconds?: number | null;
}) {
  const floor = Math.max(35, Math.min(65, Number(params.minClipSeconds ?? 45)));
  const ceiling = Math.max(floor + 15, Math.min(95, Number(params.maxClipSeconds ?? 75)));
  const start = Math.max(0, Math.floor(params.start));
  const naturalEnd = Math.max(start + floor, Math.ceil(params.end));
  return {
    start,
    end: Math.max(start + floor, Math.min(naturalEnd, start + ceiling)),
    min: floor,
    max: ceiling,
  };
}

function scoreExcerpt(excerpt: string, rank: number) {
  const text = excerpt.toLowerCase();
  let score = 48;
  if (/[?!]/.test(excerpt)) score += 6;
  if (/nunca|ningu[eé]m|segredo|absurdo|choc|pol[eê]mica|dinheiro|milh[oõ]es|erro|verdade|medo|risco|viral|foda|caralho/i.test(text)) score += 14;
  if (/mas|s[oó] que|porque|ent[aã]o|resultado|aprendi|descobri/i.test(text)) score += 8;
  const words = excerpt.split(/\s+/).filter(Boolean).length;
  if (words >= 70 && words <= 160) score += 8;
  if (words < 25) score -= 10;
  score -= rank * 3;
  return Math.max(35, Math.min(87, Math.round(score)));
}

function fallbackClips(
  fullText: string,
  segments: Seg[],
  targetCount: number,
  minClipSeconds?: number | null,
  maxClipSeconds?: number | null,
): ClipCandidate[] {
  const cleanText = fullText.replace(/\s+/g, " ").trim();
  const available = segments.length > 0 ? segments : textToSyntheticSegments(cleanText);
  const clipCount = Math.max(3, Math.min(targetCount || 6, 8, available.length));
  const stride = Math.max(1, Math.floor(available.length / clipCount));

  return Array.from({ length: clipCount }, (_, index) => {
    const startIndex = Math.min(index * stride, available.length - 1);
    const variableWindow = Math.max(3, Math.min(10, stride + (index % 4) + 2));
    const window = available.slice(startIndex, Math.min(available.length, startIndex + variableWindow));
    const bounds = normalizeClipBounds({
      start: window[0]?.start ?? index * 40,
      end: window.at(-1)?.end ?? index * 40 + 35 + (index % 4) * 7,
      minClipSeconds,
      maxClipSeconds,
    });
    const excerpt = window.map((s) => s.text).join(" ").replace(/\s+/g, " ").slice(0, 420);
    const words = excerpt.split(" ").filter(Boolean);
    const title = words.slice(0, 8).join(" ").replace(/[.,!?;:]+$/g, "") || `Corte recomendado ${index + 1}`;
    return {
      title: title.length > 10 ? title : `Corte recomendado ${index + 1}`,
      hook: excerpt.slice(0, 150),
      start_seconds: bounds.start,
      end_seconds: bounds.end,
      virality_score: scoreExcerpt(excerpt, index),
      transcript_excerpt: excerpt,
      score_reason: "Fallback heurístico: emoção, clareza do hook e densidade do trecho.",
    };
  });
}

export async function generateAndSaveClipSuggestions({
  supabase,
  userId,
  projectId,
  fullText,
  segments,
  brief,
  targetCount,
  minClipSeconds,
  maxClipSeconds,
  apiKey,
  origin,
}: {
  supabase: SupabaseClient<Database>;
  userId: string;
  projectId: string;
  fullText: string;
  segments: Seg[];
  brief: string | null;
  targetCount: number | null;
  minClipSeconds?: number | null;
  maxClipSeconds?: number | null;
  apiKey: string;
  origin?: string;
}) {
  const wanted = Math.max(3, Math.min(targetCount ?? 6, 10));
  const bounds = normalizeClipBounds({ start: 0, end: 60, minClipSeconds, maxClipSeconds });

  let clips: ClipCandidate[] = fallbackClips(fullText, segments, wanted, minClipSeconds, maxClipSeconds);

  // Semantic Clip Engine v2 — pipeline editorial (topics → beats → validation → score).
  // Se falhar por qualquer motivo, cai no pipeline LLM antigo abaixo.
  let sceOk = false;
  try {
    const { runSemanticClipEngine } = await import("./sce/engine.server");
    const sceClips = await runSemanticClipEngine({
      segments,
      brief,
      targetCount: wanted,
      apiKey,
    });
    if (sceClips.length > 0) {
      clips = sceClips.map((c) => ({
        title: c.title || "Corte recomendado",
        hook: c.hook,
        start_seconds: c.start_seconds,
        end_seconds: c.end_seconds,
        virality_score: c.virality_score,
        transcript_excerpt: c.transcript_excerpt,
        score_reason: c.score_reason,
      }));
      sceOk = true;
      console.info("[SCE] pipeline editorial ok", { clips: sceClips.length, avg: Math.round(sceClips.reduce((s, c) => s + c.virality_score, 0) / sceClips.length) });
    }
  } catch (err) {
    console.warn("[SCE] falhou, caindo pro pipeline legado:", err);
  }

  if (!sceOk) try {
    const timeline = (segments.length > 0 ? segments : textToSyntheticSegments(fullText))
      .slice(0, 220)
      .map((s) => `[${Math.round(s.start)}-${Math.round(s.end)}s] ${s.text}`)
      .join("\n")
      .slice(0, 18000);

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
        "X-Lovable-AIG-SDK": "raw",
      },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini",
        temperature: 0.25,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              `Você é o motor de cortes virais do Clipfy. Responda somente JSON válido no formato {"clips":[{"title":"","hook":"","start_seconds":0,"end_seconds":0,"virality_score":0,"score_reason":"","transcript_excerpt":""}]}.

Regras profissionais:
- Duração alvo: ${bounds.min}-${bounds.max}s. MIRE em 55-75s. Cortes abaixo de 45s SÓ se forem excepcionais (score 90+). Nunca entregue clips de 20-30s — é curto demais e perde contexto.
- Se um trecho forte tem só 25-30s, ESTENDA para incluir o setup anterior OU o desdobramento posterior, formando um arco completo de ~60s. Não corte no meio da história.
- Se dois momentos fortes estão próximos (gap < 15s), FUNDA em um único corte cobrindo ambos, mesmo que dure 80s.
- Corte começa no gancho (sem intro morta) e termina numa conclusão/virada clara — não no meio de uma frase.
- Score 0-100 honesto e raro: 95+ só excepcional; 85-94 muito forte; 70-84 bom; <70 mediano. Varie de acordo com força real do hook, emoção, controvérsia, novidade, clareza e retenção.
- Títulos curtos em português, sem clickbait mentiroso.`,
          },
          {
            role: "user",
            content: `Objetivo do usuário: ${brief || "identificar os melhores cortes virais"}\nQuantidade desejada: ${wanted}\nDuração mínima/máxima por corte: ${bounds.min}-${bounds.max}s\nTimeline com timestamps:\n${timeline}`,
          },
        ],
      }),
    });

    if (aiResp.ok) {
      const payload = (await aiResp.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const raw = payload.choices?.[0]?.message?.content ?? "";
      const parsed = JSON.parse(raw.replace(/^```json\s*/i, "").replace(/```$/i, "").trim()) as {
        clips?: Array<{
          title?: string;
          hook?: string;
          start_seconds?: number;
          end_seconds?: number;
          virality_score?: number;
          score_reason?: string;
          transcript_excerpt?: string;
        }>;
      };
      const aiClips = (parsed.clips ?? [])
        .map((clip, index): ClipCandidate => {
          const bounded = normalizeClipBounds({
            start: Number(clip.start_seconds) || 0,
            end: Number(clip.end_seconds) || 0,
            minClipSeconds,
            maxClipSeconds,
          });
          const excerpt = String(clip.transcript_excerpt || clip.hook || "").slice(0, 800);
          const rawScore = Math.round(Number(clip.virality_score) || scoreExcerpt(excerpt, index));
          return {
            title: String(clip.title || `Corte recomendado ${index + 1}`).slice(0, 140),
            hook: String(clip.hook || clip.transcript_excerpt || "").slice(0, 260),
            start_seconds: bounded.start,
            end_seconds: bounded.end,
            virality_score: Math.max(1, Math.min(100, rawScore)),
            transcript_excerpt: excerpt,
            score_reason: String(clip.score_reason || "Análise de hook, retenção e intensidade.").slice(0, 220),
          };
        })
        .filter((clip) => clip.end_seconds > clip.start_seconds + Math.max(8, bounds.min - 2))
        .slice(0, wanted);
      if (aiClips.length > 0) clips = aiClips;
    }
  } catch {
    // fallback já preparado
  }

  const rows = clips.map((clip) => ({
    project_id: projectId,
    user_id: userId,
    title: clip.title,
    hook: clip.hook || null,
    start_seconds: clip.start_seconds,
    end_seconds: clip.end_seconds,
    virality_score: clip.virality_score,
    transcript_excerpt: clip.transcript_excerpt || null,
    status: "suggested" as const,
    aspect_ratio: "9:16",
    metadata: { generated_by: sceOk ? "clipfy-sce-v2" : "clipfy-ai-v2", score_reason: clip.score_reason ?? null } as never,
  }));

  const { data: inserted, error } = await supabase
    .from("clips")
    .insert(rows)
    .select("id, start_seconds, end_seconds, transcript_excerpt");
  if (error) throw new Error(error.message);

  // Libera a UI assim que os cortes existem. Scene plan e auto-render são
  // enriquecimentos posteriores; se demorarem, o projeto não fica preso em 85%.
  await supabase
    .from("projects")
    .update({
      status: "ready",
      error_message: null,
      transcribe_progress: 100,
      active_transcribe_job_id: null,
    })
    .eq("id", projectId);

  // Segunda passada: scene_plan + auto-render são enriquecimentos.
  // Não bloqueia o callback da transcrição em 85%; a UI já mostra os cortes
  // e os cards também enfileiram render se ainda não houver job.
  void (async () => {
    try {
      const { generateScenePlansForClips } = await import("./scene-plan.server");
      await generateScenePlansForClips({
        supabase,
        clips: (inserted ?? []).map((c) => ({
          id: c.id,
          startSeconds: Number(c.start_seconds),
          endSeconds: Number(c.end_seconds),
        })),
        segments,
        apiKey,
      });
    } catch (err) {
      console.warn("[scene-plan] geração falhou (não bloqueia clips):", err);
    }

    if (origin && inserted && inserted.length > 0) {
      try {
        const { enqueueRenderForClip } = await import("./render.server");
        for (const c of inserted) {
          try {
            await enqueueRenderForClip({ supabase, clipId: c.id, origin });
          } catch (err) {
            console.warn("[auto-render] falha no clip", c.id, err);
          }
        }
      } catch (err) {
        console.warn("[auto-render] indisponível:", err);
      }
    }
  })();

  return rows.length;
}
