// Clipfy Auto-Reframe v2 — plano de câmera global inspirado no OpusClip.
//
// Consome:
//   track = { w, h, duration, fps_sample, frames:[...], tracks:[{id, frames:[{t,bbox,score,blur,size_ratio}]}], shots, splits }
//   turns = [{start, end, speaker}]  (pyannote 3.1)
//
// Produz um plano completo para o vídeo inteiro:
//   {
//     tracks: [...]                          // tracks limpos (candidatos válidos)
//     speakerLinks: { speaker: trackId }     // amarração global speaker↔rosto
//     podcast: boolean                       // podcast mode auto-detectado
//     dialogueWindows: [{t0,t1,trackIds}]    // janelas com diálogo real
//     sampleAt(t) -> { trackId, bbox, cx, cy, zoom, layout, confidence, reason }
//   }
//
// O sampleAt() é o único ponto que o buildSceneFilter precisa consumir.

const LOG_PREFIX = "[reframe]";

// ---------- Utilidades ----------
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;

function bboxCenter(b) {
  return { cx: b[0] + b[2] / 2, cy: b[1] + b[3] / 2 };
}
function bboxArea(b) { return b[2] * b[3]; }

// Interpola bbox linearmente entre duas amostras.
function interpBbox(fa, fb, t) {
  const span = Math.max(1e-6, fb.t - fa.t);
  const u = clamp((t - fa.t) / span, 0, 1);
  return [
    lerp(fa.bbox[0], fb.bbox[0], u),
    lerp(fa.bbox[1], fb.bbox[1], u),
    lerp(fa.bbox[2], fb.bbox[2], u),
    lerp(fa.bbox[3], fb.bbox[3], u),
  ];
}

// Retorna bbox do track em tempo t, ou null se fora da faixa (com tolerância).
function trackBboxAt(track, t, tolerance = 0.5) {
  const frames = track.frames;
  if (!frames.length) return null;
  if (t < frames[0].t - tolerance || t > frames[frames.length - 1].t + tolerance) return null;
  if (t <= frames[0].t) return { bbox: frames[0].bbox, score: frames[0].score, size_ratio: frames[0].size_ratio, exact: false };
  if (t >= frames[frames.length - 1].t) {
    const last = frames[frames.length - 1];
    return { bbox: last.bbox, score: last.score, size_ratio: last.size_ratio, exact: false };
  }
  // busca binária
  let lo = 0, hi = frames.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= t) lo = mid; else hi = mid;
  }
  const bbox = interpBbox(frames[lo], frames[hi], t);
  return { bbox, score: (frames[lo].score + frames[hi].score) / 2, size_ratio: frames[lo].size_ratio, exact: true };
}

// ---------- Candidate Filter ----------
// Remove tracks que são claramente falsos: pequenos demais, blur baixíssimo
// e estáticos (pôster, TV, foto), ou aparições muito curtas.
export function filterCandidates(rawTracks, log) {
  if (!Array.isArray(rawTracks)) return [];
  const kept = [];
  const rejected = [];
  for (const tr of rawTracks) {
    const frames = tr.frames || [];
    if (frames.length < 3) { rejected.push({ id: tr.id, why: "too_few_frames", n: frames.length }); continue; }
    const duration = frames[frames.length - 1].t - frames[0].t;
    if (duration < 1.0) { rejected.push({ id: tr.id, why: "short_life", dur: duration }); continue; }
    const meanSize = frames.reduce((s, f) => s + (f.size_ratio || 0), 0) / frames.length;
    if (meanSize < 0.06) { rejected.push({ id: tr.id, why: "too_small", size: meanSize }); continue; }
    // "estático + baixa nitidez" → pôster/foto
    const cxs = frames.map((f) => f.bbox[0] + f.bbox[2] / 2);
    const meanCx = cxs.reduce((s, v) => s + v, 0) / cxs.length;
    const varCx = cxs.reduce((s, v) => s + (v - meanCx) ** 2, 0) / cxs.length;
    const meanBlur = frames.reduce((s, f) => s + (f.blur || 0), 0) / frames.length;
    if (duration > 8 && varCx < 4 && meanBlur < 25) {
      rejected.push({ id: tr.id, why: "static_low_sharpness", meanBlur, varCx });
      continue;
    }
    kept.push(tr);
  }
  if (log && rejected.length) log.info({ rejected: rejected.slice(0, 10), total_rejected: rejected.length, kept: kept.length }, `${LOG_PREFIX} candidate filter`);
  return kept;
}

// ---------- Speaker ↔ Track Linking ----------
// Para cada speaker, escolhe o track que mais coexiste enquanto ele fala,
// pesando área do rosto, confiança de detecção e consistência temporal.
export function linkSpeakersToTracks(tracks, turns, frameW, frameH, log) {
  const links = {};
  if (!tracks?.length || !turns?.length) return links;

  // Pré-calcula para cada track uma função rápida de "estava visível em [t0,t1]?"
  const trackSummary = tracks.map((tr) => {
    const first = tr.frames[0].t;
    const last = tr.frames[tr.frames.length - 1].t;
    return { tr, first, last };
  });

  const speakersOrdered = [...new Set(turns.map((t) => t.speaker))]
    .map((sp) => ({ speaker: sp, talk: turns.filter((t) => t.speaker === sp).reduce((s, t) => s + (t.end - t.start), 0) }))
    .sort((a, b) => b.talk - a.talk);

  const usedTracks = new Set();
  const detail = [];
  for (const { speaker } of speakersOrdered) {
    const spTurns = turns.filter((t) => t.speaker === speaker);
    let best = null;
    const scores = [];
    for (const { tr, first, last } of trackSummary) {
      if (usedTracks.has(tr.id)) continue;
      let overlap = 0;
      let areaSum = 0, areaN = 0, scoreSum = 0, scoreN = 0;
      let turnsWithTrack = 0;
      for (const t of spTurns) {
        const s = Math.max(t.start, first);
        const e = Math.min(t.end, last);
        if (e <= s) continue;
        overlap += e - s;
        turnsWithTrack += 1;
        // amostra a área do track no meio do turno
        const midT = (s + e) / 2;
        const at = trackBboxAt(tr, midT);
        if (at) { areaSum += bboxArea(at.bbox); areaN += 1; scoreSum += at.score; scoreN += 1; }
      }
      if (overlap < 0.5) continue; // ignora tracks que mal coexistem
      const meanArea = areaN ? areaSum / areaN : 0;
      const meanScore = scoreN ? scoreSum / scoreN : 0;
      const consistency = spTurns.length ? turnsWithTrack / spTurns.length : 0;
      const areaNorm = meanArea / (frameW * frameH); // 0..1
      const score =
        0.55 * (overlap / Math.max(1, spTurns.reduce((s, t) => s + (t.end - t.start), 0))) +
        0.25 * clamp(areaNorm * 20, 0, 1) +
        0.10 * meanScore +
        0.10 * consistency;
      scores.push({ trackId: tr.id, score: +score.toFixed(3), overlap: +overlap.toFixed(2), areaNorm: +areaNorm.toFixed(4), meanScore: +meanScore.toFixed(2), consistency: +consistency.toFixed(2) });
      if (!best || score > best.score) best = { trackId: tr.id, score };
    }
    if (best) {
      links[speaker] = best.trackId;
      usedTracks.add(best.trackId);
      detail.push({ speaker, chosen: best.trackId, chosen_score: +best.score.toFixed(3), candidates: scores.sort((a, b) => b.score - a.score).slice(0, 3) });
    } else {
      detail.push({ speaker, chosen: null });
    }
  }
  if (log) log.info({ links, detail }, `${LOG_PREFIX} speaker↔track linking`);
  return links;
}

// ---------- Podcast Mode ----------
export function detectPodcastMode(tracks, turns, duration, log) {
  const speakers = new Set(turns?.map((t) => t.speaker) || []);
  if (speakers.size < 2 || speakers.size > 4) { if (log) log.info({ speakers: speakers.size }, `${LOG_PREFIX} podcast=false speakers`); return false; }
  // Movimento médio dos tracks — média do desvio-padrão do cx dividido pela largura.
  let mv = 0, n = 0;
  for (const tr of tracks) {
    if (tr.frames.length < 5) continue;
    const cxs = tr.frames.map((f) => f.bbox[0] + f.bbox[2] / 2);
    const mean = cxs.reduce((s, v) => s + v, 0) / cxs.length;
    const std = Math.sqrt(cxs.reduce((s, v) => s + (v - mean) ** 2, 0) / cxs.length);
    mv += std; n += 1;
  }
  const meanStd = n ? mv / n : 0;
  const movementRatio = meanStd / Math.max(1, tracks[0]?.frames?.[0]?.bbox?.[2] || 1) * 0.1; // heurística
  const podcast = duration > 15 && meanStd < 40; // <40px std → pessoas quase paradas
  if (log) log.info({ speakers: speakers.size, meanStd: +meanStd.toFixed(1), duration, podcast }, `${LOG_PREFIX} podcast mode`);
  return podcast;
}

// ---------- Turn lookup ----------
function speakerAt(turns, t) {
  // Retorna array (pode ter overlap em raros casos).
  const active = [];
  for (const tr of turns) if (t >= tr.start && t <= tr.end) active.push(tr.speaker);
  return active;
}

// ---------- Active Speaker Scorer ----------
// Para cada tempo t, retorna { trackId, score, runnerUp }.
function scoreTracks(t, tracks, turns, links, historyStabByTrack) {
  const active = speakerAt(turns, t);
  const speakerTracks = new Set(active.map((sp) => links[sp]).filter((x) => x !== undefined));
  const scores = [];
  for (const tr of tracks) {
    const at = trackBboxAt(tr, t, 0.6);
    if (!at) continue;
    const speakerActivity = speakerTracks.has(tr.id) ? 1.0 : 0.0;
    // relative face area (0..1): normaliza por bbox máximo esperado (30% do quadro)
    const areaRel = clamp((at.bbox[2] * at.bbox[3]) / (0.15 * 1920 * 1080), 0, 1);
    // persistência: quanto tempo o track já existe até t
    const persistence = clamp((t - tr.frames[0].t) / 3.0, 0, 1);
    const confidence = clamp(at.score, 0, 1);
    const stability = historyStabByTrack.get(tr.id) ?? 0.5; // 0..1, calc no smoother
    const score =
      0.40 * speakerActivity +
      0.25 * areaRel +
      0.15 * persistence +
      0.10 * confidence +
      0.10 * stability;
    scores.push({ trackId: tr.id, score, bbox: at.bbox, speakerActivity });
  }
  scores.sort((a, b) => b.score - a.score);
  return { top: scores[0] ?? null, runnerUp: scores[1] ?? null, all: scores };
}

// ---------- Framer ----------
// Recebe bbox no espaço original (frameW x frameH) e devolve a janela de crop
// no espaço 1920x1080 (norm 16:9) que vai virar 1080x1920 no output.
export function frame9x16(bbox, frameW, frameH, opts = {}) {
  const OUT_W = 1080, OUT_H = 1920;
  const targetFaceRatio = opts.faceRatio ?? 0.26; // rosto ocupa ~26% da altura do output
  // Bbox no espaço original
  const { cx, cy } = bboxCenter(bbox);
  const faceH = bbox[3];
  // sliceH: altura recortada no vídeo original que quando escalada para 1920 faz o rosto = targetFaceRatio*1920
  const desiredSliceH = clamp(faceH / targetFaceRatio, frameH * 0.35, frameH);
  const desiredSliceW = desiredSliceH * (OUT_W / OUT_H); // 9/16
  // Posição vertical: olhos ~1/3 do topo do output. Olhos ~35% do topo do bbox.
  const eyesY = cy - faceH * 0.15;
  // no output, eyesY_out = 1920 * 0.36
  // eyesY_out = (eyesY - sliceY) * (1920 / sliceH)
  // → sliceY = eyesY - 0.36 * sliceH
  let sliceY = eyesY - 0.36 * desiredSliceH;
  let sliceX = cx - desiredSliceW / 2;
  let sliceW = desiredSliceW;
  let sliceH = desiredSliceH;
  // Safe margins: se cortar testa ou queixo, aumenta o slice
  const topPad = eyesY - sliceY; // deve ser positivo, e cabeça (~0.5*faceH acima dos olhos) deve caber
  const need = faceH * 0.65;
  if (topPad < need) sliceY = eyesY - need;
  // Clamp aos limites do frame
  sliceX = clamp(sliceX, 0, frameW - sliceW);
  sliceY = clamp(sliceY, 0, frameH - sliceH);
  // Se o slice não cabe no frame, reduz (mantém aspect)
  if (sliceW > frameW || sliceH > frameH) {
    const k = Math.min(frameW / sliceW, frameH / sliceH);
    sliceW *= k; sliceH *= k;
    sliceX = clamp(cx - sliceW / 2, 0, frameW - sliceW);
    sliceY = clamp(sliceY, 0, frameH - sliceH);
  }
  return {
    sliceX: Math.round(sliceX),
    sliceY: Math.round(sliceY),
    sliceW: Math.round(sliceW),
    sliceH: Math.round(sliceH),
    cx: Math.round(cx),
    cy: Math.round(cy),
  };
}

// ---------- Camera Controller (EMA + hysteresis + velocity cap) ----------
export function buildActivePath({ tracks, turns, links, duration, podcast, log }) {
  // Amostra a cada 100ms.
  const dt = 0.1;
  const HYS_MS = podcast ? 900 : 600;
  const MIN_MARGIN = 0.12; // vantagem exigida do concorrente
  const MIN_SCORE = 0.32;
  const historyStab = new Map(); // trackId -> stability score

  const raw = []; // { t, trackId, score, bbox, reason }
  let currentTrack = null;
  let contenderTrack = null;
  let contenderSince = null;
  let lastLog = -1;

  for (let t = 0; t <= duration; t += dt) {
    const t_ = +t.toFixed(3);
    const { top, runnerUp, all } = scoreTracks(t_, tracks, turns, links, historyStab);
    if (!top) {
      // sem detecção — mantém último
      raw.push({ t: t_, trackId: currentTrack, score: 0, bbox: null, reason: "no_detection" });
      continue;
    }
    // Inicial
    if (currentTrack == null) {
      currentTrack = top.trackId;
      raw.push({ t: t_, trackId: currentTrack, score: +top.score.toFixed(3), bbox: top.bbox, reason: "initial" });
      continue;
    }
    // Score do track atual
    const currentEntry = all.find((s) => s.trackId === currentTrack);
    const currentScore = currentEntry ? currentEntry.score : 0;
    const bboxNow = currentEntry ? currentEntry.bbox : (trackBboxAt(tracks.find((tr) => tr.id === currentTrack) || {}, t_)?.bbox ?? null);

    // Concorrente supera com margem?
    if (top.trackId !== currentTrack && top.score - currentScore >= MIN_MARGIN && top.score >= MIN_SCORE) {
      if (contenderTrack !== top.trackId) {
        contenderTrack = top.trackId;
        contenderSince = t_;
      }
      const held = (t_ - contenderSince) * 1000;
      if (held >= HYS_MS) {
        // troca!
        if (log && t_ - lastLog > 0.5) {
          log.info({ t: t_, from: currentTrack, to: top.trackId, from_score: +currentScore.toFixed(3), to_score: +top.score.toFixed(3), held_ms: Math.round(held) }, `${LOG_PREFIX} switch`);
          lastLog = t_;
        }
        currentTrack = top.trackId;
        contenderTrack = null; contenderSince = null;
        raw.push({ t: t_, trackId: currentTrack, score: +top.score.toFixed(3), bbox: top.bbox, reason: "switch" });
        continue;
      }
      // ainda em espera
      raw.push({ t: t_, trackId: currentTrack, score: +currentScore.toFixed(3), bbox: bboxNow, reason: `wait_${Math.round(held)}ms` });
    } else {
      contenderTrack = null; contenderSince = null;
      raw.push({ t: t_, trackId: currentTrack, score: +currentScore.toFixed(3), bbox: bboxNow, reason: "hold" });
    }
  }

  return raw;
}

// ---------- Camera path smoothing ----------
export function smoothCameraPath(activePath, tracks, frameW, frameH, podcast) {
  // Para cada amostra, calcula frame(bbox) → alvo (sliceX, sliceY, sliceW, sliceH)
  // Depois aplica EMA + limite de velocidade.
  const V_MAX_RATIO_PER_S = podcast ? 0.04 : 0.08; // % da largura por segundo
  const Z_MAX_RATIO_PER_S = 0.15;                  // zoom (sliceW) por segundo
  const V_MAX = V_MAX_RATIO_PER_S * frameW;
  const dt = activePath.length > 1 ? activePath[1].t - activePath[0].t : 0.1;

  const raw = [];
  for (const s of activePath) {
    if (!s.bbox) { raw.push({ ...s, target: null }); continue; }
    const target = frame9x16(s.bbox, frameW, frameH, { faceRatio: podcast ? 0.24 : 0.28 });
    raw.push({ ...s, target });
  }

  // Fill nulls with nearest neighbor
  for (let i = 0; i < raw.length; i++) {
    if (raw[i].target) continue;
    // busca anterior/posterior
    let prev = null, next = null;
    for (let j = i - 1; j >= 0; j--) if (raw[j].target) { prev = raw[j]; break; }
    for (let j = i + 1; j < raw.length; j++) if (raw[j].target) { next = raw[j]; break; }
    raw[i].target = (prev?.target || next?.target) ?? null;
  }

  // Smooth com EMA + velocity clamp
  let state = null; // {sliceX, sliceY, sliceW, sliceH}
  const smoothed = [];
  for (const s of raw) {
    if (!s.target) { smoothed.push({ ...s, cam: null }); continue; }
    if (!state) {
      state = { ...s.target };
      smoothed.push({ ...s, cam: { ...state } });
      continue;
    }
    // deadzone: se erro < 2% da largura, não mexe
    const err = {
      x: s.target.sliceX - state.sliceX,
      y: s.target.sliceY - state.sliceY,
      w: s.target.sliceW - state.sliceW,
      h: s.target.sliceH - state.sliceH,
    };
    const deadX = frameW * 0.015;
    const deadY = frameH * 0.02;
    // Passo com EMA
    const k = podcast ? 0.10 : 0.16;
    let stepX = Math.abs(err.x) < deadX ? 0 : err.x * k;
    let stepY = Math.abs(err.y) < deadY ? 0 : err.y * k;
    let stepW = err.w * k * 0.6;
    let stepH = err.h * k * 0.6;
    // Velocity cap
    const maxStepXY = V_MAX * dt;
    stepX = clamp(stepX, -maxStepXY, maxStepXY);
    stepY = clamp(stepY, -maxStepXY, maxStepXY);
    const maxStepW = Z_MAX_RATIO_PER_S * frameW * dt;
    stepW = clamp(stepW, -maxStepW, maxStepW);
    stepH = clamp(stepH, -maxStepW * (frameH / frameW), maxStepW * (frameH / frameW));
    state.sliceX += stepX;
    state.sliceY += stepY;
    state.sliceW += stepW;
    state.sliceH += stepH;
    // Snap em shot boundary: se reason === 'switch' e diferença enorme, teleporta
    if (s.reason === "switch" && Math.abs(err.x) > frameW * 0.25) {
      state = { ...s.target };
    }
    smoothed.push({ ...s, cam: { sliceX: state.sliceX, sliceY: state.sliceY, sliceW: state.sliceW, sliceH: state.sliceH } });
  }
  return smoothed;
}

// ---------- Dialogue Detector ----------
export function detectDialogueWindows(turns, links, podcast) {
  if (!turns?.length) return [];
  const WIN = 4.0; // segundos
  const step = 0.5;
  const min_alt = podcast ? 4 : 3;
  const min_share = 0.25;
  const windows = [];
  const tEnd = turns[turns.length - 1].end;
  let lastPushEnd = -1;
  for (let t = 0; t < tEnd; t += step) {
    const t0 = t, t1 = t + WIN;
    const speakers = new Map();
    let alternations = 0;
    let prev = null;
    for (const tu of turns) {
      const s = Math.max(t0, tu.start), e = Math.min(t1, tu.end);
      if (e <= s) continue;
      speakers.set(tu.speaker, (speakers.get(tu.speaker) || 0) + (e - s));
      if (prev && prev !== tu.speaker) alternations += 1;
      prev = tu.speaker;
    }
    if (speakers.size !== 2) continue;
    const shares = [...speakers.values()].map((v) => v / WIN);
    if (shares.every((sh) => sh >= min_share) && alternations >= min_alt) {
      if (t0 < lastPushEnd) {
        windows[windows.length - 1].t1 = t1;
      } else {
        const trackIds = [...speakers.keys()].map((sp) => links[sp]).filter((x) => x !== undefined);
        windows.push({ t0, t1, trackIds });
      }
      lastPushEnd = t1;
    }
  }
  return windows;
}

// ---------- Plano final ----------
export function buildReframePlan({ track, turns, log }) {
  if (!track || !track.tracks || !track.w) return null;
  const frameW = track.w, frameH = track.h;
  const duration = track.duration || (track.frames?.[track.frames.length - 1]?.t ?? 0) + 1;
  const cleaned = filterCandidates(track.tracks, log);
  const links = linkSpeakersToTracks(cleaned, turns || [], frameW, frameH, log);
  const podcast = detectPodcastMode(cleaned, turns || [], duration, log);
  const activePath = buildActivePath({ tracks: cleaned, turns: turns || [], links, duration, podcast, log });
  const cameraPath = smoothCameraPath(activePath, cleaned, frameW, frameH, podcast);
  const dialogueWindows = detectDialogueWindows(turns || [], links, podcast);

  // Métricas de sumário
  const switches = activePath.filter((p) => p.reason === "switch").length;
  const avgInter = switches > 1 ? duration / switches : duration;
  if (log) log.info({ duration: +duration.toFixed(2), switches, avgIntervalBetweenSwitches: +avgInter.toFixed(2), podcast, dialogueWindows: dialogueWindows.length, links, tracks_kept: cleaned.length }, `${LOG_PREFIX} plan summary`);

  return {
    frameW, frameH, duration,
    tracks: cleaned,
    speakerLinks: links,
    podcast,
    dialogueWindows,
    cameraPath,
    sampleAt(t) {
      if (!cameraPath.length) return null;
      // busca binária
      if (t <= cameraPath[0].t) return cameraPath[0];
      if (t >= cameraPath[cameraPath.length - 1].t) return cameraPath[cameraPath.length - 1];
      let lo = 0, hi = cameraPath.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (cameraPath[mid].t <= t) lo = mid; else hi = mid;
      }
      return cameraPath[lo];
    },
    // Retorna todas as amostras que caem dentro [t0,t1]
    sliceRange(t0, t1) {
      return cameraPath.filter((s) => s.t >= t0 - 0.05 && s.t <= t1 + 0.05);
    },
    isDialogue(t0, t1) {
      const dur = Math.max(0.001, t1 - t0);
      let overlap = 0;
      for (const w of dialogueWindows) {
        const s = Math.max(t0, w.t0); const e = Math.min(t1, w.t1);
        if (e > s) overlap += e - s;
      }
      return overlap / dur >= 0.6;
    },
  };
}
