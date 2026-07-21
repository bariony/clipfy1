#!/usr/bin/env python3
"""
Diarização com pyannote.audio 3.1 (CPU).

Uso:
    python3 diarize.py <audio.wav>

Saída (stdout): JSON
    {"turns": [{"start": 0.0, "end": 3.4, "speaker": "SPEAKER_00"}, ...],
     "speakers": ["SPEAKER_00", "SPEAKER_01"]}

Em caso de falha, retorna {"turns": [], "error": "..."} com exit code 0
para o worker Node cair no fallback sem crashar o job inteiro.

Requer HF_TOKEN no ambiente e aceite dos termos do modelo
pyannote/speaker-diarization-3.1 na Hugging Face.
"""
import json
import os
import sys
import traceback


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"turns": [], "error": "audio path missing"}))
        return

    audio_path = sys.argv[1]
    hf_token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")
    if not hf_token:
        print(json.dumps({"turns": [], "error": "HF_TOKEN not set"}))
        return

    try:
        # Import tardio para o import não custar quando HF_TOKEN falta.
        import torch  # noqa: F401
        from pyannote.audio import Pipeline

        pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1",
            use_auth_token=hf_token,
        )
        # CPU explícito (worker sem GPU).
        try:
            import torch
            pipeline.to(torch.device("cpu"))
        except Exception:
            pass

        # Hint pra pyannote (evita over-splitting em podcasts com 2-4 pessoas).
        diarization = pipeline(audio_path, min_speakers=1, max_speakers=6)

        turns = []
        speakers = set()
        for turn, _, speaker in diarization.itertracks(yield_label=True):
            turns.append({
                "start": round(float(turn.start), 3),
                "end": round(float(turn.end), 3),
                "speaker": str(speaker),
            })
            speakers.add(str(speaker))

        # Ordena por tempo pra facilitar consumo.
        turns.sort(key=lambda t: t["start"])
        print(json.dumps({"turns": turns, "speakers": sorted(speakers)}))
    except Exception as exc:
        print(json.dumps({
            "turns": [],
            "error": f"{type(exc).__name__}: {exc}",
            "trace": traceback.format_exc()[-800:],
        }))


if __name__ == "__main__":
    main()
