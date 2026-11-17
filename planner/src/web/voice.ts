// Voice I/O for check-in "calls".
// Speech → text: the server's whisper.cpp (open source) when available, else the
// browser's own recogniser. Text → speech: the server's Piper when available,
// else the device's built-in voice (free, instant, works on iPhone).

type Health = { whisper: boolean; tts: boolean } | null;

let audioCtx: AudioContext | null = null;
let currentAudio: HTMLAudioElement | null = null;

/** Must be called from a tap so iOS unlocks audio + speech. */
export function unlockAudio() {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!audioCtx && Ctx) audioCtx = new Ctx();
  audioCtx?.resume();
  if (!sharedAudio) {
    sharedAudio = new Audio();
    sharedAudio.setAttribute('playsinline', '');
  }
  sharedAudio.src = SILENCE;
  sharedAudio.play().catch(() => {});
  if ('speechSynthesis' in window) {
    const u = new SpeechSynthesisUtterance('');
    u.volume = 0;
    speechSynthesis.speak(u);
  }
}

export function pickVoice(name: string): SpeechSynthesisVoice | undefined {
  if (!('speechSynthesis' in window)) return;
  const voices = speechSynthesis.getVoices();
  if (name) {
    const v = voices.find((x) => x.name === name);
    if (v) return v;
  }
  const en = voices.filter((v) => v.lang.startsWith('en'));
  return (
    en.find((v) => /premium|enhanced|natural|neural/i.test(v.name) && v.lang === 'en-GB') ||
    en.find((v) => /premium|enhanced|natural|neural/i.test(v.name)) ||
    en.find((v) => /daniel|serena|arthur|google uk/i.test(v.name)) ||
    en.find((v) => v.lang === 'en-GB') ||
    en[0]
  );
}

// One audio element, unlocked by the first tap and reused, so iOS lets it keep playing.
let sharedAudio: HTMLAudioElement | null = null;
const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
let speakToken = 0;

export function stopSpeaking() {
  speakToken++;
  currentAudio?.pause();
  currentAudio = null;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

/** Split a reply into sentences so the first one can play while the next is being voiced. */
export function splitSentences(text: string): string[] {
  const raw = text.match(/[^.!?]+[.!?]+["”')]*|\S[^.!?]*$/g)?.map((x) => x.trim()).filter(Boolean) ?? [text];
  const out: string[] = [];
  for (const part of raw) {
    if (out.length && (out[out.length - 1].length < 28 || part.length < 12)) out[out.length - 1] += ' ' + part;
    else out.push(part);
  }
  return out;
}

function playBlob(blob: Blob, token: number) {
  return new Promise<void>((res) => {
    if (token !== speakToken) return res();
    const a = sharedAudio ?? new Audio();
    const url = URL.createObjectURL(blob);
    const done = () => {
      URL.revokeObjectURL(url);
      res();
    };
    a.onended = a.onerror = a.onpause = done;
    a.src = url;
    currentAudio = a;
    a.play().catch(done);
  });
}

export async function speak(text: string, health: Health, voiceName: string, opts: { voice?: string; speed?: number } = {}): Promise<void> {
  stopSpeaking();
  const token = speakToken;
  if (health?.tts) {
    const parts = splitSentences(text);
    const voiceOf = (t: string) =>
      fetch('/api/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: t, ...opts }) }).then((r) =>
        r.ok ? r.blob() : Promise.reject(new Error('tts')),
      );
    try {
      let next = voiceOf(parts[0]);
      for (let i = 0; i < parts.length; i++) {
        const blob = await next;
        if (token !== speakToken) return;
        if (i + 1 < parts.length) next = voiceOf(parts[i + 1]); // voice the next sentence while this one plays
        await playBlob(blob, token);
        if (token !== speakToken) return;
      }
      return;
    } catch {
      if (token !== speakToken) return;
      /* fall through to the device voice */
    }
  }
  if (!('speechSynthesis' in window)) return;
  await new Promise<void>((res) => {
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice(voiceName);
    if (v) u.voice = v;
    u.rate = 1.0;
    u.onend = u.onerror = () => res();
    speechSynthesis.speak(u);
    setTimeout(res, 1500 + text.length * 90); // Safari sometimes never fires onend
  });
}

export function canListen(health: Health) {
  const hasRec = !!((window as unknown as Record<string, unknown>).SpeechRecognition || (window as unknown as Record<string, unknown>).webkitSpeechRecognition);
  const hasMic = !!navigator.mediaDevices && typeof MediaRecorder !== 'undefined';
  return (health?.whisper && hasMic) || hasRec;
}

export interface Listening {
  result: Promise<string | null>;
  stop: () => void; // finish now and transcribe
  cancel: () => void; // discard
  level: () => number; // 0..1 mic level for the UI
}

let micStream: MediaStream | null = null;
export async function getMic() {
  if (micStream && micStream.getTracks().every((t) => t.readyState === 'live')) return micStream;
  micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  return micStream;
}
export function releaseMic() {
  micStream?.getTracks().forEach((t) => t.stop());
  micStream = null;
}

export async function listen(health: Health): Promise<Listening> {
  if (health?.whisper && navigator.mediaDevices && typeof MediaRecorder !== 'undefined') return listenWhisper();
  return listenBrowser();
}

async function listenWhisper(): Promise<Listening> {
  const stream = await getMic();
  const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const ctx = audioCtx!;
  const src = ctx.createMediaStreamSource(stream);
  const an = ctx.createAnalyser();
  an.fftSize = 1024;
  src.connect(an);
  const buf = new Float32Array(an.fftSize);
  let lvl = 0;
  let cancelled = false;

  const result = new Promise<string | null>((resolve) => {
    const started = Date.now();
    let floor = 0.01;
    let spokeAt = 0;
    let lastLoud = 0;
    const timer = setInterval(() => {
      an.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const rms = Math.sqrt(sum / buf.length);
      lvl = Math.min(1, rms * 12);
      const t = Date.now() - started;
      if (t < 300) floor = Math.max(floor, rms);
      const loud = rms > Math.max(0.018, floor * 2.2);
      if (loud) {
        lastLoud = Date.now();
        if (!spokeAt) spokeAt = Date.now();
      }
      const silence = Date.now() - lastLoud;
      if ((spokeAt && silence > 1300) || t > 45_000 || (!spokeAt && t > 12_000)) finish();
    }, 60);
    const finish = () => {
      clearInterval(timer);
      if (rec.state !== 'inactive') rec.stop();
    };
    (rec as MediaRecorder & { _finish?: () => void })._finish = finish;
    rec.onstop = async () => {
      clearInterval(timer);
      src.disconnect();
      if (cancelled || !spokeAt) return resolve(cancelled ? null : '');
      try {
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        const r = await fetch('/api/stt', { method: 'POST', headers: { 'content-type': blob.type }, body: blob });
        const data = await r.json();
        resolve(r.ok ? data.text || '' : null);
      } catch {
        resolve(null);
      }
    };
  });
  rec.start(250);
  return {
    result,
    level: () => lvl,
    stop: () => (rec as MediaRecorder & { _finish?: () => void })._finish?.(),
    cancel: () => {
      cancelled = true;
      (rec as MediaRecorder & { _finish?: () => void })._finish?.();
    },
  };
}

interface SR {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}

function listenBrowser(): Promise<Listening> {
  const W = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
  const Ctor = W.SpeechRecognition || W.webkitSpeechRecognition;
  if (!Ctor) return Promise.reject(new Error('no speech recognition'));
  const r = new Ctor();
  r.lang = navigator.language || 'en-GB';
  r.interimResults = true;
  r.continuous = false;
  let text = '';
  let cancelled = false;
  let lvl = 0;
  const result = new Promise<string | null>((resolve) => {
    r.onresult = (e) => {
      text = Array.from(e.results)
        .map((x) => x[0].transcript)
        .join(' ');
      lvl = 0.6;
      setTimeout(() => (lvl = 0.1), 150);
    };
    r.onerror = () => resolve(cancelled ? null : text);
    r.onend = () => resolve(cancelled ? null : text);
  });
  r.start();
  return Promise.resolve({
    result,
    level: () => lvl,
    stop: () => r.stop(),
    cancel: () => {
      cancelled = true;
      r.abort();
    },
  });
}
