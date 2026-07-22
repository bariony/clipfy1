// Clipfy Sprint 1a — Debug Evidence Emitter.
// Empacota tracks/decisões/switches/links/camera trace + diagnosis heurístico
// e faz upload direto para renders/<job>/debug/*.
// NÃO modifica decisões do reframe. Só observa.

import { request as undiciRequest } from "undici";

const SCHEMA = "sprint1a.v1";

async function putArtifact(uploadBase, jobId, filename, bodyBuffer, log) {
  const url = new URL(uploadBase);
  url.searchParams.set("filename", filename);
  const contentType = filename.endsWith(".mp4")
    ? "video/mp4"
    : filename.endsWith(".jsonl")
      ? "application/x-ndjson"
      : "application/json";
  try {
    const res = await undiciRequest(url.toString(), {
      method: "PUT",
      headers: { "content-type": contentType, "content-length": String(bodyBuffer.length) },
      body: bodyBuffer,
      headersTimeout: 60_000,
      bodyTimeout: 120_000,
    });
    if (res.statusCode >= 300) {
      const txt = await res.body.text().catch(() => "");
      log?.warn?.({ filename, status: res.statusCode, body: txt.slice(0, 200) }, "debug upload falhou");
      return false;
    }
    await res.body.dump().catch(() => {});
    return true;
  } catch (err) {
    log?.warn?.({ filename, err: err?.message }, "debug upload crashou");
    return false;
  }
}

// ---------- helpers ----------
const round = (v, p = 3) => (v == null || Number.isNaN(v) ? v : Number(v.toFixed(p)));

function buildTracksReport(track) {
  const raw = Array.isArray(track?.tracks) ? track.tracks : [];
  const frameW = track?.w ?? 0;
  const rows = raw.map((tr) => {
    const frames = tr.frames || [];
    const first = frames[0]?.t ?? 0;
    const last = frames[frames.length - 1]?.t ?? 0;
    const duration = Math.max(0, last - first);
    const hits = frames.length;
    // gaps: passos entre amostras > 0.4s (a 4fps o step é ~0.25s)
    let gaps = 0;
    let biggestGap = 0;
    for (let i = 1; i < frames.length; i++) {
      const dt = frames[i].t - frames[i - 1].t;
      if (dt > 0.4) {
        gaps += 1;
        if (dt > biggestGap) biggestGap = dt;
      }
    }
    const meanArea = frames.length
      ? frames.reduce((s, f) => s + (f.bbox?.[2] || 0) * (f.bbox?.[3] || 0), 0) / frames.length
      : 0;
    const meanBlur = frames.length
      ? frames.reduce((s, f) => s + (f.blur || 0), 0) / frames.length
      : 0;
    const cxs = frames.map((f) => (f.bbox?.[0] || 0) + (f.bbox?.[2] || 0) / 2);
    const meanCx = cxs.length ? cxs.reduce((a, b) => a + b, 0) / cxs.length : 0;
    return {
      id: tr.id,
      first_t: round(first),
      last_t: round(last),
      duration: round(duration, 2),
      hits,
      gaps,
      biggest_gap: round(biggestGap, 2),
      mean_area: Math.round(meanArea),
      mean_blur: round(meanBlur, 1),
      mean_cx: Math.round(meanCx),
      mean_cx_norm: frameW ? round(meanCx / frameW, 3) : null,
    };
  });

  // Person bins por cx (16 colunas). "Fragmentação" = média de trackIds distintos por bin não-vazio.
  const BIN_COUNT = 16;
  const bins = Array.from({ length: BIN_COUNT }, () => new Set());
  for (const r of rows) {
    if (r.mean_cx_norm == null) continue;
    const b = Math.max(0, Math.min(BIN_COUNT - 1, Math.floor(r.mean_cx_norm * BIN_COUNT)));
    bins[b].add(r.id);
  }
  const personBins = bins
    .map((set, idx) => ({ bin: idx, tracks: [...set] }))
    .filter((b) => b.tracks.length > 0);
  const nonEmpty = personBins.length || 1;
  const totalIds = personBins.reduce((s, b) => s + b.tracks.length, 0);
  const fragmentation_ratio = round(totalIds / nonEmpty, 2);

  return {
    schema: SCHEMA,
    total_tracks: rows.length,
    fragmentation_ratio,
    detector: track?.detector ?? "unknown",
    frame: { w: track?.w ?? 0, h: track?.h ?? 0 },
    sample_fps: track?.fps_sample ?? null,
    tracks: rows,
    person_bins: personBins,
  };
}

function buildLinksReport(reframePlan, turns) {
  if (!reframePlan) return { schema: SCHEMA, links: {}, candidates: {}, agreement_score: null };
  const cleaned = reframePlan.tracks || [];
  const links = reframePlan.speakerLinks || {};
  const frameW = reframePlan.frameW;
  const frameH = reframePlan.frameH;

  // Para heatmap: para cada speaker recompute distribuição de score sobre top-N tracks.
  const speakers = [...new Set((turns || []).map((t) => t.speaker))];
  const candidates = {};
  for (const sp of speakers) {
    const spTurns = (turns || []).filter((t) => t.speaker === sp);
    const totalTalk = spTurns.reduce((s, t) => s + (t.end - t.start), 0) || 1;
    const scored = [];
    for (const tr of cleaned) {
      const first = tr.frames[0].t;
      const last = tr.frames[tr.frames.length - 1].t;
      let overlap = 0;
      let areaSum = 0, areaN = 0, scoreSum = 0, scoreN = 0;
      for (const t of spTurns) {
        const s = Math.max(t.start, first);
        const e = Math.min(t.end, last);
        if (e <= s) continue;
        overlap += e - s;
        // amostra midT
        const mid = (s + e) / 2;
        const fr = tr.frames.reduce((best, f) =>
          Math.abs(f.t - mid) < Math.abs(best.t - mid) ? f : best, tr.frames[0]);
        if (fr?.bbox) {
          areaSum += fr.bbox[2] * fr.bbox[3];
          scoreSum += fr.score || 0;
          areaN += 1; scoreN += 1;
        }
      }
      if (overlap < 0.3) continue;
      const areaNorm = areaN ? (areaSum / areaN) / (frameW * frameH) : 0;
      const meanScore = scoreN ? scoreSum / scoreN : 0;
      const score = 0.55 * (overlap / totalTalk) + 0.25 * Math.min(1, areaNorm * 20) + 0.20 * meanScore;
      scored.push({ track_id: tr.id, score: round(score, 3), overlap: round(overlap, 2), area_norm: round(areaNorm, 4), mean_score: round(meanScore, 2) });
    }
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, 5);
    const sum = top.reduce((s, x) => s + x.score, 0) || 1;
    candidates[sp] = top.map((x) => ({ ...x, share: round(x.score / sum, 3) }));
  }

  // agreement_score = média do share do track escolhido entre os candidatos daquele speaker
  const agreementParts = [];
  for (const [sp, chosenId] of Object.entries(links)) {
    const cs = candidates[sp] || [];
    const hit = cs.find((c) => c.track_id === chosenId);
    if (hit) agreementParts.push(hit.share);
  }
  const agreement_score = agreementParts.length
    ? round(agreementParts.reduce((a, b) => a + b, 0) / agreementParts.length, 3)
    : null;

  return { schema: SCHEMA, links, candidates, agreement_score };
}

function turnAt(turns, t) {
  for (const tu of turns || []) {
    if (t >= tu.start && t <= tu.end) return tu.speaker;
  }
  return null;
}

function buildDecisionsAndSwitches(reframePlan, turns) {
  const decisions = [];
  const switches = [];
  if (!reframePlan) return { decisions, switches };
  const path = reframePlan.cameraPath || [];
  const links = reframePlan.speakerLinks || {};
  let lastTrack = null;
  let lastT = null;
  for (const p of path) {
    const spk = turnAt(turns, p.t);
    const linkedTrack = spk != null ? (links[spk] ?? null) : null;
    decisions.push({
      t: round(p.t, 3),
      chosen_track: p.trackId ?? null,
      chosen_score: p.score ?? null,
      bbox: p.bbox ?? null,
      reason: p.reason ?? null,
      speaker: spk,
      speaker_linked_track: linkedTrack,
      speaker_agrees_camera: linkedTrack != null && p.trackId != null ? linkedTrack === p.trackId : null,
    });
    if (p.reason === "switch" && lastTrack != null && p.trackId !== lastTrack) {
      switches.push({
        t: round(p.t, 3),
        from_track: lastTrack,
        to_track: p.trackId,
        delta_t_since_last_switch: lastT != null ? round(p.t - lastT, 3) : null,
        speaker_at_t: spk,
        speaker_linked_track: linkedTrack,
        speaker_change_triggered: linkedTrack === p.trackId,
      });
      lastT = p.t;
    }
    if (p.trackId != null) lastTrack = p.trackId;
  }
  return { decisions, switches };
}

function buildCameraTrace(reframePlan) {
  if (!reframePlan) return [];
  return (reframePlan.cameraPath || []).map((p) => ({
    t: round(p.t, 3),
    track: p.trackId ?? null,
    cam: p.cam
      ? {
          x: Math.round(p.cam.sliceX),
          y: Math.round(p.cam.sliceY),
          w: Math.round(p.cam.sliceW),
          h: Math.round(p.cam.sliceH),
          cx: Math.round(p.cam.sliceX + p.cam.sliceW / 2),
        }
      : null,
    reason: p.reason ?? null,
  }));
}

function buildDiagnosis({ tracksReport, linksReport, decisions, switches, turns, duration }) {
  const evidence = [];
  const componentScores = {
    tracker: { health: 1, issues: [] },
    diarization: { health: 1, issues: [] },
    speaker_linking: { health: 1, issues: [] },
    camera_controller: { health: 1, issues: [] },
  };

  // ---------- Tracker ----------
  const frag = tracksReport?.fragmentation_ratio ?? 1;
  const shortLived = (tracksReport?.tracks || []).filter((t) => t.duration < 1.0);
  const shortPct = tracksReport?.tracks?.length ? shortLived.length / tracksReport.tracks.length : 0;
  if (frag > 1.6) {
    componentScores.tracker.health -= 0.35;
    componentScores.tracker.issues.push(`fragmentation_ratio=${frag} (>1.6)`);
    evidence.push(`Tracker: fragmentação alta (${frag}) — vários IDs para regiões próximas.`);
  }
  if (shortPct > 0.4) {
    componentScores.tracker.health -= 0.25;
    componentScores.tracker.issues.push(`${Math.round(shortPct * 100)}% dos tracks vivem <1s`);
    evidence.push(`Tracker: ${Math.round(shortPct * 100)}% dos tracks vivem menos de 1s (rostos "piscando").`);
  }

  // ---------- Diarization ----------
  const shortTurns = (turns || []).filter((t) => t.end - t.start < 0.5);
  const shortTurnsPct = turns?.length ? shortTurns.length / turns.length : 0;
  if (shortTurnsPct > 0.3) {
    componentScores.diarization.health -= 0.3;
    componentScores.diarization.issues.push(`${Math.round(shortTurnsPct * 100)}% dos turnos <500ms`);
    evidence.push(`Diarização: ${Math.round(shortTurnsPct * 100)}% dos turnos <500ms (possível over-splitting).`);
  }
  const talkTime = (turns || []).reduce((s, t) => s + (t.end - t.start), 0);
  const silentRatio = duration > 0 ? 1 - talkTime / duration : 0;
  if (silentRatio > 0.5) {
    componentScores.diarization.health -= 0.15;
    componentScores.diarization.issues.push(`${Math.round(silentRatio * 100)}% do tempo sem speaker`);
    evidence.push(`Diarização: ${Math.round(silentRatio * 100)}% do clipe não tem speaker atribuído.`);
  }

  // ---------- Speaker Linking ----------
  const agreement = linksReport?.agreement_score;
  if (agreement != null && agreement < 0.55) {
    componentScores.speaker_linking.health -= 0.4;
    componentScores.speaker_linking.issues.push(`agreement_score=${agreement}`);
    evidence.push(`Linking: escolha do track para cada speaker é fraca (agreement=${agreement}).`);
  }
  // Speakers com >=2 candidatos fortes
  const contested = Object.entries(linksReport?.candidates || {}).filter(([, cands]) => {
    const strong = (cands || []).filter((c) => c.share > 0.25).length;
    return strong >= 2;
  });
  if (contested.length > 0) {
    componentScores.speaker_linking.health -= 0.25;
    componentScores.speaker_linking.issues.push(`speakers disputados: ${contested.map(([s]) => s).join(", ")}`);
    evidence.push(`Linking: ${contested.length} speaker(s) com múltiplos candidatos fortes → provável confusão de identidade.`);
  }

  // ---------- Camera Controller ----------
  const totalSwitches = switches.length;
  const switchesWithoutSpeakerChange = switches.filter(
    (s) => s.speaker_at_t != null && s.speaker_linked_track != null && s.speaker_linked_track !== s.to_track,
  ).length;
  const badSwitchRatio = totalSwitches > 0 ? switchesWithoutSpeakerChange / totalSwitches : 0;
  const switchesPerMin = duration > 0 ? (totalSwitches / duration) * 60 : 0;
  if (switchesPerMin > 20) {
    componentScores.camera_controller.health -= 0.2;
    componentScores.camera_controller.issues.push(`${switchesPerMin.toFixed(1)} switches/min (agitado)`);
    evidence.push(`Câmera: ${switchesPerMin.toFixed(1)} trocas por minuto — histerese pode estar frouxa.`);
  }
  if (badSwitchRatio > 0.3 && totalSwitches >= 3) {
    componentScores.camera_controller.health -= 0.15;
    componentScores.camera_controller.issues.push(`${Math.round(badSwitchRatio * 100)}% dos switches destoam do speaker`);
    evidence.push(`Câmera/Linking: ${Math.round(badSwitchRatio * 100)}% dos switches vão contra o speaker linkado.`);
  }

  // Ordem de prioridade: Linking > Tracker > Diarization > Controller
  const priority = ["speaker_linking", "tracker", "diarization", "camera_controller"];
  const scored = priority
    .map((k) => ({ k, deficit: 1 - Math.max(0, componentScores[k].health) }))
    .sort((a, b) => b.deficit - a.deficit);
  const worst = scored[0];
  const primary_culprit = worst && worst.deficit > 0.15 ? worst.k : "inconclusive";
  const confidence = worst ? Math.min(0.95, Math.max(0.3, worst.deficit + 0.2)) : 0.3;

  // clamp
  for (const k of Object.keys(componentScores)) {
    componentScores[k].health = Math.max(0, round(componentScores[k].health, 2));
  }

  return {
    schema: SCHEMA,
    primary_culprit,
    confidence: round(confidence, 2),
    evidence,
    component_scores: componentScores,
    stats: {
      total_switches: totalSwitches,
      switches_per_minute: round(switchesPerMin, 2),
      bad_switch_ratio: round(badSwitchRatio, 2),
      agreement_score: agreement,
      fragmentation_ratio: frag,
    },
    notes: [
      "Heurística versão sprint1a.v1. Não é ground truth — só orienta a próxima hipótese a testar.",
      "Não substitua a diarização por esta avaliação. Confirme visualmente antes de mudar código.",
    ],
  };
}

// ---------- entrypoint ----------
export async function emitDebugArtifacts({
  jobId,
  uploadBase,
  workerLog,
  track,
  turns,
  speakers,
  reframePlan,
  pipelineStatus,
  clipStart,
  clipEnd,
  duration,
  version,
}) {
  const tracksReport = buildTracksReport(track);
  const linksReport = buildLinksReport(reframePlan, turns);
  const { decisions, switches } = buildDecisionsAndSwitches(reframePlan, turns);
  const cameraTrace = buildCameraTrace(reframePlan);

  // Sprint 1a — se o pipeline não rodou de verdade, o diagnóstico heurístico
  // é ruído. Emitimos um veredito explícito de invalid_pipeline_run.
  const pipelineOk =
    pipelineStatus?.face_tracker?.status === "success" &&
    pipelineStatus?.reframe_plan?.status === "success" &&
    (track?.w ?? 0) > 0 &&
    (track?.tracks?.length ?? 0) > 0;

  let diagnosis;
  if (!pipelineOk) {
    diagnosis = {
      schema: SCHEMA,
      status: "invalid_pipeline_run",
      primary_culprit: "reframe_bootstrap_failure",
      camera_diagnosis_available: false,
      confidence: 1,
      pipeline_status: pipelineStatus ?? null,
      evidence: [
        `face_tracker.status=${pipelineStatus?.face_tracker?.status ?? "unknown"}` +
          (pipelineStatus?.face_tracker?.error ? ` (${pipelineStatus.face_tracker.error})` : ""),
        `diarize.status=${pipelineStatus?.diarize?.status ?? "unknown"}` +
          (pipelineStatus?.diarize?.error ? ` (${pipelineStatus.diarize.error})` : ""),
        `reframe_plan.status=${pipelineStatus?.reframe_plan?.status ?? "unknown"}` +
          (pipelineStatus?.reframe_plan?.error ? ` (${pipelineStatus.reframe_plan.error})` : ""),
        `frame=${track?.w ?? 0}x${track?.h ?? 0}, detector=${track?.detector ?? "unknown"}, raw_tracks=${track?.tracks?.length ?? 0}`,
      ],
      notes: [
        "O pipeline de reframe não executou. A qualidade do enquadramento NÃO pode ser avaliada.",
        "Investigue os campos error/stage/stderr_tail de pipeline_status antes de tocar em qualquer heurística.",
      ],
    };
  } else {
    diagnosis = buildDiagnosis({ tracksReport, linksReport, decisions, switches, turns, duration });
    diagnosis.status = "valid";
    diagnosis.camera_diagnosis_available = true;
    diagnosis.pipeline_status = pipelineStatus ?? null;
  }

  const manifest = {
    schema: SCHEMA,
    job_id: jobId,
    worker_version: version,
    generated_at: new Date().toISOString(),
    clip: { start: clipStart, end: clipEnd, duration },
    frame: { w: track?.w ?? 0, h: track?.h ?? 0 },
    detector: track?.detector ?? "unknown",
    speakers,
    pipeline_status: pipelineStatus ?? null,
    pipeline_ok: pipelineOk,
    counts: {
      raw_tracks: track?.tracks?.length ?? 0,
      kept_tracks: reframePlan?.tracks?.length ?? 0,
      turns: turns?.length ?? 0,
      decisions: decisions.length,
      switches: switches.length,
    },
  };

  const enc = (obj) => Buffer.from(JSON.stringify(obj, null, 2));
  const encL = (rows) => Buffer.from(rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

  const artifacts = [
    ["manifest.json", enc(manifest)],
    ["tracks_report.json", enc(tracksReport)],
    ["links_report.json", enc(linksReport)],
    ["switches.json", enc({ schema: SCHEMA, switches })],
    ["decisions.jsonl", encL(decisions)],
    ["camera_trace.jsonl", encL(cameraTrace)],
    ["diagnosis.json", enc(diagnosis)],
    ["pipeline_status.json", enc({ schema: SCHEMA, pipeline_status: pipelineStatus ?? null, pipeline_ok: pipelineOk })],
  ];

  const uploaded = [];
  for (const [name, body] of artifacts) {
    const ok = await putArtifact(uploadBase, jobId, name, body, workerLog);
    if (ok) uploaded.push(name);
  }
  workerLog?.info?.(
    { jobId, uploaded, status: diagnosis.status, culprit: diagnosis.primary_culprit, confidence: diagnosis.confidence, pipeline_ok: pipelineOk },
    "debug artifacts emitted",
  );
  return { uploaded, diagnosis, pipelineOk };
}

