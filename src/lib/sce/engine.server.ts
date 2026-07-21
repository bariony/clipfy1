// Semantic Clip Engine (SCE) — pipeline editorial de seleção de clips.
//
// Substitui a decisão "um LLM devolve start/end" por um pipeline em estágios:
//
//   1. sentences: normaliza segments Whisper em unidades de sentença
//   2. topics:    LLM identifica fronteiras de assunto e o tipo narrativo
//   3. beats:     LLM extrai hook/setup/climax/conclusion por tópico
//   4. build:     transforma beats em candidate clips (com split narrativo)
//   5. validate:  checks editoriais + expansão automática se faltar conclusão
//   6. score:     LLM pontua em 10 dimensões (story score)
//
// Design: cada função é pura (só entrada/saída), sem dependência do Supabase.
// A integração acontece no clip-suggest.server.ts, que injeta o resultado.

export type Seg = { text: string; start: number; end: number };

export type SceClip = {
  title: string;
  hook: string;
  start_seconds: number;
  end_seconds: number;
  virality_score: number;
  transcript_excerpt: string;
  score_reason: string;
  story_score?: {
    hook: number; context: number; clarity: number; storytelling: number;
    curiosity: number; conclusion: number; retention: number;
    shareability: number; emotion: number; informativeness: number;
    final: number;
  };
  narrative_kind?: string;
  expanded?: boolean;
};

// ---------------- 1. Sentence normalizer ----------------

export type Sentence = {
  idx: number;
  t0: number;
  t1: number;
  text: string;
  endsWithTerminator: boolean;   // .!? no final
  endsWithConnector: boolean;    // vírgula + mas/então/porque/e/ou/nem/aí…
  hasQuestion: boolean;
  hasListMarker: boolean;        // "três motivos", "primeiro", "segundo"…
  hasCliffhanger: boolean;       // "mas tem um detalhe", "foi aí que"…
  hasClosure: boolean;           // "então foi por isso", "no final"…
  hasOpener: boolean;            // "vou contar", "existe uma coisa que"…
};

const CONNECTORS = /,\s*(mas|por[eé]m|entretanto|contudo|ent[aã]o|porque|pois|e|ou|nem|a[íi])$/i;
const CLIFF_PAT = /(mas\s+tem\s+um\s+detalhe|foi\s+a[íi]\s+que|depois\s+aconteceu|só\s+que\s+a[íi]|e\s+a[íi]\s+eu|espera\s+até|voc[eê]\s+n[ãa]o\s+vai\s+acreditar)/i;
const CLOSURE_PAT = /(foi\s+por\s+isso|ent[aã]o\s+essa\s+foi|no\s+final|por\s+isso\s+eu|essa\s+é\s+a\s+li[cç][aã]o|resumindo|conclus[ãa]o|moral\s+da\s+hist[oó]ria|em\s+resumo|resultado\s+final)/i;
const OPENER_PAT = /(vou\s+contar|vou\s+explicar|teve\s+uma\s+vez|existe\s+uma\s+coisa|o\s+problema\s+[eé]|deixa\s+eu\s+te\s+contar|imagina\s+o\s+seguinte|isso\s+aconteceu|voc[eê]\s+sabia)/i;
const LIST_PAT = /(tr[eê]s\s+(motivos|raz[oõ]es|coisas|pontos)|dois\s+(motivos|pontos)|quatro\s+(motivos|pontos)|primeiro[,\s]|segundo[,\s]|terceiro[,\s]|em\s+primeiro\s+lugar)/i;

export function normalizeSentences(segments: Seg[]): Sentence[] {
  if (!segments?.length) return [];
  // Junta o texto em um "flow" acompanhando os tempos por caractere,
  // depois quebra em sentenças pontuadas — permite carregar o início/fim
  // real de cada sentença a partir dos segments Whisper.
  type Char = { c: string; t: number };
  const chars: Char[] = [];
  for (const s of segments) {
    const text = (s.text || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const dur = Math.max(0.01, s.end - s.start);
    const per = dur / Math.max(1, text.length);
    for (let i = 0; i < text.length; i++) chars.push({ c: text[i], t: s.start + per * i });
    chars.push({ c: " ", t: s.end });
  }
  const out: Sentence[] = [];
  let buf = "";
  let bufStart: number | null = null;
  let lastT = 0;
  let idx = 0;
  const flush = (endT: number) => {
    const text = buf.replace(/\s+/g, " ").trim();
    if (!text || text.length < 2) { buf = ""; bufStart = null; return; }
    const sent: Sentence = {
      idx: idx++,
      t0: bufStart ?? endT,
      t1: endT,
      text,
      endsWithTerminator: /[.!?…]$/.test(text),
      endsWithConnector: CONNECTORS.test(text),
      hasQuestion: /\?/.test(text),
      hasListMarker: LIST_PAT.test(text),
      hasCliffhanger: CLIFF_PAT.test(text),
      hasClosure: CLOSURE_PAT.test(text),
      hasOpener: OPENER_PAT.test(text),
    };
    out.push(sent);
    buf = ""; bufStart = null;
  };
  for (const { c, t } of chars) {
    if (bufStart == null) bufStart = t;
    buf += c;
    lastT = t;
    if (/[.!?…]/.test(c)) flush(t);
  }
  if (buf.trim()) flush(lastT);
  return out;
}

// ---------------- 2. Topic segmenter (LLM) ----------------

export type Topic = {
  startIdx: number;
  endIdx: number;
  title: string;
  kind: "story" | "explanation" | "list" | "debate" | "qa" | "opinion" | "other";
};

async function callLovableAi(apiKey: string, body: object): Promise<string> {
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "raw",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`LLM ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const payload = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return payload.choices?.[0]?.message?.content ?? "";
}

function safeParseJson<T>(raw: string): T | null {
  try {
    const clean = raw.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
    return JSON.parse(clean) as T;
  } catch { return null; }
}

export async function detectTopics(sentences: Sentence[], apiKey: string, brief: string | null): Promise<Topic[]> {
  if (sentences.length < 3) return [{ startIdx: 0, endIdx: sentences.length - 1, title: "Conteúdo", kind: "other" }];
  // Compacta pra caber no contexto — mostra ~600 sentenças com t0.
  const timeline = sentences.slice(0, 600).map((s) => `[${s.idx}|${Math.round(s.t0)}s] ${s.text}`).join("\n").slice(0, 22000);
  const raw = await callLovableAi(apiKey, {
    model: "openai/gpt-5.5",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `Você é um editor de vídeos virais analisando uma transcrição. Sua tarefa é identificar as FRONTEIRAS DE ASSUNTO — onde um tópico começa e termina — para que cada clip seja uma ideia completa.

Regras:
- Cada tópico é uma UNIDADE NARRATIVA autoconsciente (uma história, uma explicação, uma resposta a pergunta, um debate, uma lista).
- Ignore digressões curtas (<3 sentenças) — funda no tópico ao redor.
- Prefira tópicos entre 20s e 180s. Se um assunto durar 4+ minutos, divida em partes coerentes.
- kind ∈ {"story","explanation","list","debate","qa","opinion","other"}
- Retorne SOMENTE JSON: {"topics":[{"startIdx":N,"endIdx":N,"title":"...","kind":"..."}]}
- Os índices se referem ao [idx|Xs] do input. Nunca invente índices fora do range.
- Não sobreponha tópicos.`,
      },
      {
        role: "user",
        content: `Briefing do criador: ${brief || "(sem briefing — priorizar ideias completas com potencial viral)"}\n\nTranscrição sentenciada:\n${timeline}`,
      },
    ],
  });
  const parsed = safeParseJson<{ topics?: Array<Partial<Topic>> }>(raw);
  const topics = (parsed?.topics ?? [])
    .map((t): Topic => ({
      startIdx: Math.max(0, Math.min(sentences.length - 1, Number(t.startIdx) || 0)),
      endIdx: Math.max(0, Math.min(sentences.length - 1, Number(t.endIdx) || 0)),
      title: String(t.title || "Tópico").slice(0, 120),
      kind: (["story","explanation","list","debate","qa","opinion","other"].includes(String(t.kind ?? "")) ? t.kind : "other") as Topic["kind"],
    }))
    .filter((t) => t.endIdx >= t.startIdx + 1)
    .sort((a, b) => a.startIdx - b.startIdx);
  if (!topics.length) return [{ startIdx: 0, endIdx: sentences.length - 1, title: "Conteúdo", kind: "other" }];
  return topics;
}

// ---------------- 3. Narrative beat extractor ----------------

export type TopicBeats = {
  topic: Topic;
  hookIdx: number;             // sentença que serve de gancho de abertura
  setupEndIdx: number;         // fim do setup
  climaxIdx: number;           // pico do assunto
  conclusionIdx: number;       // sentença de fechamento — clip TEM que chegar aqui
  needsExpansionAfter: boolean; // conclusão não está clara no range → expandir
};

export async function extractBeats(
  topics: Topic[],
  sentences: Sentence[],
  apiKey: string,
): Promise<TopicBeats[]> {
  const chunks = topics.map((t) => {
    const range = sentences.slice(t.startIdx, t.endIdx + 1);
    const preview = range.map((s) => `[${s.idx}] ${s.text}`).join("\n");
    return { topic: t, preview };
  });
  const raw = await callLovableAi(apiKey, {
    model: "openai/gpt-5.5",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `Você é editor sênior. Para cada tópico, identifique os 4 beats narrativos: hook, setup, climax, conclusion. O clip final vai do hookIdx até conclusionIdx INCLUSIVE.

Regras críticas:
- hookIdx: sentença que funciona como abertura viral (pergunta, provocação, "vou contar", cifra chocante). NUNCA começa em conector ("aí", "então", "porque").
- setupEndIdx: última sentença antes do desenvolvimento principal. Contexto suficiente pra quem chegou agora entender.
- climaxIdx: sentença de maior impacto/tensão/revelação.
- conclusionIdx: sentença que ENCERRA o pensamento (termina em . ! ? sem conector pendente, sem cliffhanger, sem lista pela metade, sem pergunta sem resposta).
- Se a conclusão do tópico NÃO existe dentro do range, marque needsExpansionAfter=true e aponte conclusionIdx pra melhor tentativa dentro do range.
- NUNCA aponte conclusionIdx pra sentença que termina em vírgula, "mas", "então", "porque…" ou "…".
- Retorne SOMENTE JSON: {"beats":[{"topicIndex":N,"hookIdx":N,"setupEndIdx":N,"climaxIdx":N,"conclusionIdx":N,"needsExpansionAfter":false}]}`,
      },
      {
        role: "user",
        content: chunks.map((c, i) => `TÓPICO ${i} (${c.topic.kind}) — "${c.topic.title}"\n${c.preview}`).join("\n\n---\n\n").slice(0, 22000),
      },
    ],
  });
  const parsed = safeParseJson<{ beats?: Array<{ topicIndex: number; hookIdx: number; setupEndIdx: number; climaxIdx: number; conclusionIdx: number; needsExpansionAfter?: boolean }> }>(raw);
  const beats: TopicBeats[] = [];
  for (const b of parsed?.beats ?? []) {
    const topic = topics[b.topicIndex];
    if (!topic) continue;
    const clampIdx = (n: number) => Math.max(topic.startIdx, Math.min(topic.endIdx, Number(n) || topic.startIdx));
    beats.push({
      topic,
      hookIdx: clampIdx(b.hookIdx),
      setupEndIdx: clampIdx(b.setupEndIdx),
      climaxIdx: clampIdx(b.climaxIdx),
      conclusionIdx: clampIdx(b.conclusionIdx),
      needsExpansionAfter: Boolean(b.needsExpansionAfter),
    });
  }
  return beats.length ? beats : topics.map((t) => ({ topic: t, hookIdx: t.startIdx, setupEndIdx: t.startIdx, climaxIdx: Math.floor((t.startIdx + t.endIdx) / 2), conclusionIdx: t.endIdx, needsExpansionAfter: false }));
}

// ---------------- 4. Candidate builder ----------------

const MIN_CLIP = 35;
const IDEAL_MIN = 45;
const IDEAL_MAX = 75;
const HARD_MAX = 110;

type Raw = { hookIdx: number; endIdx: number; kind: Topic["kind"]; title: string; needsExpansion: boolean };

export function buildCandidates(beats: TopicBeats[], sentences: Sentence[]): Raw[] {
  const out: Raw[] = [];
  for (const b of beats) {
    const t0 = sentences[b.hookIdx]?.t0 ?? 0;
    const t1 = sentences[b.conclusionIdx]?.t1 ?? t0 + IDEAL_MIN;
    const dur = t1 - t0;
    if (dur <= HARD_MAX) {
      out.push({ hookIdx: b.hookIdx, endIdx: b.conclusionIdx, kind: b.topic.kind, title: b.topic.title, needsExpansion: b.needsExpansionAfter });
      continue;
    }
    // Longo: quebra em partes com conclusão parcial em pausas naturais.
    // Procura sentenças com endsWithTerminator dentro do range que gerem partes de 45-95s.
    const range = sentences.slice(b.hookIdx, b.conclusionIdx + 1);
    let partStart = b.hookIdx;
    let acc = 0;
    for (let i = 0; i < range.length; i++) {
      const s = range[i];
      acc = s.t1 - sentences[partStart].t0;
      const isClosureLike = s.endsWithTerminator && !s.endsWithConnector && !s.hasCliffhanger;
      if ((acc >= IDEAL_MIN && isClosureLike && acc <= 95) || acc >= 95) {
        out.push({ hookIdx: partStart, endIdx: s.idx, kind: b.topic.kind, title: `${b.topic.title} (parte ${out.length + 1})`, needsExpansion: false });
        partStart = s.idx + 1;
        if (partStart > b.conclusionIdx) break;
      }
    }
    // Se sobrou uma cauda razoável, inclui.
    if (partStart <= b.conclusionIdx) {
      const tailDur = sentences[b.conclusionIdx].t1 - sentences[partStart].t0;
      if (tailDur >= MIN_CLIP) {
        out.push({ hookIdx: partStart, endIdx: b.conclusionIdx, kind: b.topic.kind, title: `${b.topic.title} (parte ${out.length + 1})`, needsExpansion: false });
      }
    }
  }
  return out;
}

// ---------------- 5. Editorial validator + expansion ----------------

export type ValidationFailure = "pending_question" | "pending_list" | "cliffhanger" | "no_terminator" | "connector_end" | "no_setup" | "too_short";

export function validate(candidate: Raw, sentences: Sentence[]): { ok: boolean; failures: ValidationFailure[] } {
  const failures: ValidationFailure[] = [];
  const range = sentences.slice(candidate.hookIdx, candidate.endIdx + 1);
  if (!range.length) return { ok: false, failures: ["too_short"] };
  const last = range[range.length - 1];
  const dur = last.t1 - range[0].t0;

  if (dur < MIN_CLIP - 5) failures.push("too_short");
  if (!last.endsWithTerminator) failures.push("no_terminator");
  if (last.endsWithConnector) failures.push("connector_end");
  if (last.hasCliffhanger) failures.push("cliffhanger");

  // pending question: se a última pergunta do range não teve pelo menos 2 sentenças depois
  for (let i = range.length - 1; i >= 0; i--) {
    if (range[i].hasQuestion && !/^voc[eê]|^e voc[eê]|^entendeu\??$/i.test(range[i].text)) {
      const answerSpan = range.length - 1 - i;
      if (answerSpan < 2) { failures.push("pending_question"); break; }
      break;
    }
  }
  // pending list: se aparecer "três/dois/quatro motivos" e não houver marcadores suficientes depois
  const opener = range.find((s) => s.hasListMarker && /(tr[eê]s|dois|quatro)/i.test(s.text));
  if (opener) {
    const need = /tr[eê]s/i.test(opener.text) ? 3 : /quatro/i.test(opener.text) ? 4 : 2;
    const after = range.slice(range.indexOf(opener) + 1);
    const markers = after.filter((s) => /primeiro|segundo|terceiro|quarto|em primeiro|em segundo|em terceiro/i.test(s.text)).length;
    if (markers + 0 < need - 1) failures.push("pending_list"); // conta o próprio abridor
  }
  // hook não pode ser conector puro
  const hook = range[0];
  if (/^(e|ent[aã]o|a[íi]|porque|mas)\s/i.test(hook.text) && range.length > 1) failures.push("no_setup");

  return { ok: failures.length === 0, failures };
}

export function expandForward(candidate: Raw, sentences: Sentence[], maxExtendSec = 45): Raw | null {
  const start = sentences[candidate.hookIdx];
  if (!start) return null;
  const maxT = start.t0 + HARD_MAX + maxExtendSec;
  let bestIdx = candidate.endIdx;
  for (let i = candidate.endIdx + 1; i < sentences.length; i++) {
    const s = sentences[i];
    if (s.t1 > maxT) break;
    const dur = s.t1 - start.t0;
    if (dur > HARD_MAX + maxExtendSec) break;
    if (s.endsWithTerminator && !s.endsWithConnector && !s.hasCliffhanger) {
      bestIdx = i;
      // Se já temos closure lexical, para.
      if (s.hasClosure) break;
      // Caso contrário continua procurando conclusão mais forte por um pouco mais.
      if (dur >= IDEAL_MAX) break;
    }
  }
  if (bestIdx === candidate.endIdx) return null;
  return { ...candidate, endIdx: bestIdx, needsExpansion: false };
}

// ---------------- 6. Story scorer ----------------

export async function scoreClips(
  candidates: Array<{ raw: Raw; excerpt: string }>,
  apiKey: string,
  brief: string | null,
): Promise<Array<{ scores: NonNullable<SceClip["story_score"]>; title: string; hook: string; reason: string }>> {
  const raw = await callLovableAi(apiKey, {
    model: "openai/gpt-5.5",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `Você é analista de retenção de Shorts/Reels/TikTok. Para cada candidato, pontue de 0 a 10 em: hook, context, clarity, storytelling, curiosity, conclusion, retention, shareability, emotion, informativeness. Também gere um título viral (≤70 caracteres) e um hook curto (≤160). Responda SOMENTE JSON: {"clips":[{"hook":"","context":0,"clarity":0,"storytelling":0,"curiosity":0,"conclusion":0,"retention":0,"shareability":0,"emotion":0,"informativeness":0,"title":"","hook_line":"","reason":""}]}. Uma entrada por candidato, na mesma ordem.`,
      },
      {
        role: "user",
        content: `Briefing: ${brief || "(sem briefing)"}\n\n${candidates.map((c, i) => `#${i} [${c.raw.kind}] "${c.raw.title}"\n${c.excerpt}`).join("\n\n").slice(0, 22000)}`,
      },
    ],
  });
  const parsed = safeParseJson<{ clips?: Array<Record<string, number | string>> }>(raw);
  const list = parsed?.clips ?? [];
  return candidates.map((_, i) => {
    const r = list[i] ?? {};
    const n = (k: string, d = 5) => Math.max(0, Math.min(10, Number(r[k]) || d));
    const scores = {
      hook: n("hook"), context: n("context"), clarity: n("clarity"), storytelling: n("storytelling"),
      curiosity: n("curiosity"), conclusion: n("conclusion"), retention: n("retention"),
      shareability: n("shareability"), emotion: n("emotion"), informativeness: n("informativeness"),
      final: 0,
    };
    // Pesos editoriais: retenção e hook pesam mais.
    scores.final = Math.round(
      (scores.hook * 1.6 + scores.retention * 1.5 + scores.conclusion * 1.3 +
       scores.storytelling * 1.2 + scores.curiosity * 1.1 + scores.shareability * 1.0 +
       scores.emotion * 0.9 + scores.clarity * 0.9 + scores.context * 0.8 +
       scores.informativeness * 0.7) / 12.0 * 10,
    ); // 0-100 aprox
    return {
      scores,
      title: String(r.title || "Corte recomendado").slice(0, 140),
      hook: String(r.hook_line || r.hook || "").slice(0, 260),
      reason: String(r.reason || "Análise editorial multi-dimensional.").slice(0, 220),
    };
  });
}

// ---------------- Orquestrador ----------------

export async function runSemanticClipEngine({
  segments,
  brief,
  targetCount,
  apiKey,
}: {
  segments: Seg[];
  brief: string | null;
  targetCount: number;
  apiKey: string;
}): Promise<SceClip[]> {
  const sentences = normalizeSentences(segments);
  if (sentences.length < 5) throw new Error("SCE: transcrição curta demais");

  const topics = await detectTopics(sentences, apiKey, brief);
  const beats = await extractBeats(topics, sentences, apiKey);
  let candidates = buildCandidates(beats, sentences);

  // Validação + expansão automática.
  const validated: Raw[] = [];
  for (const c of candidates) {
    let cur = c;
    let attempts = 0;
    while (attempts < 2) {
      const v = validate(cur, sentences);
      if (v.ok) { validated.push(cur); break; }
      // Falhou → tenta expandir
      const expanded = expandForward(cur, sentences);
      if (!expanded) break;
      cur = expanded;
      attempts++;
    }
  }
  if (!validated.length) throw new Error("SCE: nenhum candidato passou na validação");

  // Ordena por duração de contexto e pega os N melhores candidates pra scorer.
  const shortlist = validated
    .map((raw) => {
      const range = sentences.slice(raw.hookIdx, raw.endIdx + 1);
      const excerpt = range.map((s) => s.text).join(" ").slice(0, 900);
      return { raw, excerpt };
    })
    .slice(0, Math.max(targetCount * 2, 8));

  const scored = await scoreClips(shortlist, apiKey, brief);

  const clips: SceClip[] = shortlist.map((c, i) => {
    const s = scored[i];
    const range = sentences.slice(c.raw.hookIdx, c.raw.endIdx + 1);
    const start = range[0].t0;
    const end = range[range.length - 1].t1;
    return {
      title: s.title,
      hook: s.hook,
      start_seconds: Math.max(0, Math.floor(start)),
      end_seconds: Math.max(Math.floor(start) + MIN_CLIP, Math.ceil(end)),
      virality_score: Math.max(1, Math.min(100, s.scores.final)),
      transcript_excerpt: c.excerpt.slice(0, 800),
      score_reason: s.reason,
      story_score: s.scores,
      narrative_kind: c.raw.kind,
      expanded: c.raw.needsExpansion,
    };
  });

  clips.sort((a, b) => b.virality_score - a.virality_score);
  return clips.slice(0, Math.max(3, Math.min(targetCount, 10)));
}
