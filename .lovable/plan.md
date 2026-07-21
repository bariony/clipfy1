# Sprint 1a — Debug & Evidence Mode

**Regra desta sprint:** Nenhuma linha do algoritmo de reframe/tracker/linking/câmera muda. Só instrumentação, coleta e visualização. Ao final apresento os dados e paro — nada de propor solução até você aprovar.

## 1. Trigger e storage

- Nova coluna `projects.debug_reframe boolean default false` (migration).
- UI: toggle no editor do projeto ("Modo diagnóstico de câmera").
- Worker lê `edl.debug.enabled`; artefatos vão para `renders/<job_id>/debug/…` no bucket `renders`.

## 2. Artefatos gerados por job (quando debug=on)

Todos com schema versionado (`"schema": "sprint1a.v1"`):

| Arquivo | Conteúdo |
|---|---|
| `tracks_report.json` | Por track: duração, hits, gaps, tempo total; `fragmentation_ratio` global; **mapa "Pessoa real → sequência de IDs"** inferido por co-ocorrência espacial |
| `decisions.jsonl` | 1 linha por sample (~4fps): `t`, tracks ativos (id/bbox/score/blur), speaker diarizado, camera target escolhido, motivo (`speaker_link`/`area`/`persistence`/`hysteresis_hold`), lip_activity (observação) |
| `switches.json` | Toda troca de foco: `t`, `from_track`, `to_track`, `delta_score`, `trigger` (speaker_change/track_lost/score_flip), `was_hysteresis_bypassed` |
| `links_report.json` | Speaker↔Track: para cada speaker, **distribuição percentual** entre top-N tracks (heatmap: `speaker_0 → {track_4: 82%, track_7: 11%, track_3: 7%}`) + `agreement_score` |
| `camera_trace.jsonl` | Estado do controller por frame: `viewport_center`, `zoom`, `layout`, `ema_state` |
| `lip_activity.json` | Por track/janela: score de movimento de boca (Face Mesh leve). **Só observação, não entra em decisão nenhuma.** |
| `diagnosis.json` | Diagnóstico automático (ver §5) |

## 3. Vídeo de inspeção

MP4 empilhado verticalmente:
- **Topo (16:9 original):** overlay com bounding boxes de todas as tracks (cor por ID), label `T{id} s={score} spk={speaker}`, retângulo pontilhado indicando o **viewport** escolhido pela câmera, badge de layout (full/split/stack).
- **Baixo (9:16 final):** resultado real com HUD: `t=12.3s | target=T4 | reason=speaker_link | conf=0.82 | lip=0.31`.
- **Toast "SWITCH"** vermelho por 500ms toda vez que muda de foco, com o motivo.

Arquivo: `renders/<job>/debug/inspection.mp4`.

## 4. Benchmark desde o dia 1 (3 vídeos)

`worker/scripts/benchmark.js`:

- Roda o pipeline nos 3 vídeos-caso (podcast 2p / podcast 3p / cortes frequentes) com debug=on.
- Compara `decisions.jsonl` contra ground truth humano (formato simples: `[{t_start, t_end, correct_speaker_id, correct_bbox?}]` num JSON por vídeo).
- Calcula e imprime tabela + gera `benchmark/<timestamp>.json`:

| Métrica | Definição |
|---|---|
| Camera Target Accuracy | % de tempo com foco no speaker correto |
| Wrong Speaker Time | segundos totais focando o errado |
| Silent Person Time | segundos focando alguém em silêncio quando há speaker ativo |
| Identity Stability | 1 - (IDs distintos atribuídos à mesma pessoa real / total) |
| Camera Stability | inverso da variância do viewport_center |
| Switches per Minute | trocas/min |
| **Overall Camera Score** | média ponderada normalizada 0-100 |

Cada execução salva histórico; script `benchmark:diff` mostra ganho/perda vs. último run. Isso vira parte do fluxo antes de qualquer mudança futura.

## 5. Diagnóstico automático (o ponto que você marcou como mais importante)

Ao final de cada execução, `diagnosis.json` responde:

```json
{
  "primary_culprit": "speaker_linking",
  "confidence": 0.71,
  "evidence": [
    "63% dos switches ocorreram <200ms após virada de turno de fala",
    "speaker_0 associado a 3 tracks distintas em janelas de 30s",
    "tracker fragmentation_ratio=1.8 (ok, não é o gargalo)"
  ],
  "component_scores": {
    "tracker":        { "health": 0.82, "issues": [...] },
    "diarization":    { "health": 0.65, "issues": [...] },
    "speaker_linking":{ "health": 0.41, "issues": [...] },
    "camera_controller":{ "health": 0.77, "issues": [...] }
  }
}
```

Regras de atribuição (heurísticas explícitas, versionadas):
- Tracker: fragmentation_ratio alto, gaps grandes, IDs curtos.
- Diarização: turnos < 500ms, speakers oscilando rápido, silêncio prolongado sem speaker.
- Linking: mesmo speaker → múltiplos tracks; agreement_score baixo; erros concentrados em bordas de turno.
- Camera Controller: switches sem mudança de speaker nem perda de track (bug de EMA/histerese).

## 6. Ground Truth (3 vídeos, formato mínimo)

`benchmark/ground_truth/<slug>.json`:

```json
{
  "video": "podcast-2p.mp4",
  "duration": 62.4,
  "speakers": ["host", "guest"],
  "segments": [
    { "t_start": 0.0, "t_end": 3.2, "correct_speaker": "host" },
    { "t_start": 3.2, "t_end": 7.8, "correct_speaker": "guest" }
  ]
}
```

Você fornece o caso-0. Eu monto o skeleton dos outros 2 e você rotula (formato acima, ~15min por vídeo).

## 7. O que NÃO faço nesta sprint

- Não mexo em `face_track.py` além de expor tracks já existentes.
- Não mexo em `reframe.js`/decisão.
- Não mexo em diarização.
- Lip activity fica em observação, nunca em decisão.
- **Ao final, apresento dados + hipótese mais provável e paro. Zero alteração de algoritmo até sua aprovação.**

## Entregáveis técnicos

- Migration: `projects.debug_reframe`
- UI: toggle no projeto
- Worker: emissão dos 7 artefatos + `inspection.mp4`
- `worker/scripts/benchmark.js` + pasta `benchmark/ground_truth/`
- Diagnóstico automático (`diagnosis.json`)
- Doc curto `worker/DEBUG.md` explicando como rodar

## Próximo passo depois deste plano

1. Você aprova o plano.
2. Implemento tudo.
3. Você liga `debug_reframe` no caso-0, roda, me manda os artefatos (ou eu leio do bucket).
4. Eu apresento diagnóstico e paro.
