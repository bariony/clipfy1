#!/usr/bin/env python3
"""
Diarização com pyannote.audio 3.1 (CPU).

Uso:
    python3 diarize.py <audio.wav>

Saída (stdout): JSON com status explícito:
    {"status": "success", "model": "pyannote/speaker-diarization-3.1",
     "turns": [...], "speakers": [...], "processing_time_ms": 12345}
    {"status": "failed", "stage": "...", "reason": "<sanitized>"}

Nunca vaza HF_TOKEN em stdout/stderr.
"""
import json
import os
import sys
import time
import traceback

MODEL_ID = "pyannote/speaker-diarization-3.1"


def _sanitize(msg: str) -> str:
    # Nunca ecoar o token, caso apareça em mensagens de erro do HF.
    tok = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN") or ""
    s = str(msg)
    if tok:
        s = s.replace(tok, "***")
    return s[:500]


def emit(payload: dict):
    print(json.dumps(payload))


def main():
    t0 = time.time()
    if len(sys.argv) < 2:
        emit({"status": "failed", "stage": "args", "reason": "audio path missing"})
        return

    audio_path = sys.argv[1]
    hf_token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")
    if not hf_token:
        emit({"status": "failed", "stage": "no_hf_token",
              "reason": "HF_TOKEN/HUGGINGFACE_TOKEN não configurado"})
        return

    if not os.path.isfile(audio_path):
        emit({"status": "failed", "stage": "wav_missing",
              "reason": f"wav ausente: {audio_path}"})
        return

    try:
        print(f"diarize: loading model {MODEL_ID}", file=sys.stderr)
        import torch  # noqa: F401
        from pyannote.audio import Pipeline

        try:
            pipeline = Pipeline.from_pretrained(MODEL_ID, use_auth_token=hf_token)
        except Exception as exc:
            emit({
                "status": "failed",
                "stage": "load_model",
                "model": MODEL_ID,
                "reason": _sanitize(f"{type(exc).__name__}: {exc}"),
                "hint": "verificar aceite dos termos em https://hf.co/pyannote/speaker-diarization-3.1 e https://hf.co/pyannote/segmentation-3.0",
            })
            return

        try:
            pipeline.to(torch.device("cpu"))
        except Exception:
            pass

        print("diarize: running pipeline", file=sys.stderr)
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
        turns.sort(key=lambda t: t["start"])

        emit({
            "status": "success",
            "model": MODEL_ID,
            "turns": turns,
            "speakers": sorted(speakers),
            "processing_time_ms": int((time.time() - t0) * 1000),
        })
    except Exception as exc:
        emit({
            "status": "failed",
            "stage": "runtime",
            "model": MODEL_ID,
            "reason": _sanitize(f"{type(exc).__name__}: {exc}"),
            "trace": _sanitize(traceback.format_exc()[-600:]),
        })


if __name__ == "__main__":
    main()
