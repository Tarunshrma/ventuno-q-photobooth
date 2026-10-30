import base64
import json
import math
import re
import time
from datetime import datetime
from pathlib import Path
from threading import Condition, Lock

import cv2
import numpy as np
import qrcode
import qrcode.image.svg
from fastapi import HTTPException, Request
from fastapi.responses import Response
from arduino.app_bricks.gesture_recognition import GestureRecognition
from arduino.app_bricks.web_ui import WebUI
from arduino.app_peripherals.camera import Camera
from arduino.app_utils import App, Logger

from payments import BoothAgent
from voice import BoothVoice
from vision import FaceTracker, PersonSegmenter


logger = Logger("FestivePhotobooth")

# Photos taken in the browser are also saved on the board, inside the app folder.
PHOTOS_DIR = Path(__file__).resolve().parent.parent / "photos"
DATA_URL_PREFIX = "data:image/jpeg;base64,"

CAMERA_RESOLUTION = (1280, 720)
MASK_SIZE = (320, 180)  # person mask sent to the browser, under the camera image
JPEG_QUALITY = 80

# Gesture actions: what each gesture does, how long to hold it, and the pause before it can fire again
ACTIONS = {
    "photo": {"hold": 0.6, "cooldown": 8.0},  # ✌️ V sign or 🙏 namaste
    "finale": {"hold": 0.4, "cooldown": 4.0},  # 👍 thumbs up
    "spark": {"hold": 0.25, "cooldown": 0.8},  # ☝️ pointing up: effect at the fingertip
    "theme": {"hold": 0.6, "cooldown": 3.0},  # 🤟 "I love you" sign: next theme
    "clear": {"hold": 0.6, "cooldown": 2.0},  # 👎 thumbs down: remove all face props
}
SINGLE_HAND_ACTIONS = {"Thumb_Up": "finale", "Pointing_Up": "spark", "ILoveYou": "theme", "Thumb_Down": "clear"}
HAND_FRESH_S = 0.35  # hand positions older than this are not shown
# Hands this close to the left/right edge are pointing at prop tiles, so they don't make gestures
SIDE_ZONE = 0.24
GESTURE_GAP_S = 0.4  # tolerated gap between detections while holding
MAX_EVENTS = 20

ui = WebUI()
segmenter = PersonSegmenter()
face_tracker = FaceTracker()
voice = BoothVoice(lambda command, text: on_voice_command(command, text))
booth_agent = BoothAgent(voice)

# Newest camera frame, handed over by the gesture brick's capture thread
raw_lock = Condition()
raw_frame: np.ndarray | None = None

# Latest processed frame, handed to browsers by /frame
frame_cond = Condition()
latest: tuple[int, bytes, dict] | None = None
frame_id = 0
camera_missing = False
gestures: GestureRecognition | None = None
faces: list[dict] = []
stats = {"frames": 0, "busy": 0.0, "since": time.monotonic()}

frame_size = CAMERA_RESOLUTION

gesture_lock = Lock()
action_state = {name: {"gesture": None, "since": 0.0, "last": 0.0, "fired_at": 0.0} for name in ACTIONS}
events: list[dict] = []  # recent gesture events for the browser, newest last
event_id = 0
hands_now: list[dict] = []  # latest hand pointers (index fingertip), for the on-screen cursors
hands_at = 0.0

# The "controller": the person nearest the center of the frame. Only their hands drive
# gestures and the prop tiles, so a group photo doesn't fight over the controls.
# Every hand is matched to the nearest face (by its wrist); other people's hands are ignored.
controller: tuple[float, float, float] | None = None  # face center x, y and width (normalized)
controller_seen_at = 0.0
face_boxes: list[tuple[float, float, float]] = []  # all faces in the latest frame
CONTROLLER_KEEP_S = 1.0  # keep the controller through brief face-detection misses
CONTROLLER_SWITCH = 0.08  # another person must be this much closer to center to take over


# ---------- Gestures (MediaPipe gesture model on the board's NPU) ----------


def _xy(point) -> tuple[float, float]:
    """A landmark as (x, y), whether it arrives as a tuple/list or a dict."""
    if isinstance(point, dict):
        return float(point["x"]), float(point["y"])
    return float(point[0]), float(point[1])


def _hand_box(hand: dict) -> tuple[float, float, float, float] | None:
    box = hand.get("bounding_box_xyxy")
    if box and len(box) == 4:
        return tuple(float(v) for v in box)
    points = [_xy(p) for p in hand.get("landmarks") or []]
    if points:
        xs, ys = zip(*points)
        return min(xs), min(ys), max(xs), max(ys)
    return None


def _is_namaste(hands: list[dict]) -> bool:
    """Two hands pressed together: their boxes are side by side and touching."""
    boxes = [b for b in (_hand_box(h) for h in hands) if b]
    if len(boxes) < 2:
        return False
    (ax1, ay1, ax2, ay2), (bx1, by1, bx2, by2) = boxes[:2]
    size = ((ax2 - ax1) + (bx2 - bx1) + (ay2 - ay1) + (by2 - by1)) / 4
    dx = abs((ax1 + ax2) / 2 - (bx1 + bx2) / 2)
    dy = abs((ay1 + ay2) / 2 - (by1 + by2) / 2)
    return dx < size * 0.9 and dy < size * 0.6


def _landmarks(hand: dict) -> list[tuple[float, float]]:
    """The 21 hand landmarks, normalized to the camera frame (empty if not provided)."""
    points = [_xy(p) for p in hand.get("landmarks") or []]
    if points and max(max(abs(x), abs(y)) for x, y in points) > 1.5:  # pixel coordinates
        points = [(x / frame_size[0], y / frame_size[1]) for x, y in points]
    return points


def _palm(hand: dict) -> list[float] | None:
    """Palm center (wrist, index and pinky knuckles), normalized."""
    pts = _landmarks(hand)
    if len(pts) < 21:
        return _fingertip(hand)
    x = (pts[0][0] + pts[5][0] + pts[17][0]) / 3
    y = (pts[0][1] + pts[5][1] + pts[17][1]) / 3
    return [round(x, 4), round(y, 4)]


def _in_side_zone(pos: list[float] | None) -> bool:
    return pos is not None and (pos[0] < SIDE_ZONE or pos[0] > 1 - SIDE_ZONE)


def _fingertip(hand: dict) -> list[float] | None:
    """Index fingertip (hand landmark 8), else top-center of the hand box; normalized to the camera frame."""
    points = hand.get("landmarks") or []
    if len(points) > 8:
        x, y = _xy(points[8])
        pixels = max(abs(x), abs(y)) > 1.5
    else:
        box = _hand_box(hand)
        if not box:
            return None
        x, y = (box[0] + box[2]) / 2, box[1]
        pixels = max(box) > 1.5
    if pixels:
        x, y = x / frame_size[0], y / frame_size[1]
    return [round(x, 4), round(y, 4)]


def _face_box(face: dict) -> tuple[float, float, float]:
    p = face["points"]
    return (p["rightFace"][0] + p["leftFace"][0]) / 2, p["noseTip"][1], abs(p["leftFace"][0] - p["rightFace"][0])


def update_controller(found: list[dict]) -> int | None:
    """Pick the controller among the faces; returns its index in `found`."""
    global controller, controller_seen_at, face_boxes
    now = time.monotonic()
    boxes = [_face_box(f) for f in found]
    face_boxes = boxes
    if not boxes:
        if controller and now - controller_seen_at > CONTROLLER_KEEP_S:
            controller = None
        return None

    def off_center(i):
        return abs(boxes[i][0] - 0.5)

    best = min(range(len(boxes)), key=off_center)
    if controller:
        # Stay with the current controller unless someone else is clearly more central
        near = min(range(len(boxes)), key=lambda i: abs(boxes[i][0] - controller[0]) + abs(boxes[i][1] - controller[1]))
        if abs(boxes[near][0] - controller[0]) < controller[2] and off_center(near) <= off_center(best) + CONTROLLER_SWITCH:
            best = near
    controller, controller_seen_at = boxes[best], now
    return best


def _is_controllers_hand(hand: dict) -> bool:
    """True if this hand's wrist is closer to the controller's face than to anyone else's."""
    c, boxes = controller, face_boxes
    if c is None:
        return True  # nobody detected yet: any hand may act
    pts = _landmarks(hand)
    wrist = pts[0] if pts else _palm(hand)
    if wrist is None:
        return False
    aspect = frame_size[0] / frame_size[1]

    def dist(box):
        return math.hypot((wrist[0] - box[0]) * aspect, wrist[1] - box[1])

    others = [b for b in boxes if abs(b[0] - c[0]) > 1e-6 or abs(b[1] - c[1]) > 1e-6]
    return all(dist(c) <= dist(b) for b in others)


def on_hands(metadata: dict):
    """Turn the gesture model's detections into held-gesture actions (controller's hands only)."""
    hands = [h for h in metadata.get("hands", []) if _is_controllers_hand(h)]

    global event_id, hands_now, hands_at
    now = time.monotonic()
    pointers = [{"pos": p, "gesture": h.get("gesture")} for h in hands if (p := _fingertip(h))]
    with gesture_lock:
        hands_now, hands_at = pointers, now

    # Hands at the sides are choosing props (finger count), so they don't trigger gestures
    hands = [h for h in hands if not _in_side_zone(_fingertip(h))]
    seen: dict[str, tuple[str, list[float] | None]] = {}
    for h in hands:
        if h.get("confidence", 0) < 0.6:
            continue
        name = h.get("gesture")
        if name == "Victory":
            seen["photo"] = ("victory", None)
        elif name in SINGLE_HAND_ACTIONS:
            seen[SINGLE_HAND_ACTIONS[name]] = (name, _fingertip(h))
    if "photo" not in seen and _is_namaste(hands):
        seen["photo"] = ("namaste", None)

    with gesture_lock:
        for action, (name, pos) in seen.items():
            state = action_state[action]
            if name != state["gesture"] or now - state["last"] > GESTURE_GAP_S:
                state.update(gesture=name, since=now)
            state["last"] = now
            rule = ACTIONS[action]
            if now - state["since"] >= rule["hold"] and now - state["fired_at"] > rule["cooldown"]:
                state["fired_at"] = now
                _push_event_locked(action, gesture=name, pos=pos)
                logger.info(f"Gesture {name} -> {action}")


def _push_event_locked(action: str, **info):
    """Queue an action for the browser (caller holds gesture_lock)."""
    global event_id
    event_id += 1
    events.append({"id": event_id, "action": action, **info})
    del events[:-MAX_EVENTS]


def push_event(action: str, **info):
    with gesture_lock:
        _push_event_locked(action, **info)


def on_voice_command(command: str, text: str):
    """Spoken commands, recognised on the board (Whisper)."""
    if command in ("ready", "repeat", "cancel"):
        booth_agent.signal(command)  # replies during a voice-payment conversation
    elif command == "greeting":
        push_event("print", source="voice", greeting=True, text=text)  # "Happy Diwali!" = print it
    elif command.startswith("theme:"):
        push_event("theme", value=command.split(":", 1)[1], source="voice", text=text)
    else:
        push_event(command, source="voice", text=text)  # photo, print, clear


def gesture_meta() -> dict:
    """Gesture info for the browser: photo-gesture hold progress and recent events."""
    now = time.monotonic()
    with gesture_lock:
        photo = action_state["photo"]
        active = photo["gesture"] if now - photo["last"] < GESTURE_GAP_S else None
        hold = min(1.0, (now - photo["since"]) / ACTIONS["photo"]["hold"]) if active else 0.0
        hands = hands_now if now - hands_at < HAND_FRESH_S else []
        return {
            "gesture": active,
            "hold": round(hold, 2),
            "events": list(events),
            "eventId": event_id,
            "hands": hands,
            "voice": voice.status(),
        }


def on_camera_frame(frame: np.ndarray):
    """Called from the gesture brick's capture thread: just hand the frame over."""
    global raw_frame
    with raw_lock:
        raw_frame = frame
        raw_lock.notify()


def start_camera():
    """Open the camera once one is plugged in, so the web page works even without it."""
    global gestures, camera_missing
    try:
        camera = Camera(resolution=CAMERA_RESOLUTION, fps=30, codec="MJPG")
        gestures = GestureRecognition(camera)
        gestures.on_frame(on_camera_frame)
        for name in ("None", "Open_Palm", "Victory", "Closed_Fist", "Pointing_Up", "Thumb_Up", "Thumb_Down", "ILoveYou"):
            gestures.on_gesture(name, on_hands)
        App.start_brick(gestures)  # also starts the camera
        camera_missing = False
        logger.info("Camera and gesture recognition started")
    except Exception as exc:
        gestures = None
        if not camera_missing:
            logger.warning(f"Camera not available yet ({exc}); retrying every 3 s")
        camera_missing = True
        time.sleep(3)


# ---------- Web API ----------


def get_frame(after: int = 0):
    """Long-poll: returns the next processed frame newer than `after`.

    The JPEG holds the camera image on top and the person mask in a strip below it,
    so image and mask always match. AI results travel in the X-Frame-Meta header.
    """
    with frame_cond:
        frame_cond.wait_for(lambda: latest is not None and latest[0] > after, timeout=1.0)
        current = latest
    if current is None or current[0] <= after:
        return Response(status_code=204, headers={"X-Camera": "missing" if camera_missing else "starting"})
    _, data, meta = current
    return Response(
        content=data,
        media_type="image/jpeg",
        headers={"X-Frame-Meta": json.dumps({**meta, **gesture_meta()}), "Cache-Control": "no-store"},
    )


async def save_photo(request: Request):
    """Receive a finished photo (JPEG data URL) from the browser and store it."""
    data = await request.json()
    image = str(data.get("image", ""))
    if not image.startswith(DATA_URL_PREFIX):
        raise HTTPException(status_code=400, detail="Expected a JPEG data URL")

    theme = re.sub(r"[^a-z0-9_-]", "", str(data.get("theme", "photo")).lower())[:20] or "photo"
    filename = f"{theme}_{datetime.now():%Y%m%d_%H%M%S}.jpg"

    try:
        PHOTOS_DIR.mkdir(parents=True, exist_ok=True)
        (PHOTOS_DIR / filename).write_bytes(base64.b64decode(image[len(DATA_URL_PREFIX):]))
    except Exception as exc:
        logger.exception(f"Saving photo failed: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))

    logger.info(f"Saved photo {filename}")
    return {"filename": filename}


# ---------- Frame processing (person cut-out + faces, on the board's CPU) ----------


def process(frame: np.ndarray) -> tuple[bytes, dict]:
    global faces, frame_size
    h, w = frame.shape[:2]
    frame_size = (w, h)

    mask = segmenter.run(frame)
    coverage = float((mask > 0.5).mean())

    # Face mesh on every frame, so props stay glued to faces
    faces = face_tracker.run(frame)
    controller_index = update_controller(faces)

    strip = np.zeros((MASK_SIZE[1], w, 3), dtype=np.uint8)
    small_mask = cv2.resize((mask * 255).astype(np.uint8), MASK_SIZE, interpolation=cv2.INTER_LINEAR)
    strip[:, : MASK_SIZE[0]] = small_mask[:, :, np.newaxis]
    ok, jpeg = cv2.imencode(".jpg", np.vstack([frame, strip]), [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
    if not ok:
        raise RuntimeError("JPEG encoding failed")

    meta = {
        "width": w,
        "height": h,
        "maskWidth": MASK_SIZE[0],
        "maskHeight": MASK_SIZE[1],
        "coverage": round(coverage, 3),
        "faces": faces,
        "controller": controller_index,
    }
    return jpeg.tobytes(), meta


def loop():
    global latest, frame_id, raw_frame

    voice.tick()  # open the speaker / microphone once they're plugged in
    if gestures is None:
        start_camera()
        return

    with raw_lock:
        raw_lock.wait_for(lambda: raw_frame is not None, timeout=0.5)
        frame, raw_frame = raw_frame, None
    if frame is None:
        return

    started = time.monotonic()
    data, meta = process(frame)
    stats["busy"] += time.monotonic() - started
    stats["frames"] += 1

    with frame_cond:
        frame_id += 1
        meta["id"] = frame_id
        latest = (frame_id, data, meta)
        frame_cond.notify_all()

    elapsed = time.monotonic() - stats["since"]
    if elapsed >= 30:
        n = stats["frames"]
        logger.info(
            f"{n / elapsed:.1f} fps, {stats['busy'] / max(1, n) * 1000:.1f} ms AI+encode per frame, "
            f"{frame.shape[1]}x{frame.shape[0]}, {len(faces)} face(s)"
        )
        stats.update(frames=0, busy=0.0, since=time.monotonic())


async def agent_print(request: Request):
    """Ask the Booth Agent to buy a print of this photo from the Print Agent."""
    data = await request.json()
    image = str(data.get("image", ""))
    if not image.startswith(DATA_URL_PREFIX):
        raise HTTPException(status_code=400, detail="Expected a JPEG data URL")
    return {"jobId": booth_agent.request_print(image, str(data.get("theme", "photo")))}


def agent_status():
    return booth_agent.status()


async def agent_config(request: Request):
    try:
        return booth_agent.configure(await request.json())
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid settings: {exc}")


async def guest_typed_data(request: Request):
    """Guest wallet connected via WalletConnect: return the USDC authorization for it to sign."""
    data = await request.json()
    try:
        return booth_agent.guest_typed_data(str(data.get("jobId")), str(data.get("address")))
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


async def guest_signature(request: Request):
    """The guest's wallet signed (or declined); the Booth Agent forwards it to the Print Agent."""
    data = await request.json()
    try:
        booth_agent.guest_signature(str(data.get("jobId")), data.get("signature"), data.get("error"))
        return {"ok": True}
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


async def qr_code(request: Request):
    """SVG QR code for the WalletConnect pairing link shown on the booth screen."""
    text = str((await request.json()).get("text", ""))
    if not text or len(text) > 2000:
        raise HTTPException(status_code=400, detail="Missing or too long text")
    img = qrcode.make(text, image_factory=qrcode.image.svg.SvgPathImage, box_size=10, border=2)
    return Response(content=img.to_string(encoding="unicode"), media_type="image/svg+xml")


ui.expose_api("GET", "/frame", get_frame)
ui.expose_api("POST", "/photo", save_photo)
ui.expose_api("POST", "/agent/print", agent_print)
ui.expose_api("GET", "/agent/status", agent_status)
ui.expose_api("POST", "/agent/config", agent_config)
ui.expose_api("POST", "/agent/guest/typed-data", guest_typed_data)
ui.expose_api("POST", "/agent/guest/signature", guest_signature)
ui.expose_api("POST", "/agent/qr", qr_code)


async def voice_say(request: Request):
    """The page asks the booth to say something (countdown, greetings)."""
    data = await request.json()
    text = str(data.get("text", ""))[:300]
    if text:
        voice.say(text, low=bool(data.get("low")))
    return {"ok": True}


async def voice_preload(request: Request):
    """The page lists the lines it may say (theme, props); the board generates them in advance."""
    texts = [str(t)[:300] for t in (await request.json()).get("texts", [])][:200]
    voice.preload(texts)
    return {"ok": True, "count": len(texts)}


def voice_clip(clip_id: int):
    """One synthesized sentence (WAV), played by the booth page through the monitor / Bluetooth / laptop."""
    wav = voice.clip(clip_id)
    if wav is None:
        raise HTTPException(status_code=404, detail="Clip not found")
    return Response(content=wav, media_type="audio/wav", headers={"Cache-Control": "no-store"})


async def voice_config(request: Request):
    data = await request.json()
    if "enabled" in data:
        voice.enabled = bool(data["enabled"])
    return voice.status()


async def agent_signal(request: Request):
    """👍 or a button during a voice payment: "ready", "repeat" or "cancel"."""
    data = await request.json()
    return {"ok": booth_agent.signal(str(data.get("signal")), data.get("jobId"))}


ui.expose_api("POST", "/voice/say", voice_say)
ui.expose_api("GET", "/voice/clip/{clip_id}", voice_clip)
ui.expose_api("POST", "/voice/preload", voice_preload)

# Fixed lines the board itself says during voice payments: generate them up front
voice.preload(
    [
        "Open Claude on your phone, start voice mode, and hold the phone near me.",
        "Say ready, or show a thumbs up, when Claude is listening.",
        "Payment received from your agent. Printing now!",
        "Your print is ready. Enjoy the celebration!",
        "Sorry, the payment did not go through. You can try again.",
    ]
)
ui.expose_api("POST", "/voice/config", voice_config)
ui.expose_api("POST", "/agent/signal", agent_signal)

App.run(user_loop=loop)
