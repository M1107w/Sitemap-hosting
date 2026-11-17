"""Kokoro text-to-speech as a tiny HTTP service (open source, runs on CPU).

POST /synthesize  {"text": "...", "voice": "bm_george", "speed": 0.95}  -> audio/wav
GET  /voices      -> ["af_heart", "bm_george", ...]
GET  /health      -> {"ok": true}
"""
import io
import json
import os
import threading
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
from kokoro_onnx import Kokoro

MODEL = os.environ.get("KOKORO_MODEL", "/models/kokoro.onnx")
VOICES = os.environ.get("KOKORO_VOICES", "/models/voices.bin")
DEFAULT_VOICE = os.environ.get("KOKORO_VOICE", "bm_george")

kokoro = Kokoro(MODEL, VOICES)
VOICE_NAMES = sorted(kokoro.get_voices())
lock = threading.Lock()  # one synthesis at a time: keeps the small CPU snappy


def to_wav(samples, sample_rate):
    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


def synthesize(text, voice, speed):
    if voice not in VOICE_NAMES:
        voice = DEFAULT_VOICE
    lang = "en-gb" if voice[:1] == "b" else "en-us"
    with lock:
        samples, sr = kokoro.create(text, voice=voice, speed=speed, lang=lang)
    return to_wav(samples, sr)


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            return self._send(200, b'{"ok":true}')
        if self.path == "/voices":
            return self._send(200, json.dumps(VOICE_NAMES).encode())
        self._send(404, b'{"error":"not found"}')

    def do_POST(self):
        if self.path != "/synthesize":
            return self._send(404, b'{"error":"not found"}')
        try:
            data = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
            text = str(data.get("text", "")).strip()[:1000]
            if not text:
                return self._send(400, b'{"error":"no text"}')
            speed = min(1.5, max(0.6, float(data.get("speed", 1.0))))
            self._send(200, synthesize(text, str(data.get("voice", DEFAULT_VOICE)), speed), "audio/wav")
        except Exception as e:  # keep the service up whatever happens
            self._send(500, json.dumps({"error": str(e)}).encode())

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    synthesize("Ready, sir.", DEFAULT_VOICE, 1.0)  # warm up so the first real reply is quick
    print(f"kokoro ready: {len(VOICE_NAMES)} voices", flush=True)
    ThreadingHTTPServer(("0.0.0.0", 5000), Handler).serve_forever()
