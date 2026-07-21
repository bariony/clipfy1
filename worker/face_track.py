#!/usr/bin/env python3
"""
Face tracker do Clipfy worker — YOLOv10n-face (ONNX) + tracker IoU persistente.

Uso: python3 face_track.py <video> [sample_fps=4] [input_size=640]

Saída JSON stdout:
{
  "w": <largura original>, "h": <altura original>,
  "detector": "yolov10n-face" | "haar",
  "fps_sample": 4,
  "duration": <segundos>,
  "frames": [ { "t": 0.0, "faces": [[x,y,w,h,score]], "split": bool, "shot": bool }, ...],   # legado
  "tracks": [ { "id": 0, "frames": [ { "t":..., "bbox":[x,y,w,h], "score":..., "blur":..., "size_ratio":... } ] } ],
  "shots":  [ t0, t1, ... ],
  "splits": [ [t_start, t_end], ... ]
}

O SimpleTracker é IoU + centroid com histerese: rostos são associados por
sobreposição/proximidade com EMA nas coordenadas, e mantidos vivos por até
6 amostras sem detecção (~1.5s a 4fps) para tolerar piscadas do detector.
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
    _emit({"error": f"opencv/numpy indisponível: {e}", "w": 0, "h": 0, "frames": [], "tracks": [], "detector": "none"})
    sys.exit(0)


# -------------------- YOLO / Haar --------------------
def load_yolo():
    if not os.path.isfile(MODEL_PATH):
        return None
    try:
        import onnxruntime as ort  # type: ignore
        sess = ort.InferenceSession(MODEL_PATH, providers=["CPUExecutionProvider"])
        inp = sess.get_inputs()[0]
        h = inp.shape[2] if isinstance(inp.shape[2], int) else 640
        w = inp.shape[3] if isinstance(inp.shape[3], int) else 640
        return sess, inp.name, (w, h)
    except Exception as e:
        sys.stderr.write(f"[face_track] yolo load falhou: {e}\n")
        return None


def yolo_detect(sess, input_name, isize, frame_bgr, conf=0.35):
    ih, iw = frame_bgr.shape[:2]
    tw, th = isize
    r = min(tw / iw, th / ih)
    nw, nh = int(round(iw * r)), int(round(ih * r))
    resized = cv2.resize(frame_bgr, (nw, nh), interpolation=cv2.INTER_LINEAR)
    pad_x = (tw - nw) // 2
    pad_y = (th - nh) // 2
    canvas = np.full((th, tw, 3), 114, dtype=np.uint8)
    canvas[pad_y:pad_y + nh, pad_x:pad_x + nw] = resized
    blob = cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    blob = np.transpose(blob, (2, 0, 1))[None, ...]
    out = sess.run(None, {input_name: blob})[0]
    dets = out[0] if out.ndim == 3 else out
    faces = []
    for row in dets:
        if len(row) < 5:
            continue
        x1, y1, x2, y2, score = float(row[0]), float(row[1]), float(row[2]), float(row[3]), float(row[4])
        if score < conf:
            continue
        x1 = (x1 - pad_x) / r
        y1 = (y1 - pad_y) / r
        x2 = (x2 - pad_x) / r
        y2 = (y2 - pad_y) / r
        x = max(0, int(x1)); y = max(0, int(y1))
        w = max(1, int(x2 - x1)); h = max(1, int(y2 - y1))
        faces.append([x, y, w, h, round(score, 3)])
    return faces


def haar_detect(cascade, frame_bgr):
    gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
    min_side = max(40, int(min(gray.shape) * 0.10))
    boxes = cascade.detectMultiScale(gray, 1.2, 5, minSize=(min_side, min_side))
    return [[int(x), int(y), int(w), int(h), 0.5] for (x, y, w, h) in boxes]


# -------------------- Composição / cena --------------------
def detect_native_split(gray):
    h, w = gray.shape[:2]
    if w < 200 or h < 200:
        return False
    sob = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    col_energy = np.mean(np.abs(sob), axis=0)
    mean_all = float(np.mean(col_energy)) + 1e-6
    c0 = int(w * 0.46); c1 = int(w * 0.54)
    center_max = float(np.max(col_energy[c0:c1]))
    center_col = int(w * 0.5)
    line = gray[:, max(0, center_col - 1):center_col + 2].astype(np.float32).mean(axis=1)
    line_std = float(np.std(line))
    return center_max > mean_all * 6.0 and line_std < 40.0


def hist_hsv(bgr):
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    h = cv2.calcHist([hsv], [0, 1], None, [30, 32], [0, 180, 0, 256])
    cv2.normalize(h, h, 0, 1, cv2.NORM_MINMAX)
    return h


def variance_of_laplacian_patch(frame_bgr, bbox, side=64):
    x, y, w, h = bbox
    ih, iw = frame_bgr.shape[:2]
    x0 = max(0, x); y0 = max(0, y)
    x1 = min(iw, x + w); y1 = min(ih, y + h)
    if x1 - x0 < 4 or y1 - y0 < 4:
        return 0.0
    patch = frame_bgr[y0:y1, x0:x1]
    try:
        patch = cv2.resize(patch, (side, side), interpolation=cv2.INTER_AREA)
        gray = cv2.cvtColor(patch, cv2.COLOR_BGR2GRAY)
        return float(cv2.Laplacian(gray, cv2.CV_64F).var())
    except Exception:
        return 0.0


# -------------------- Persistent Tracker --------------------
def iou(a, b):
    ax0, ay0, aw, ah = a; ax1, ay1 = ax0 + aw, ay0 + ah
    bx0, by0, bw, bh = b; bx1, by1 = bx0 + bw, by0 + bh
    ix0 = max(ax0, bx0); iy0 = max(ay0, by0)
    ix1 = min(ax1, bx1); iy1 = min(ay1, by1)
    iw = max(0, ix1 - ix0); ih = max(0, iy1 - iy0)
    inter = iw * ih
    ua = aw * ah + bw * bh - inter
    return inter / ua if ua > 0 else 0.0


class Track:
    __slots__ = ("id", "bbox", "score", "hits", "misses", "last_t", "born_t", "frames_out")

    def __init__(self, tid, bbox, score, t):
        self.id = tid
        self.bbox = list(bbox)  # x,y,w,h (float, EMA)
        self.score = score
        self.hits = 1
        self.misses = 0
        self.last_t = t
        self.born_t = t
        self.frames_out = []  # {t, bbox, score, blur, size_ratio}


class SimpleTracker:
    """IoU + centroid-distance com EMA. Sem numpy-Kalman para ficar leve."""
    def __init__(self, frame_w, frame_h, max_misses=6, iou_thr=0.3, dist_thr_ratio=0.08, size_ratio_tol=0.5):
        self.next_id = 0
        self.tracks = []  # active
        self.dead = []    # finalized
        self.W = frame_w
        self.H = frame_h
        self.max_misses = max_misses
        self.iou_thr = iou_thr
        self.dist_thr = dist_thr_ratio * frame_w
        self.size_tol = size_ratio_tol

    def _match(self, det):
        best = None
        best_score = 0.0
        for tr in self.tracks:
            i = iou(tr.bbox, det[:4])
            # centroid distance fallback
            tcx = tr.bbox[0] + tr.bbox[2] / 2
            tcy = tr.bbox[1] + tr.bbox[3] / 2
            dcx = det[0] + det[2] / 2
            dcy = det[1] + det[3] / 2
            dist = ((tcx - dcx) ** 2 + (tcy - dcy) ** 2) ** 0.5
            size_ratio = det[2] / max(1.0, tr.bbox[2])
            size_ok = (1 - self.size_tol) <= size_ratio <= (1 + self.size_tol)
            score = 0.0
            if i >= self.iou_thr:
                score = i + 0.5  # prioriza IoU
            elif dist <= self.dist_thr and size_ok:
                score = 0.4 + (1 - dist / self.dist_thr) * 0.4
            if score > best_score:
                best_score = score; best = tr
        return best, best_score

    def update(self, detections, t, frame_bgr):
        """detections: list of [x,y,w,h,score]. Assinala IDs, atualiza EMA."""
        used = set()
        # Ordena por score (maior primeiro) — matches confiantes vão primeiro
        det_order = sorted(range(len(detections)), key=lambda i: -detections[i][4])
        assignments = []  # (det_idx, track or None)
        for di in det_order:
            det = detections[di]
            best, sc = self._match(det)
            if best is not None and id(best) not in used:
                used.add(id(best))
                assignments.append((di, best))
            else:
                assignments.append((di, None))

        # Atualiza / cria
        matched_tracks = set()
        for di, tr in assignments:
            det = detections[di]
            bbox_det = det[:4]
            score = det[4]
            blur = variance_of_laplacian_patch(frame_bgr, bbox_det)
            size_ratio = round(det[3] / max(1, self.H), 4)
            if tr is None:
                nt = Track(self.next_id, bbox_det, score, t)
                self.next_id += 1
                nt.frames_out.append({
                    "t": round(t, 3),
                    "bbox": [int(bbox_det[0]), int(bbox_det[1]), int(bbox_det[2]), int(bbox_det[3])],
                    "score": round(float(score), 3),
                    "blur": round(blur, 2),
                    "size_ratio": size_ratio,
                })
                self.tracks.append(nt)
            else:
                # EMA update — alpha depende de quão brusca é a mudança
                alpha = 0.55
                tr.bbox = [
                    tr.bbox[0] * (1 - alpha) + bbox_det[0] * alpha,
                    tr.bbox[1] * (1 - alpha) + bbox_det[1] * alpha,
                    tr.bbox[2] * (1 - alpha) + bbox_det[2] * alpha,
                    tr.bbox[3] * (1 - alpha) + bbox_det[3] * alpha,
                ]
                tr.score = tr.score * 0.7 + score * 0.3
                tr.hits += 1
                tr.misses = 0
                tr.last_t = t
                matched_tracks.add(id(tr))
                tr.frames_out.append({
                    "t": round(t, 3),
                    "bbox": [int(tr.bbox[0]), int(tr.bbox[1]), int(tr.bbox[2]), int(tr.bbox[3])],
                    "score": round(float(tr.score), 3),
                    "blur": round(blur, 2),
                    "size_ratio": size_ratio,
                })

        # Envelhece não-vistos
        alive = []
        for tr in self.tracks:
            if id(tr) in matched_tracks:
                alive.append(tr)
            else:
                tr.misses += 1
                if tr.misses <= self.max_misses:
                    alive.append(tr)
                else:
                    self.dead.append(tr)
        self.tracks = alive

    def finalize(self):
        return self.dead + self.tracks


# -------------------- Main --------------------
def main():
    if len(sys.argv) < 2:
        _emit({"error": "missing video arg", "w": 0, "h": 0, "frames": [], "tracks": [], "detector": "none"})
        return
    video = sys.argv[1]
    sample_fps = float(sys.argv[2]) if len(sys.argv) > 2 else 4.0

    cap = cv2.VideoCapture(video)
    if not cap.isOpened():
        _emit({"error": "cannot open video", "w": 0, "h": 0, "frames": [], "tracks": [], "detector": "none"})
        return

    vfps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    if vfps <= 0 or vfps > 120:
        vfps = 30.0
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    duration = frame_count / vfps if frame_count > 0 else 0.0
    if w <= 0 or h <= 0:
        cap.release()
        _emit({"error": "invalid dimensions", "w": w, "h": h, "frames": [], "tracks": [], "detector": "none"})
        return

    step = max(1, int(round(vfps / max(0.25, sample_fps))))

    yolo = load_yolo()
    detector_name = "yolov10n-face" if yolo else "haar"
    cascade = None
    if not yolo:
        cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
        if cascade.empty():
            cap.release()
            _emit({"error": "haar cascade empty and no yolo", "w": w, "h": h, "frames": [], "tracks": [], "detector": "none"})
            return

    tracker = SimpleTracker(w, h)
    frames = []
    shots = []
    splits_run = None
    splits = []
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

            # Atualiza tracker persistente
            tracker.update(faces, t_sec, frame)

            frames.append({"t": t_sec, "faces": faces, "split": split, "shot": shot})
            if shot:
                shots.append(t_sec)
            if split:
                if splits_run is None:
                    splits_run = [t_sec, t_sec + 1.0 / sample_fps]
                else:
                    splits_run[1] = t_sec + 1.0 / sample_fps
            elif splits_run is not None:
                splits.append([round(splits_run[0], 3), round(splits_run[1], 3)])
                splits_run = None
        idx += 1

    if splits_run is not None:
        splits.append([round(splits_run[0], 3), round(splits_run[1], 3)])

    cap.release()

    all_tracks = tracker.finalize()
    tracks_out = []
    for tr in all_tracks:
        # Filtra tracks efêmeros ainda no python — mínimo 2 hits (~0.5s @ 4fps).
        if len(tr.frames_out) < 2:
            continue
        tracks_out.append({"id": tr.id, "frames": tr.frames_out})

    _emit({
        "w": w, "h": h,
        "detector": detector_name,
        "fps_sample": sample_fps,
        "duration": round(duration, 3),
        "frames": frames,
        "tracks": tracks_out,
        "shots": shots,
        "splits": splits,
    })


if __name__ == "__main__":
    main()
