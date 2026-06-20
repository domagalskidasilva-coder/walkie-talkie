// Captura e reprodução de áudio com a Web Audio API.
//
// Captura e playback usam a MESMA taxa nos dois lados, então não há reamostra-
// gem. 16 kHz mono ("voz wideband") soa bem para fala e gasta ~3x menos banda
// que 48 kHz — importante para funcionar pela internet/4G. O formato na rede é
// PCM int16 mono.

const RATE = 16000;

// --- Conversões PCM ---------------------------------------------------------

function floatToInt16(f32: Float32Array): Int16Array {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function int16ToFloat(i16: Int16Array): Float32Array {
  const out = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) out[i] = i16[i] / 0x8000;
  return out;
}

// --- Playback ---------------------------------------------------------------

let playCtx: AudioContext | null = null;
let gain: GainNode | null = null;
let nextTime = 0;
let volume = 1;
let muted = false;

function ensurePlayback() {
  if (!playCtx) {
    playCtx = new AudioContext({ sampleRate: RATE });
    gain = playCtx.createGain();
    gain.gain.value = volume;
    gain.connect(playCtx.destination);
  }
  // Em alguns navegadores o contexto começa "suspended" até um gesto do usuário.
  if (playCtx.state === "suspended") playCtx.resume();
}

export function setVolume(v: number) {
  volume = v;
  if (gain && !muted) gain.gain.value = v;
}

/** Liga/desliga a saída (usado no half-duplex: silencia ao falar). */
export function setMuted(m: boolean) {
  muted = m;
  if (gain) gain.gain.value = m ? 0 : volume;
}

/** Enfileira e toca um quadro PCM recebido, sem buracos nem sobreposição. */
export function playPcm(pcm: Int16Array) {
  ensurePlayback();
  if (!playCtx || !gain) return;
  const f32 = int16ToFloat(pcm);
  const buffer = playCtx.createBuffer(1, f32.length, RATE);
  buffer.copyToChannel(f32, 0);
  const src = playCtx.createBufferSource();
  src.buffer = buffer;
  src.connect(gain);

  const now = playCtx.currentTime;
  // Mantém ~80 ms de folga para absorver jitter da rede.
  if (nextTime < now + 0.08) nextTime = now + 0.08;
  src.start(nextTime);
  nextTime += buffer.duration;
}

// --- Captura ----------------------------------------------------------------

let capCtx: AudioContext | null = null;
let micStream: MediaStream | null = null;
let workletNode: AudioWorkletNode | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;

/** Começa a capturar o microfone e chama onFrame com cada bloco PCM. */
export async function startCapture(onFrame: (pcm: Int16Array) => void) {
  if (capCtx) return; // já capturando
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  capCtx = new AudioContext({ sampleRate: RATE });
  await capCtx.audioWorklet.addModule("/pcm-worklet.js");
  sourceNode = capCtx.createMediaStreamSource(micStream);
  workletNode = new AudioWorkletNode(capCtx, "capture-processor");
  workletNode.port.onmessage = (ev) => onFrame(floatToInt16(ev.data as Float32Array));
  sourceNode.connect(workletNode);
  // Não conectamos o worklet ao destino (não queremos ouvir a própria voz).
}

/** Para a captura e libera o microfone. */
export function stopCapture() {
  workletNode?.disconnect();
  sourceNode?.disconnect();
  micStream?.getTracks().forEach((t) => t.stop());
  capCtx?.close();
  workletNode = null;
  sourceNode = null;
  micStream = null;
  capCtx = null;
}
