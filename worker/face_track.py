#!/usr/bin/env python3
"""
Face tracker do Clipfy worker.

Uso: python3 face_track.py <video> [sample_fps=2] [scale_w=640]

Amostra o vídeo em N fps (default 2), detecta rostos com Haar cascade
(rápido, sem GPU) e devolve JSON com timeline:

{
  "w": <largura original>,
  "h": <altura original>,
  "frames": [
    { "t": 0.0,   "faces": [[x, y, w, h], ...] },  # em coords do vídeo original
    { "t": 0.5,   "faces": [...] },
    ...
  ]
}

Detecção é feita em uma versão reduzida (scale_w=640) para velocidade;
coordenadas de saída são reescaladas de volta pro tamanho original.
"""
import json
import sys

try:
    import cv2  # type: ignore
except Exception as e:
    print(json.dumps({"error": f"opencv não disponível: {e}", "w": 0, "h": 0, "frames": []}))
    sys.exit(0)


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "missing video arg", "w": 0, "h": 0, "frames": []}))
        return
    video = sys.argv[1]
    sample_fps = float(sys.argv[2]) if len(sys.argv) > 2 else 2.0
    scale_w = int(sys.argv[3]) if len(sys.argv) > 3 else 640

    cap = cv2.VideoCapture(video)
    if not cap.isOpened():
        print(json.dumps({"error": "cannot open video", "w": 0, "h": 0, "frames": []}))
        return

    vfps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    if vfps <= 0 or vfps > 120:
        vfps = 30.0
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    if w <= 0 or h <= 0:
        cap.release()
        print(json.dumps({"error": "invalid dimensions", "w": w, "h": h, "frames": []}))
        return

    step = max(1, int(round(vfps / max(0.25, sample_fps))))
    scale = min(1.0, scale_w / w)
    inv = 1.0 / scale if scale > 0 else 1.0

    cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    detector = cv2.CascadeClassifier(cascade_path)
    if detector.empty():
        cap.release()
        print(json.dumps({"error": "cascade empty", "w": w, "h": h, "frames": []}))
        return

    frames = []
    idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if idx % step == 0:
            small = cv2.resize(frame, (int(w * scale), int(h * scale))) if scale < 1.0 else frame
            gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
            # minSize proporcional ao tamanho reduzido pra evitar falsos positivos
            min_side = max(40, int(min(small.shape[0], small.shape[1]) * 0.12))
            faces = detector.detectMultiScale(
                gray,
                scaleFactor=1.2,
                minNeighbors=5,
                minSize=(min_side, min_side),
            )
            out_faces = []
            for (fx, fy, fw, fh) in faces:
                out_faces.append([
                    int(fx * inv),
                    int(fy * inv),
                    int(fw * inv),
                    int(fh * inv),
                ])
            frames.append({"t": round(idx / vfps, 3), "faces": out_faces})
        idx += 1

    cap.release()
    print(json.dumps({"w": w, "h": h, "frames": frames}))


if __name__ == "__main__":
    main()
