"""On-board AI for the photobooth: person cut-out, face detection and face mesh.

All models are Google MediaPipe models run with LiteRT on the board's CPU.
They are downloaded once into the app's models/ folder; no images leave the board.
"""

import io
import urllib.request
import zipfile
from pathlib import Path

import cv2
import numpy as np
from ai_edge_litert.interpreter import Interpreter

from arduino.app_utils import Logger

logger = Logger("Vision")

MODELS_DIR = Path(__file__).resolve().parent.parent / "models"
SEGMENTER_URL = (
    "https://storage.googleapis.com/mediapipe-models/image_segmenter/"
    "selfie_segmenter_landscape/float16/latest/selfie_segmenter_landscape.tflite"
)
FACE_DETECTOR_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_detector/"
    "blaze_face_short_range/float16/latest/blaze_face_short_range.tflite"
)


FACE_LANDMARKER_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
    "face_landmarker/float16/1/face_landmarker.task"
)


def load_interpreter(url: str, threads: int = 4, member: str | None = None) -> Interpreter:
    """Download a model once (optionally one file out of a .task bundle) and load it."""
    path = MODELS_DIR / (member or url.rsplit("/", 1)[-1])
    if not path.exists():
        MODELS_DIR.mkdir(parents=True, exist_ok=True)
        logger.info(f"Downloading model {path.name}...")
        tmp = path.with_suffix(".part")
        if member:
            data = urllib.request.urlopen(url, timeout=60).read()
            tmp.write_bytes(zipfile.ZipFile(io.BytesIO(data)).read(member))
        else:
            urllib.request.urlretrieve(url, tmp)
        tmp.rename(path)
    interpreter = Interpreter(model_path=str(path), num_threads=threads)
    interpreter.allocate_tensors()
    return interpreter


class PersonSegmenter:
    """Returns a person-probability mask (float32, 0..1) for a BGR frame."""

    def __init__(self, smoothing: float = 0.35):
        self._it = load_interpreter(SEGMENTER_URL)
        self._in = self._it.get_input_details()[0]
        self._out = self._it.get_output_details()[0]
        _, self.height, self.width, _ = self._in["shape"]
        self._smoothing = smoothing  # weight of the previous mask, reduces flicker
        self._prev: np.ndarray | None = None

    def run(self, frame_bgr: np.ndarray) -> np.ndarray:
        small = cv2.resize(frame_bgr, (self.width, self.height), interpolation=cv2.INTER_AREA)
        rgb = cv2.cvtColor(small, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        self._it.set_tensor(self._in["index"], rgb[np.newaxis])
        self._it.invoke()
        mask = self._it.get_tensor(self._out["index"])[0, :, :, 0]

        if self._prev is not None and self._prev.shape == mask.shape:
            mask = mask * (1 - self._smoothing) + self._prev * self._smoothing
        self._prev = mask
        return mask


def _blazeface_anchors() -> np.ndarray:
    """SSD anchors for blaze_face_short_range (128x128 input, 896 anchors)."""
    anchors = []
    for stride, per_cell in ((8, 2), (16, 6)):
        size = 128 // stride
        for y in range(size):
            for x in range(size):
                anchors.extend([((x + 0.5) / size, (y + 0.5) / size)] * per_cell)
    return np.array(anchors, dtype=np.float32)


class FaceDetector:
    """BlazeFace: face boxes plus 6 keypoints, in normalized frame coordinates."""

    KEYPOINTS = ("rightEye", "leftEye", "nose", "mouth", "rightEar", "leftEar")  # the person's own left/right

    def __init__(self, min_score: float = 0.75, max_faces: int = 4):
        self._it = load_interpreter(FACE_DETECTOR_URL, threads=2)
        self._in = self._it.get_input_details()[0]
        outputs = self._it.get_output_details()
        self._reg = next(o for o in outputs if o["shape"][-1] == 16)
        self._cls = next(o for o in outputs if o["shape"][-1] == 1)
        self._anchors = _blazeface_anchors()
        self._min_score = min_score
        self._max_faces = max_faces

    def run(self, frame_bgr: np.ndarray) -> list[dict]:
        h, w = frame_bgr.shape[:2]
        scale = 128 / max(w, h)
        rw, rh = round(w * scale), round(h * scale)
        ox, oy = (128 - rw) // 2, (128 - rh) // 2
        canvas = np.zeros((128, 128, 3), dtype=np.uint8)
        canvas[oy : oy + rh, ox : ox + rw] = cv2.resize(frame_bgr, (rw, rh), interpolation=cv2.INTER_AREA)
        x = cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB).astype(np.float32) / 127.5 - 1.0

        self._it.set_tensor(self._in["index"], x[np.newaxis])
        self._it.invoke()
        reg = self._it.get_tensor(self._reg["index"])[0]
        logits = self._it.get_tensor(self._cls["index"])[0, :, 0].astype(np.float64)
        scores = 1 / (1 + np.exp(-np.clip(logits, -80, 80)))

        idx = np.where(scores >= self._min_score)[0]
        if not len(idx):
            return []

        a = self._anchors[idx]
        r = reg[idx] / 128.0
        cx, cy = r[:, 0] + a[:, 0], r[:, 1] + a[:, 1]
        bw, bh = r[:, 2], r[:, 3]
        boxes = np.stack([cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2], axis=1)
        kps = r[:, 4:16].reshape(-1, 6, 2) + a[:, None, :]

        def to_frame(px, py):  # 128x128 letterbox -> normalized frame coordinates
            return (px * 128 - ox) / rw, (py * 128 - oy) / rh

        faces = []
        for i in self._nms(boxes, scores[idx]):
            x1, y1 = to_frame(boxes[i, 0], boxes[i, 1])
            x2, y2 = to_frame(boxes[i, 2], boxes[i, 3])
            points = {
                name: [round(float(v), 4) for v in to_frame(*kps[i, k])] for k, name in enumerate(self.KEYPOINTS)
            }
            faces.append(
                {
                    "score": round(float(scores[idx][i]), 3),
                    "box": [round(float(v), 4) for v in (x1, y1, x2 - x1, y2 - y1)],
                    "points": points,
                }
            )
        return faces

    def _nms(self, boxes: np.ndarray, scores: np.ndarray, iou_threshold: float = 0.3) -> list[int]:
        order = list(np.argsort(-scores))
        keep = []
        while order and len(keep) < self._max_faces:
            i = order.pop(0)
            keep.append(i)
            rest = []
            for j in order:
                xx1, yy1 = max(boxes[i, 0], boxes[j, 0]), max(boxes[i, 1], boxes[j, 1])
                xx2, yy2 = min(boxes[i, 2], boxes[j, 2]), min(boxes[i, 3], boxes[j, 3])
                inter = max(0.0, xx2 - xx1) * max(0.0, yy2 - yy1)
                area_i = (boxes[i, 2] - boxes[i, 0]) * (boxes[i, 3] - boxes[i, 1])
                area_j = (boxes[j, 2] - boxes[j, 0]) * (boxes[j, 3] - boxes[j, 1])
                if inter / max(1e-6, area_i + area_j - inter) < iou_threshold:
                    rest.append(j)
            order = rest
        return keep


# Face mesh points sent to the browser for face art (MediaPipe face mesh indices).
# "right"/"left" are the person's own sides.
FACE_POINTS = {
    "rightEyeOuter": 33,
    "rightEyeInner": 133,
    "leftEyeInner": 362,
    "leftEyeOuter": 263,
    "rightIris": 468,
    "leftIris": 473,
    "foreheadTop": 10,
    "forehead": 151,
    "browCenter": 9,
    "noseBridge": 168,
    "noseTip": 1,
    "noseBottom": 2,
    "upperLipTop": 0,
    "upperLipInner": 13,
    "lowerLipInner": 14,
    "mouthRight": 61,
    "mouthLeft": 291,
    "chin": 152,
    "rightCheek": 205,
    "leftCheek": 425,
    "rightFace": 234,
    "leftFace": 454,
}


class FaceMesh:
    """MediaPipe face landmarks (478 points) for one face region of interest."""

    def __init__(self):
        self._it = load_interpreter(FACE_LANDMARKER_URL, threads=4, member="face_landmarks_detector.tflite")
        self._in = self._it.get_input_details()[0]
        outputs = self._it.get_output_details()
        self._lm = next(o for o in outputs if o["shape"][-1] == 1434)
        self._score = next(o for o in outputs if list(o["shape"]) == [1, 1, 1, 1])
        self.size = int(self._in["shape"][1])

    def run(self, frame_bgr: np.ndarray, center, size: float, angle: float) -> tuple[np.ndarray, float]:
        """Crop a rotated square around the face; return 478 (x, y) image points and a presence score."""
        S = self.size
        c, s = np.cos(angle), np.sin(angle)

        def to_image(u, v):
            dx, dy = (u / S - 0.5) * size, (v / S - 0.5) * size
            return center[0] + c * dx - s * dy, center[1] + s * dx + c * dy

        image_pts = np.float32([to_image(0, 0), to_image(S, 0), to_image(0, S)])
        roi_pts = np.float32([[0, 0], [S, 0], [0, S]])
        roi = cv2.warpAffine(frame_bgr, cv2.getAffineTransform(image_pts, roi_pts), (S, S), flags=cv2.INTER_LINEAR)
        x = cv2.cvtColor(roi, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0

        self._it.set_tensor(self._in["index"], x[np.newaxis])
        self._it.invoke()
        lm = self._it.get_tensor(self._lm["index"]).reshape(-1, 3)[:, :2]
        logit = float(self._it.get_tensor(self._score["index"]).ravel()[0])
        score = 1 / (1 + np.exp(-np.clip(logit, -80, 80)))

        back = cv2.getAffineTransform(roi_pts, image_pts)
        return lm @ back[:, :2].T + back[:, 2], score


def _roi_from_landmarks(pts: np.ndarray) -> tuple[tuple[float, float], float, float]:
    """Rotated square around a face mesh, used to track the face into the next frame."""
    angle = float(np.arctan2(*(pts[263] - pts[33])[::-1]))
    c, s = np.cos(-angle), np.sin(-angle)
    rot = pts @ np.array([[c, s], [-s, c]])
    lo, hi = rot.min(axis=0), rot.max(axis=0)
    mid = (lo + hi) / 2
    c2, s2 = np.cos(angle), np.sin(angle)
    center = (mid[0] * c2 - mid[1] * s2, mid[0] * s2 + mid[1] * c2)
    return center, float(max(hi - lo) * 1.5), angle


class FaceTracker:
    """Finds faces with BlazeFace, then follows each one with the 478-point face mesh."""

    def __init__(self, max_faces: int = 3, redetect_every: int = 10):
        self._detector = FaceDetector(max_faces=max_faces)
        self._mesh = FaceMesh()
        self._tracks: list[tuple] = []
        self._max_faces = max_faces
        self._redetect_every = redetect_every
        self._frames = 0

    def run(self, frame_bgr: np.ndarray) -> list[dict]:
        h, w = frame_bgr.shape[:2]
        self._frames += 1

        rois = list(self._tracks)
        if not rois or self._frames % self._redetect_every == 0:
            for det in self._detector.run(frame_bgr):
                x, y, bw, bh = det["box"]
                re, le = det["points"]["rightEye"], det["points"]["leftEye"]
                angle = float(np.arctan2((le[1] - re[1]) * h, (le[0] - re[0]) * w))
                roi = (((x + bw / 2) * w, (y + bh / 2) * h), max(bw * w, bh * h) * 1.5, angle)
                if not any(self._near(roi, r) for r in rois):
                    rois.append(roi)

        faces, tracks = [], []
        for roi in rois[: self._max_faces]:
            pts, score = self._mesh.run(frame_bgr, *roi)
            if score < 0.5:
                continue
            track = _roi_from_landmarks(pts)
            if any(self._near(track, t) for t in tracks):
                continue  # same face found twice
            tracks.append(track)
            faces.append(
                {
                    "score": round(float(score), 3),
                    "points": {
                        name: [round(float(pts[i, 0]) / w, 4), round(float(pts[i, 1]) / h, 4)]
                        for name, i in FACE_POINTS.items()
                    },
                }
            )
        self._tracks = tracks
        return faces

    @staticmethod
    def _near(a, b) -> bool:
        return np.hypot(a[0][0] - b[0][0], a[0][1] - b[0][1]) < min(a[1], b[1]) * 0.3
