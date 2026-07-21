# Sprint 1a — Modo Diagnóstico do Auto-Reframe

Objetivo: coletar evidência sobre por que a câmera enquadra a pessoa errada. **Sem modificar o algoritmo.**

## Como ligar

1. No banco, marque o projeto: `UPDATE projects SET debug_reframe = true WHERE id = '<uuid>'` — ou use o toggle "Diagnóstico de câmera" no editor do projeto.
2. Rode um render do projeto normalmente (novo clip ou "Tentar de novo" em um existente).
3. Ao terminar, os artefatos estarão em `renders/<job_id>/debug/`.

## Artefatos emitidos por job

| Arquivo | O que contém |
|---|---|
| `manifest.json` | Metadados: worker version, timestamps, duração do clipe, resolução original, contagem de tracks/turns |
| `tracks_report.json` | Por track: duração, hits, gaps, tempo total, área média, blur médio; `fragmentation_ratio` global; mapa `person_bin_x → [trackIds]` (inferido por co-ocorrência espacial) |
| `decisions.jsonl` | 1 linha por amostra do camera controller (~10Hz): `t`, `chosen_track`, `chosen_score`, `runner_up`, `speakers_active`, `reason` (initial/hold/switch/wait_/no_detection) |
| `switches.json` | Toda troca de foco: `t`, `from_track`, `to_track`, `delta_score`, `held_ms` |
| `links_report.json` | Speaker↔Track: escolha final + top-3 candidatos com score, overlap, área e consistência (heatmap: `speaker_0 → {track_4: 82%, track_7: 11%, ...}`) |
| `camera_trace.jsonl` | Estado suavizado da câmera por amostra: `viewport_center`, `sliceW/H`, `zoom_norm` |
| `diagnosis.json` | Diagnóstico automático — `primary_culprit`, `confidence`, `evidence[]`, `component_scores` (tracker / diarization / speaker_linking / camera_controller) |

## O que NÃO é emitido nesta sprint

- `lip_activity.json` — depende de Face Mesh; entra na 1a.2.
- `inspection.mp4` — vídeo com HUD (bbox overlay + viewport dashed + toast SWITCH) — entra na 1a.2 depois de olharmos os JSONs.
- `benchmark/*.json` — harness com ground truth humano — entra na 1a.3 quando tivermos ao menos o caso-0 rotulado.

## Heurísticas do `diagnosis.json`

Componente-alvo é escolhido pela violação mais grave:

- **Tracker**: `fragmentation_ratio > 1.6` OU >40% dos tracks vivendo <1s OU >2 IDs mapeados pra mesma person_bin.
- **Diarization**: >30% dos turnos <500ms OU >5% do tempo com fala mas sem speaker atribuído.
- **Speaker Linking**: mesmo speaker linkado a ≥2 tracks fortes (>25% de score cada) OU `agreement_score < 0.55`.
- **Camera Controller**: >20% dos switches sem mudança de speaker e sem perda de track (indicaria bug de EMA/histerese).

Ordem de prioridade quando várias regras disparam: Linking > Tracker > Diarization > Controller (a que mais costuma explicar "pessoa errada").

## Próximo passo após rodar o caso-0

Você me manda o `job_id` (ou eu leio do bucket) e apresento o diagnóstico. **Não vou propor mudança de algoritmo até você aprovar.**
