"""Booth voice: speaks with on-board text-to-speech (Piper) and listens with on-board
speech recognition (Whisper). Both run on the board's NPU.

Speech is synthesized on the board into short WAV clips and played by the booth's web
page, so it comes out of whatever the browser uses: the HDMI monitor's speakers, a
Bluetooth speaker paired with the board, or a laptop showing the page.

The microphone (the webcam's) may be plugged in after the app starts, so listening is
started lazily and retried. Without it the booth still talks; everything else keeps working.

Commands are recognised from short sentences. To avoid reacting to crowd chatter, a
command needs the wake word "booth" ("Booth, take a photo"), except for the replies the
booth is currently waiting for (e.g. "ready" after it asks "say ready").
"""

import queue
import re
import threading
import time

import numpy as np
from arduino.app_bricks.asr import AutomaticSpeechRecognition
from arduino.app_bricks.tts import TextToSpeech
from arduino.app_peripherals.speaker import BaseSpeaker
from arduino.app_utils import App, Logger

logger = Logger("BoothVoice")

RETRY_S = 10  # how often to retry opening the TTS service / microphone
SAMPLE_RATE = 22050
MAX_CLIPS = 20
PLAYBACK_MARGIN_S = 0.8  # browser start-up delay + room echo before listening again
CACHE_MAX = 300  # generated sentences kept in memory
SENTENCES = re.compile(r"(?<=[.!?])\s+")


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in SENTENCES.split(text) if s.strip()]


class BrowserSpeaker(BaseSpeaker):
    """A 'speaker' with no device: the TTS brick only synthesizes; the web page plays the clips."""

    def __init__(self):
        super().__init__(sample_rate=SAMPLE_RATE, channels=1, format=np.int16, buffer_size=1024, auto_reconnect=False)
        self.name = "BrowserSpeaker"

    def _open_speaker(self) -> None:
        pass

    def _close_speaker(self) -> None:
        pass

    def _write_audio(self, audio_chunk: np.ndarray) -> None:
        pass
WAKE = re.compile(r"\b(photo ?booth|booth|boot|both)\b", re.I)
COMMANDS = [  # first match wins
    # The festive greeting prints the photo (no wake word needed; the page ignores it unless a photo is waiting)
    ("greeting", re.compile(r"\bhappy\s+(d[ie]{1,2}[wv]a?l[iy]|deepa?vali|hall?[oa]w[e]{1,2}n|hello\s*ween)\b", re.I)),
    ("cancel", re.compile(r"\b(cancel|never ?mind|stop)\b", re.I)),
    ("repeat", re.compile(r"\b(repeat|say (it|that) again|again)\b", re.I)),
    ("ready", re.compile(r"\b(ready|i'?m ready|listening|go ahead)\b", re.I)),
    ("print", re.compile(r"\bprint\b", re.I)),
    ("photo", re.compile(r"\b(photo|picture|pic|cheese|selfie|snap)\b", re.I)),
    ("theme:halloween", re.compile(r"\bhallowe?en\b", re.I)),
    ("theme:diwali", re.compile(r"\b(diwali|deepavali)\b", re.I)),
    ("clear", re.compile(r"\b(remove|clear)\b.*\bprops?\b", re.I)),
]
NO_WAKE_WORD = {"greeting"}  # commands accepted without saying "booth"
# Whisper sometimes "hears" these in silence
HALLUCINATIONS = {"", "you", "thank you", "thank you.", "thanks for watching!", "bye.", "."}


class BoothVoice:
    def __init__(self, on_command):
        """on_command(command, transcript) is called for every recognised command."""
        self.enabled = True
        self._on_command = on_command
        self._tts: TextToSpeech | None = None
        self._asr: AutomaticSpeechRecognition | None = None
        self._lock = threading.Lock()
        self._next_try = 0.0
        self.speaker_error: str | None = "not started yet"
        self.mic_error: str | None = "not started yet"
        self.expecting: set[str] = set()  # replies accepted without the wake word
        self.heard: dict = {"text": "", "command": None, "t": 0.0}
        self.said: dict = {"text": "", "t": 0.0}
        self._listener: threading.Thread | None = None
        # Synthesized clips for the web page to play, newest last
        self._clips: list[dict] = []
        self._clip_audio: dict[int, bytes] = {}
        self._clip_id = 0
        self._queue: queue.Queue = queue.Queue()
        self._speaking_until = 0.0
        self._synthesizing = False
        self._cache: dict[str, bytes] = {}  # sentence -> WAV, so repeated lines play instantly
        self._preload: queue.Queue = queue.Queue()
        threading.Thread(target=self._speech_worker, daemon=True).start()

    # ---------- lifecycle ----------

    def tick(self):
        """Called regularly from the app loop: start speech synthesis and the microphone when available."""
        if self._tts and self._asr or time.monotonic() < self._next_try:
            return
        self._next_try = time.monotonic() + RETRY_S
        if not self._tts:
            try:
                tts = TextToSpeech(speaker=BrowserSpeaker())
                App.start_brick(tts)
                self._tts, self.speaker_error = tts, None
                logger.info("Speech synthesis ready: the booth can talk (played by the web page)")
            except Exception as exc:
                self.speaker_error = str(exc)
        if not self._asr:
            try:
                asr = AutomaticSpeechRecognition(language="en")
                App.start_brick(asr)
                self._asr, self.mic_error = asr, None
                logger.info("Microphone ready: the booth is listening")
                self._listener = threading.Thread(target=self._listen_loop, daemon=True)
                self._listener.start()
            except Exception as exc:
                self.mic_error = str(exc)

    def status(self) -> dict:
        return {
            "enabled": self.enabled,
            "speaker": self._tts is not None,  # speech synthesis ready (played by the web page)
            "mic": self._asr is not None,
            "speakerError": self.speaker_error,
            "micError": self.mic_error,
            "heard": self.heard,
            "said": self.said,
            "clips": [{"id": c["id"], "text": c["text"]} for c in self._clips[-5:]],
            "speaking": self.is_speaking(),
        }

    def clip(self, clip_id: int) -> bytes | None:
        return self._clip_audio.get(clip_id)

    # ---------- talking ----------

    def say(self, text: str, block: bool = False, low: bool = False):
        """Speak (in the background by default). Listening pauses so the booth doesn't hear itself.

        Long text is split into sentences so the first one plays while the next is generated.
        `low`: a hint or nicety; dropped if the booth is already behind, so speech never lags the action.
        With block=True, returns once the speech has (approximately) finished playing.
        """
        if not (self.enabled and self._tts):
            self.said = {"text": text, "t": time.time()}
            logger.info(f"(silent) {text}")
            if block:
                time.sleep(min(6.0, 0.06 * len(text)))  # keep the conversation pacing without audio
            return
        if low and (not self._queue.empty() or self._synthesizing):
            return
        self.said = {"text": text, "t": time.time()}
        if self._asr:
            try:
                if self._asr.is_transcribing():
                    self._asr.cancel()
            except Exception:
                pass
        done = None
        for sentence in _sentences(text):
            done = threading.Event()
            self._queue.put((sentence, done))
        if block and done:
            done.wait(30)
            while time.monotonic() < self._speaking_until:
                time.sleep(0.1)

    def preload(self, texts):
        """Generate these lines in the background now, so saying them later is instant."""
        for text in texts:
            for sentence in _sentences(str(text)):
                if sentence not in self._cache:
                    self._preload.put(sentence)

    def _wav_for(self, text: str) -> bytes:
        wav = self._cache.get(text)
        if wav is None:
            started = time.monotonic()
            wav = self._tts.synthesize_wav(text)
            logger.debug(f"Synthesized {len(text)} chars in {(time.monotonic() - started) * 1000:.0f} ms")
            self._cache[text] = wav
            while len(self._cache) > CACHE_MAX:
                self._cache.pop(next(iter(self._cache)))
        return wav

    def _speech_worker(self):
        """Turn queued sentences into WAV clips for the page to play, in order.

        When nothing is waiting to be said, it pre-generates lines from the preload queue.
        """
        while True:
            try:
                text, done = self._queue.get(timeout=0.2)
            except queue.Empty:
                self._preload_one()
                continue
            self._synthesizing = text not in self._cache
            try:
                wav = self._wav_for(text)
                seconds = max(0.0, (len(wav) - 44) / (SAMPLE_RATE * 2))
                with self._lock:
                    self._clip_id += 1
                    self._clips.append({"id": self._clip_id, "text": text})
                    self._clip_audio[self._clip_id] = wav
                    for old in self._clips[:-MAX_CLIPS]:
                        self._clip_audio.pop(old["id"], None)
                    del self._clips[:-MAX_CLIPS]
                    start = max(time.monotonic(), self._speaking_until)
                    self._speaking_until = start + seconds + PLAYBACK_MARGIN_S
            except Exception as exc:
                logger.warning(f"Could not synthesize speech: {exc}")
            finally:
                self._synthesizing = False
                done.set()

    def _preload_one(self):
        if not self._tts or self._preload.empty():
            return
        try:
            sentence = self._preload.get_nowait()
            if sentence not in self._cache:
                self._wav_for(sentence)
        except Exception as exc:
            logger.debug(f"Preload skipped: {exc}")

    def is_speaking(self) -> bool:
        return self._synthesizing or time.monotonic() < self._speaking_until or not self._queue.empty()

    # ---------- listening ----------

    def _listen_loop(self):
        quiet_until = 0.0
        while True:
            if not self.enabled or self.is_speaking():
                quiet_until = time.monotonic() + 0.6  # let the room go quiet after the booth speaks
                time.sleep(0.2)
                continue
            if time.monotonic() < quiet_until:
                time.sleep(0.1)
                continue
            try:
                text = (self._asr.transcribe_sentence(timeout=8) or "").strip()
            except Exception as exc:
                logger.debug(f"Listening paused: {exc}")
                time.sleep(1.0)
                continue
            if text.lower() in HALLUCINATIONS or len(text) < 2:
                continue
            self._handle(text)

    def _handle(self, text: str):
        woke = bool(WAKE.search(text))
        command = next((name for name, pattern in COMMANDS if pattern.search(text)), None)
        if command and not (woke or command in self.expecting or command in NO_WAKE_WORD):
            command = None  # no wake word and not a reply we're waiting for: ignore
        self.heard = {"text": text, "command": command, "t": time.time()}
        logger.info(f"Heard: {text!r} -> {command or 'no command'}")
        if command:
            try:
                self._on_command(command, text)
            except Exception:
                logger.exception("Voice command failed")
