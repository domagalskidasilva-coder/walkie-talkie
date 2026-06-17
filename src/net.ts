// Cliente WebSocket + protocolo do walkie-talkie.
//
// Dois tipos de mensagem trafegam:
//  - TEXTO (JSON): presença, ex. {"t":"hello","id":"ab12","name":"Fulano"}
//  - BINÁRIO: um quadro de áudio = [idLen:1 byte][id:idLen bytes][PCM int16 LE...]
//
// O servidor (host) reenvia tudo para os outros. Cada cliente ignora os
// quadros que vêm com o próprio id (não escuta a si mesmo).

const enc = new TextEncoder();
const dec = new TextDecoder();

/** id curto e único deste aparelho nesta sessão. */
export const myId = Math.random().toString(36).slice(2, 6);

let ws: WebSocket | null = null;
let myName = "Você";

export interface NetHandlers {
  onStatus: (connected: boolean, info: string) => void;
  onHello: (id: string, name: string) => void;
  onAudio: (id: string, pcm: Int16Array) => void;
}

let handlers: NetHandlers | null = null;

export function isConnected(): boolean {
  return ws !== null && ws.readyState === WebSocket.OPEN;
}

export function setName(name: string) {
  myName = name || "Anônimo";
  sendHello();
}

export function connect(url: string, h: NetHandlers) {
  disconnect();
  handlers = h;
  try {
    ws = new WebSocket(url);
  } catch (e) {
    h.onStatus(false, `URL inválida: ${e}`);
    return;
  }
  ws.binaryType = "arraybuffer";

  ws.onopen = () => {
    h.onStatus(true, "Conectado");
    sendHello();
  };
  ws.onclose = () => h.onStatus(false, "Desconectado");
  ws.onerror = () => h.onStatus(false, "Erro de conexão");
  ws.onmessage = (ev) => {
    if (typeof ev.data === "string") {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.t === "hello" && msg.id !== myId) handlers?.onHello(msg.id, msg.name);
      } catch {
        /* ignora texto malformado */
      }
      return;
    }
    // Binário: quadro de áudio.
    const u8 = new Uint8Array(ev.data as ArrayBuffer);
    if (u8.length < 1) return;
    const idLen = u8[0];
    const id = dec.decode(u8.subarray(1, 1 + idLen));
    if (id === myId) return; // não toca o próprio áudio
    // Cópia alinhada (Int16Array exige byteOffset par).
    const copy = u8.slice(1 + idLen);
    const pcm = new Int16Array(copy.buffer, copy.byteOffset, copy.byteLength >> 1);
    handlers?.onAudio(id, pcm);
  };
}

export function disconnect() {
  if (ws) {
    ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null;
    try {
      ws.close();
    } catch {
      /* já fechado */
    }
    ws = null;
  }
}

function sendHello() {
  if (!isConnected()) return;
  ws!.send(JSON.stringify({ t: "hello", id: myId, name: myName }));
}

/** Envia um quadro de áudio PCM (int16) para o relay. */
export function sendPcm(pcm: Int16Array) {
  if (!isConnected()) return;
  const idBytes = enc.encode(myId);
  const buf = new Uint8Array(1 + idBytes.length + pcm.byteLength);
  buf[0] = idBytes.length;
  buf.set(idBytes, 1);
  buf.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), 1 + idBytes.length);
  ws!.send(buf);
}
