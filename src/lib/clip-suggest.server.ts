// Server-only helper: gera sugestões de clips a partir de uma transcrição
// e persiste no banco. Usado por transcribeProject (upload) e pelo
// endpoint de callback do worker (YouTube).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type Seg = { text: string; start: number; end: number };

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

function fallbackClips(fullText: string, segments: Seg[], targetCount: number) {
  const cleanText = fullText.replace(/\s+/g, " ").trim();
  const available = segments.length > 0 ? segments : textToSyntheticSegments(cleanText);
  const clipCount = Math.max(3, Math.min(targetCount || 6, 8, available.length));
  const stride = Math.max(1, Math.floor(available.length / clipCount));

  return Array.from({ length: clipCount }, (_, index) => {
    const startIndex = Math.min(index * stride, available.length - 1);
    const window = available.slice(startIndex, Math.min(available.length, startIndex + Math.max(6, stride)));
    const start = Math.floor(window[0]?.start ?? index * 45);
    const end = Math.max(start + 20, Math.ceil(window.at(-1)?.end ?? start + 45));
    const excerpt = window.map((s) => s.text).join(" ").replace(/\s+/g, " ").slice(0, 420);
    const words = excerpt.split(" ").filter(Boolean);
    const title = words.slice(0, 8).join(" ").replace(/[.,!?;:]+$/g, "") || `Corte recomendado ${index + 1}`;
    return {
      title: title.length > 10 ? title : `Corte recomendado ${index + 1}`,
      hook: excerpt.slice(0, 150),
      start_seconds: start,
      end_seconds: Math.min(end, start + 75),
      virality_score: Math.max(62, 88 - index * 4),
      transcript_excerpt: excerpt,
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
  apiKey,
}: {
  supabase: SupabaseClient<Database>;
  userId: string;
  projectId: string;
  fullText: string;
  segments: Seg[];
  brief: string | null;
  targetCount: number | null;
  apiKey: string;
}) {
  const wanted = Math.max(3, Math.min(targetCount ?? 6, 10));
  const timeline = (segments.length > 0 ? segments : textToSyntheticSegments(fullText))
    .slice(0, 220)
    .map((s) => `[${Math.round(s.start)}-${Math.round(s.end)}s] ${s.text}`)
    .join("\n")
    .slice(0, 18000);

  let clips = fallbackClips(fullText, segments, wanted);

  try {
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
              'Você é o motor de cortes virais do Clipfy. Responda somente JSON válido no formato {"clips":[...]}. Escolha trechos com começo e fim claros, potencial de retenção e títulos curtos em português.',
          },
          {
            role: "user",
            content: `Objetivo do usuário: ${brief || "identificar os melhores cortes virais"}\nQuantidade desejada: ${wanted}\nTimeline com timestamps:\n${timeline}`,
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
          transcript_excerpt?: string;
        }>;
      };
      const aiClips = (parsed.clips ?? [])
        .map((clip, index) => ({
          title: String(clip.title || `Corte recomendado ${index + 1}`).slice(0, 140),
          hook: String(clip.hook || clip.transcript_excerpt || "").slice(0, 260),
          start_seconds: Math.max(0, Math.floor(Number(clip.start_seconds) || 0)),
          end_seconds: Math.max(1, Math.ceil(Number(clip.end_seconds) || 0)),
          virality_score: Math.max(1, Math.min(100, Math.round(Number(clip.virality_score) || 70))),
          transcript_excerpt: String(clip.transcript_excerpt || clip.hook || "").slice(0, 800),
        }))
        .filter((clip) => clip.end_seconds > clip.start_seconds + 5)
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
    metadata: { generated_by: "clipfy-mvp" } as never,
  }));

  const { data: inserted, error } = await supabase
    .from("clips")
    .insert(rows)
    .select("id, start_seconds, end_seconds, transcript_excerpt");
  if (error) throw new Error(error.message);

  // Segunda passada: gera scene_plan (edição dinâmica) pra cada clipe.
  // Erros aqui não invalidam os clips — o plano é enriquecimento opcional.
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

  return rows.length;
}
