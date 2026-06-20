// Cliente WebSocket + protocolo do walkie-talkie.
//
// Funciona com o relay público (wss://) e com o relay LAN embutido (ws://).
// Mensagens:
//  - TEXTO (JSON): presença -> join/roster/leave; o cliente envia "join".
//  - BINÁRIO: quadro de áudio = [idLen:1][id][PCM int16 LE].
//
// O servidor reenvia só dentro da mesma sala e nunca de volta ao remetente;
// mesmo assim o cliente ignora quadros com o próprio id por segurança.

const enc = new TextEncoder();
const dec = new TextDecoder();

/** id curto e único deste aparelho nesta sessão. */
export const myId = Math.random().toString(36).slice(2, 8);

// --- Codec do quadro (funções puras, testáveis sem DOM) ---------------------

export function encodeFrame(id: string, pcm: Int16Array): Uint8Array {
  const idBytes = enc.encode(id);
  const out = new Uint8Array(1 + idBytes.length + pcm.byteLength);
  out[0] = idBytes.length;
  out.set(idBytes, 1);
  out.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), 1 + idBytes.length);
  return out;
}

export function decodeFrame(buf: ArrayBuffer): { id: string; pcm: Int16Array } | null {
  const u8 = new Uint8Array(buf);
  if (u8.length < 1) return null;
  const idLen = u8[0];
  if (u8.length < 1 + idLen) return null;
  const id = dec.decode(u8.subarray(1, 1 + idLen));
  // Cópia alinhada (Int16Array exige byteOffset par).
  const copy = u8.slice(1 + idLen);
  const pcm = new Int16Array(copy.buffer, copy.byteOffset, copy.byteLength >> 1);
  return { id, pcm };
}

// --- Cliente ----------------------------------------------------------------

export type ConnState = "connecting" | "connected" | "disconnected";

export interface NetHandlers {
  onStatus: (state: ConnState, info: string) => void;
  onRoster: (peers: { id: string; name: string }[]) => void;
  onJoin: (id: string, name: string) => void;
  onLeave: (id: string) => void;
  onAudio: (id: string, pcm: Int16Array) => void;
}

let ws: WebSocket | null = null;
let handlers: NetHandlers | null = null;
let cfg: { url: string; room: string; name: string } | null = null;
let wantConnected = false;
let retry = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

export function isConnected(): boolean {
  return ws !== null && ws.readyState === WebSocket.OPEN;
}

export function setName(name: string) {
  if (cfg) cfg.name = name || "Anônimo";
  sendJoin();
}

export function connect(url: string, room: string, name: string, h: NetHandlers) {
  disconnect();
  cfg = { url, room: room || "geral", name: name || "Anônimo" };
  handlers = h;
  wantConnected = true;
  retry = 0;
  open();
}

function open() {
  if (!cfg || !handlers) return;
  handlers.onStatus("connecting", "Conectando…");
  try {
    ws = new WebSocket(cfg.url);
  } catch (e) {
    handlers.onStatus("disconnected", `URL inválida: ${e}`);
    scheduleReconnect();
    return;
  }
  ws.binaryType = "arraybuffer";

  ws.onopen = () => {
    retry = 0;
    handlers?.onStatus("connected", "Conectado");
    sendJoin();
  };
  ws.onclose = () => {
    handlers?.onStatus("disconnected", wantConnected ? "Reconectando…" : "Desconectado");
    scheduleReconnect();
  };
  ws.onerror = () => {
    // onclose vem em seguida e cuida da reconexão.
  };
  ws.onmessage = (ev) => {
    if (typeof ev.data === "string") {
      handleText(ev.data);
      return;
    }
    const frame = decodeFrame(ev.data as ArrayBuffer);
    if (frame && frame.id !== myId) handlers?.onAudio(frame.id, frame.pcm);
  };
}

function handleText(data: string) {
  let msg: any;
  try {
    msg = JSON.parse(data);
  } catch {
    return;
  }
  switch (msg.t) {
    case "roster":
      handlers?.onRoster(Array.isArray(msg.peers) ? msg.peers : []);
      break;
    case "join":
      if (msg.id !== myId) handlers?.onJoin(msg.id, msg.name ?? msg.id);
      break;
    case "leave":
      handlers?.onLeave(msg.id);
      break;
  }
}

function scheduleReconnect() {
  if (ws) {
    ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null;
    ws = null;
  }
  if (!wantConnected) return;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  const delay = Math.min(1000 * 2 ** retry, 10000); // backoff até 10s
  retry++;
  reconnectTimer = setTimeout(open, delay);
}

export function disconnect() {
  wantConnected = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null;
    try {
      ws.close();
    } catch {
      /* já fechado */
    }
    ws = null;
  }
  handlers?.onStatus("disconnected", "Desconectado");
}

function sendJoin() {
  if (!isConnected() || !cfg) return;
  ws!.send(JSON.stringify({ t: "join", room: cfg.room, id: myId, name: cfg.name }));
}

/** Envia um quadro de áudio PCM (int16) para a sala. */
export function sendPcm(pcm: Int16Array) {
  if (!isConnected()) return;
  ws!.send(encodeFrame(myId, pcm));
}
