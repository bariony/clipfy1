#!/usr/bin/env python3
"""
Face tracker do Clipfy worker — YOLOv10n-face (ONNX) com fallback Haar.

Uso: python3 face_track.py <video> [sample_fps=2] [input_size=640]

Saída JSON stdout:
{
  "w": <largura original>,
  "h": <altura original>,
  "detector": "yolov10n-face" | "haar",
  "frames": [ { "t": 0.0, "faces": [[x, y, w, h, score], ...] }, ... ]
}
"""
import json
import os
import sys

MODEL_PATH = os.environ.get("FACE_MODEL_PATH", "/opt/models/yolov10n-face.onnx")


def _emit(payload):
    print(json.dumps(payload))


try:
    import cv2  # type: ignore
    import numpy as np  # type: ignore
except Exception as e:
    _emit({"error": f"opencv/numpy indisponível: {e}", "w": 0, "h": 0, "frames": [], "detector": "none"})
    sys.exit(0)


def load_yolo():
    """Carrega YOLOv10n-face via onnxruntime. Retorna (session, input_name, input_size) ou None."""
    if not os.path.isfile(MODEL_PATH):
        return None
    try:
        import onnxruntime as ort  # type: ignore
        sess = ort.InferenceSession(MODEL_PATH, providers=["CPUExecutionProvider"])
        inp = sess.get_inputs()[0]
        # shape: [1, 3, H, W]
        h = inp.shape[2] if isinstance(inp.shape[2], int) else 640
        w = inp.shape[3] if isinstance(inp.shape[3], int) else 640
        return sess, inp.name, (w, h)
    except Exception as e:
        sys.stderr.write(f"[face_track] yolo load falhou: {e}\n")
        return None


def yolo_detect(sess, input_name, isize, frame_bgr, conf=0.35):
    """
    YOLOv10 tem NMS end-to-end. Saída típica: [1, N, 6] = [x1,y1,x2,y2,score,class]
    em coords do input redimensionado (com letterbox). Retorna lista de [x,y,w,h,score]
    em coords do frame original.
    """
    ih, iw = frame_bgr.shape[:2]
    tw, th = isize
    # Letterbox mantendo aspect ratio
    r = min(tw / iw, th / ih)
    nw, nh = int(round(iw * r)), int(round(ih * r))
    resized = cv2.resize(frame_bgr, (nw, nh), interpolation=cv2.INTER_LINEAR)
    pad_x = (tw - nw) // 2
    pad_y = (th - nh) // 2
    canvas = np.full((th, tw, 3), 114, dtype=np.uint8)
    canvas[pad_y:pad_y + nh, pad_x:pad_x + nw] = resized

    # BGR → RGB, HWC → CHW, 0-1
    blob = cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    blob = np.transpose(blob, (2, 0, 1))[None, ...]

    out = sess.run(None, {input_name: blob})[0]
    # aceita [1,N,6] ou [N,6]
    dets = out[0] if out.ndim == 3 else out

    faces = []
    for row in dets:
        if len(row) < 5:
            continue
        x1, y1, x2, y2, score = float(row[0]), float(row[1]), float(row[2]), float(row[3]), float(row[4])
        if score < conf:
            continue
        # Remove letterbox e reescala pra original
        x1 = (x1 - pad_x) / r
        y1 = (y1 - pad_y) / r
        x2 = (x2 - pad_x) / r
        y2 = (y2 - pad_y) / r
        x = max(0, int(x1))
        y = max(0, int(y1))
        w = max(1, int(x2 - x1))
        h = max(1, int(y2 - y1))
        faces.append([x, y, w, h, round(score, 3)])
    return faces


def haar_detect(cascade, frame_bgr):
    """Fallback."""
    gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
    min_side = max(40, int(min(gray.shape) * 0.10))
    boxes = cascade.detectMultiScale(gray, 1.2, 5, minSize=(min_side, min_side))
    return [[int(x), int(y), int(w), int(h), 0.5] for (x, y, w, h) in boxes]


def detect_native_split(gray):
    """
    Detecta 'split-screen nativo' no frame original: uma linha divisória
    vertical forte perto do centro (moldura preta, borda dura, gradient).
    Retorna True quando a coluna central concentra muito mais energia de
    borda vertical que o restante do frame.
    """
    h, w = gray.shape[:2]
    if w < 200 or h < 200:
        return False
    sob = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    col_energy = np.mean(np.abs(sob), axis=0)  # média por coluna
    mean_all = float(np.mean(col_energy)) + 1e-6
    # janela central de 8% da largura
    c0 = int(w * 0.46)
    c1 = int(w * 0.54)
    center_max = float(np.max(col_energy[c0:c1]))
    # também exigir uniformidade vertical (divisor real é reto de cima a baixo)
    center_col = int(w * 0.5)
    line = gray[:, max(0, center_col - 1):center_col + 2].astype(np.float32).mean(axis=1)
    line_std = float(np.std(line))
    return center_max > mean_all * 6.0 and line_std < 40.0


def hist_hsv(bgr):
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    h = cv2.calcHist([hsv], [0, 1], None, [30, 32], [0, 180, 0, 256])
    cv2.normalize(h, h, 0, 1, cv2.NORM_MINMAX)
    return h


def main():
    if len(sys.argv) < 2:
        _emit({"error": "missing video arg", "w": 0, "h": 0, "frames": [], "detector": "none"})
        return
    video = sys.argv[1]
    sample_fps = float(sys.argv[2]) if len(sys.argv) > 2 else 2.0

    cap = cv2.VideoCapture(video)
    if not cap.isOpened():
        _emit({"error": "cannot open video", "w": 0, "h": 0, "frames": [], "detector": "none"})
        return

    vfps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    if vfps <= 0 or vfps > 120:
        vfps = 30.0
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    if w <= 0 or h <= 0:
        cap.release()
        _emit({"error": "invalid dimensions", "w": w, "h": h, "frames": [], "detector": "none"})
        return

    step = max(1, int(round(vfps / max(0.25, sample_fps))))

    yolo = load_yolo()
    detector_name = "yolov10n-face" if yolo else "haar"
    cascade = None
    if not yolo:
        cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
        if cascade.empty():
            cap.release()
            _emit({"error": "haar cascade empty and no yolo", "w": w, "h": h, "frames": [], "detector": "none"})
            return

    frames = []
    prev_hist = None
    idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if idx % step == 0:
            t_sec = round(idx / vfps, 3)
            try:
                if yolo:
                    sess, inp_name, isize = yolo
                    faces = yolo_detect(sess, inp_name, isize, frame)
                else:
                    faces = haar_detect(cascade, frame)
            except Exception as e:
                sys.stderr.write(f"[face_track] frame {idx} falhou: {e}\n")
                faces = []

            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            try:
                split = bool(detect_native_split(gray))
            except Exception:
                split = False

            shot = False
            try:
                hist = hist_hsv(frame)
                if prev_hist is not None:
                    corr = float(cv2.compareHist(prev_hist, hist, cv2.HISTCMP_CORREL))
                    if corr < 0.55:
                        shot = True
                prev_hist = hist
            except Exception:
                pass

            frames.append({"t": t_sec, "faces": faces, "split": split, "shot": shot})
        idx += 1

    cap.release()
    _emit({"w": w, "h": h, "detector": detector_name, "frames": frames})



if __name__ == "__main__":
    main()
