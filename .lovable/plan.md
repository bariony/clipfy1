# Auto-Reframe v2 — Refatoração para nível OpusClip

## Diagnóstico da arquitetura atual

O worker hoje segue este fluxo:

```text
face_track.py (YOLOv10n-face @ 2 fps)
  → frames[{t, faces:[[x,y,w,h,score]], split, shot}]      // SEM track IDs
diarize.py (pyannote 3.1)
  → turns[{start, end, speaker}]
index.js:
  computeSpeakerCentroids(track, turns)                    // speaker → 1 ponto X (FALHA CENTRAL)
  faceGroupsInWindow(track, t0, t1, prevCx, diar)          // reagrupa por bins a CADA cena
  buildSceneFilter(scene) → fullFocusFilter / stack / pip  // crop instantâneo, sem câmera
```

Problemas raiz identificados no código:

1. **Sem identidade persistente**: `face_track.py` emite apenas caixas por frame. Não há Track ID. O Node reinventa "quem é quem" a cada cena via bins de posição X — quando alguém se move, vira outro "cluster".
2. **Speaker → centroide único** (`computeSpeakerCentroids`, index.js:734): reduz a pessoa a um `cx` global. Move-se um pouco e o bias de 12% da largura (index.js:694) já erra o alvo.
3. **Escolha por cena, não por vídeo** (`faceGroupsInWindow`, index.js:627): a decisão é local, dependente de `prevCx` fraco (bônus 1.35× a <15% de distância).
4. **Sem câmera**: `fullFocusFilter` (index.js:856) calcula `crop` estático por cena. O único "movimento" é o zoom `1 + 0.045 * (i%3)` — não segue o falante dentro da cena.
5. **Enquadramento errado**: `cropYForFace` coloca `cy` a 34% do topo — sem safe-margin para testa/queixo, sem regra de terços real.
6. **Sem filtros de falso candidato**: qualquer detecção YOLO >0.35 vira massa; pôsteres/TV/rostos ao fundo entram no cálculo.
7. **Split-screen precoce**: `distinctFaceGroups` promove stack quando há 2 grupos distintos, sem exigir que ambos estejam **falando** em diálogo real.

## O que mantemos, o que remove, o que adiciona

**Mantém (funciona):**
- `face_track.py` detecção YOLOv10n-face (letterbox + ONNX CPU) — bom detector.
- `face_track.py` `detect_native_split` + shot boundary (histograma HSV).
- `diarize.py` pyannote 3.1 CPU — turnos são corretos.
- `extractAudioForDiarize`, `runDiarizer`, pipeline geral do `index.js` (baixar, cortar, EDL, upload).
- FFmpeg filter graph e layouts `stackFilter` / `pipFilter` / `nativeSplitFilter` — reaproveitados pelo novo Camera Controller.

**Remove:**
- `computeSpeakerCentroids` (speaker → 1 ponto X). Substituída por Speaker↔Track association.
- Lógica de bins de X dentro de `faceGroupsInWindow` como fonte de identidade. O agrupamento vira apenas fallback quando não há Track.
- `distinctFaceGroups` como gatilho de stack. Split só via detecção de diálogo real.
- Zoom oscilante `1 + 0.045*(i%3)` — decorativo, atrapalha estabilidade.

**Adiciona:**
- Tracker persistente (IoU + Kalman leve) dentro de `face_track.py`, com **Track ID por rosto**.
- `SpeakerTrackLinker` em JS: associa cada `speaker` a um `trackId` por tempo de coocorrência + confiança.
- `ActiveSpeakerScorer`: score por Track em janela deslizante (não por cena).
- `CameraController`: EMA + limite de velocidade + histerese de troca (600 ms).
- `Framer`: regra dos terços, safe-margins, zoom baseado em tamanho do rosto.
- `CandidateFilter`: descarta rostos pequenos, de baixa nitidez, isolados no tempo.
- `DialogueDetector`: decide split real com base em ping-pong de speakers.
- `PodcastMode`: perfil conservador quando `speakers ≤ 3` e movimento baixo.

## Arquitetura nova (fluxo)

```text
face_track.py  (agora com Tracker + landmarks opcionais)
  → { w, h, fps_sample, tracks:[{id, frames:[{t, bbox, score, blur, size_ratio}]}], shots, splits }

diarize.py  → turns

index.js:
  buildTracks(raw)                 ← já vem pronto do Python
  filterCandidates(tracks)         ← remove fundo/tv/rostos pequenos
  linkSpeakersToTracks(turns, tracks)   ← Speaker A → Track 17 (vídeo inteiro)
  scoreActiveSpeaker(t)            ← função contínua, retorna trackId ativo
  cameraController.update(t, target)    ← EMA + velocidade + histerese
  framer.compose(bbox, camera)     ← rule of thirds + safe margins
  buildSceneFilter(scene, camera)  ← consome CameraTarget, não Face
```

### 1. Tracker persistente (face_track.py)

Implementar tracker leve **IoU + centroid distance com histerese**, sem dependências pesadas:

- Cada Track: `{id, last_bbox, last_t, hits, misses, kalman(cx,cy,w)}`.
- Associação nova detecção → track: melhor IoU ≥ 0.3 **ou** distância de centroide ≤ 8% da largura E tamanho similar (±40%).
- Track "vive" por até 1.5 s sem detecção (`misses ≤ 3` a 2 fps) antes de morrer — resolve piscadas.
- Emite `size_ratio = face_h / frame_h`, `blur = variance_of_laplacian(face_crop)` — usados pelo filtro de candidatos.
- Sample fps sobe para **4 fps** (era 2) para tracking estável; YOLO continua no mesmo custo por frame, dobra o volume mas ainda cabe em CPU.
- Justificativa da escolha (não ByteTrack/DeepSORT): rostos em podcast são poucos (2–5), lentos, sem oclusões severas — IoU+Kalman resolve com <5% do custo de ByteTrack e sem dependência de embedding. Podemos adicionar ByteTrack depois se um caso real quebrar.

### 2. Speaker↔Track Linker (novo módulo speaker_link.js)

Para cada `speaker`, calcular para cada Track:

```text
score(speaker, track) =
    0.55 * talk_overlap_seconds
  + 0.25 * mean_face_area_during_talk
  + 0.10 * detection_confidence
  + 0.10 * temporal_consistency (fração dos turnos com track presente)
```

Atribuição via Hungarian **ou** greedy com bloqueio (speaker mais falante escolhe primeiro). Resultado é **global**, calculado uma vez por vídeo.

### 3. Active Speaker Scorer (novo)

Função `activeTrackAt(t)`:

```text
score(track, t) =
    0.40 * speakerActivity(t)      ← 1.0 se speakerAtualmente(t) === track.speaker
  + 0.25 * relativeFaceArea
  + 0.15 * trackPersistence (últimos 2s)
  + 0.10 * detectionConfidence
  + 0.10 * positionStability (var(cx) últimos 1s)
```

Aplicado com **hysteresis**: só troca `activeTrack` se um concorrente supera o atual por margem `≥ 0.15` durante `≥ 600 ms` contínuos. Caso contrário mantém.

Quando nenhum score passa do limite mínimo (`0.35`), mantém último Track — nunca "escolhe aleatório".

### 4. Camera Controller (novo)

Estado: `{cx, cy, zoom, vx, vy, vz}`. Update por passo de 100 ms:

```text
target = framer(bbox_do_active_track)   // ponto ideal + zoom desejado
error = target - state
v = clamp(v + k_p * error, ±V_MAX)      // V_MAX = 8% largura/s (podcast: 4%)
state += v * dt
                                        // ease-out via k_p decrescente perto do alvo
```

- Deadzone: se `|error| < 3% da largura`, `v → 0` (câmera parada).
- Snap permitido apenas em `shot boundary` (`frames[i].shot === true`) — aí sim pode cortar a câmera instantaneamente.
- Emite uma curva `cameraPath[]` para o vídeo inteiro; o FFmpeg consome via `crop` com expressão paramétrica (ou via segmentos por cena, se mais barato).

### 5. Framer (composição cinematográfica)

Dado `bbox = {x,y,w,h}` do rosto:
- Zoom: dimensiona para o rosto ocupar 22–32% da altura do 9:16 (podcast: 24%).
- Vertical: olhos em `y = 1080 * 0.36` (regra dos terços real, era 0.34 fixo).
- Safe margins: pelo menos `0.08 * H` acima da testa e `0.06 * H` abaixo do queixo. Se não couber, reduz zoom até caber.
- Horizontal: ligeiro *lead space* na direção do olhar quando disponível (fallback: rosto centrado ±5% conforme lado do quadro original).

### 6. Candidate Filter

Antes de qualquer scoring, descartar Tracks com:
- `size_ratio < 0.08` (rosto pequeno demais → fundo/plateia).
- Vida total `< 1.2 s` (aparição isolada → falso positivo).
- `blur < threshold` (rosto desfocado — poster/foto tende a ter blur baixo *e* estático; combinado com "não fala nunca" filtra TVs).
- Track cuja `var(cx) < 2 px` por >30 s **e** não associado a nenhum speaker → pôster/moldura.

### 7. Dialogue Detector (split inteligente)

Split ativado apenas quando, numa janela de 3–4 s:
- ≥ 3 alternâncias entre 2 speakers,
- cada um fala ≥ 25% do tempo,
- ambos os Tracks estão visíveis nessa janela.

Fora disso: `full` com Camera Controller seguindo o ativo. Elimina os splits gratuitos atuais.

### 8. Podcast Mode

Ativado automaticamente quando:
- `speakers.length` entre 2 e 4,
- Movimento médio dos Tracks < 5% da largura por segundo,
- Nenhum `shot` boundary detectado.

Efeitos: `V_MAX` cai para 4%, hysteresis sobe para 900 ms, zoom fixo 24%, dialogue detector exige 4+ alternâncias.

### 9. buildSceneFilter refatorado

Passa a receber `CameraTarget` já resolvido:

```text
CameraTarget {
  trackId, bbox, zoom, cx, cy,
  velocity, confidence, layout: 'full'|'stack'|'pip'|'native-split',
  history: [...últimos 30 pontos]
}
```

`buildSceneFilter` só monta o filter graph FFmpeg — toda a inteligência foi para os módulos acima.

### 10. Logging

Log estruturado por decisão (nível debug):

```json
{"t":12.4,"activeTrack":17,"speaker":"SPEAKER_00","score":0.71,
 "runnerUp":{"track":21,"score":0.42},"switched":false,
 "reason":"hysteresis:remaining=420ms","cam":{"cx":812,"zoom":1.35}}
```

Um sumário por render: nº de trocas, tempo médio entre trocas, % podcast mode, % split.

## Detalhes técnicos

### Arquivos alterados

- `worker/face_track.py`: adiciona `SimpleTracker` (IoU+Kalman), campos `id`, `blur`, `size_ratio`; sobe sample para 4 fps; output vira `tracks[]` além de `frames[]` (retro-compat).
- `worker/lib/speakerLink.js` (novo): `linkSpeakersToTracks(turns, tracks)`.
- `worker/lib/activeSpeaker.js` (novo): `scorer + hysteresis`.
- `worker/lib/camera.js` (novo): `CameraController`.
- `worker/lib/framer.js` (novo): composição, safe margins.
- `worker/lib/candidateFilter.js` (novo): filtro de falsos.
- `worker/lib/dialogue.js` (novo): detector de diálogo.
- `worker/index.js`: remove `computeSpeakerCentroids`, adapta `faceGroupsInWindow` para fallback, `buildSceneFilter` consome `CameraTarget`, adiciona logs.
- `worker/README.md`: documenta os módulos e o Podcast Mode.

### Performance

- Tracker é O(n·m) em detecções por frame; com <8 rostos/frame é desprezível.
- Kalman leve (numpy 4-state) — sem torch adicional.
- Sample fps 2→4: dobra chamadas YOLO. YOLOv10n a 640 em CPU x86 ~40 ms/frame → +20 ms/s de vídeo. Aceitável.
- Sem novos modelos. Toda inteligência é algorítmica.

### Compat com pipeline atual

`index.js` continua chamando `face_track.py` e `diarize.py` com os mesmos args e mesmas etapas macro (baixar → cortar → EDL → render). Os módulos novos plugam entre "análise" e "buildSceneFilter", que é onde estava a maior parte dos bugs.

## Ordem de implementação

1. Tracker persistente + `size_ratio`/`blur` em `face_track.py`.
2. `speakerLink.js` — validar mapeamento em 1 vídeo real via logs.
3. `activeSpeaker.js` + hysteresis, ainda com crop estático por cena.
4. `framer.js` (safe margins + terços) — corrige "corta testa/queixo".
5. `camera.js` (EMA/velocidade) — remove teleporte.
6. `candidateFilter.js` — mata pôster/TV/fundo.
7. `dialogue.js` — split só em diálogo real.
8. Podcast Mode + logging final.

Cada passo é um deploy independente; se algum regredir, dá pra revisar isoladamente sem quebrar o resto.
