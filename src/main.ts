import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import * as net from "./net";
import * as audio from "./audio";

// URL do relay público (deploy no Render). Vazio = use HOST LAN.
const DEFAULT_RELAY = "wss://walkie-talkie-relay.onrender.com";
const LAN_PORT = 7878;
// Repositório das releases (usado pela verificação de atualização).
const REPO = "domagalskidasilva-coder/walkie-talkie";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let nameInput: HTMLInputElement;
let serverInput: HTMLInputElement;
let roomInput: HTMLInputElement;
let connectBtn: HTMLButtonElement;
let hostBtn: HTMLButtonElement;
let statusDot: HTMLElement;
let statusText: HTMLElement;
let talkingText: HTMLElement;
let rosterText: HTMLElement;
let pttBtn: HTMLButtonElement;
let volume: HTMLInputElement;
let pttKeyInput: HTMLInputElement;
let setKeyBtn: HTMLButtonElement;
let hostHint: HTMLElement;
// Config / atualização
let settingsBtn: HTMLButtonElement;
let settingsClose: HTMLButtonElement;
let settingsPanel: HTMLElement;
let appVersionEl: HTMLElement;
let checkUpdateBtn: HTMLButtonElement;
let downloadUpdateBtn: HTMLButtonElement;
let updateMsg: HTMLElement;
let latestUrl = "";

let active = false; // o usuário quer estar conectado
let hosting = false;
let talking = false;
const names = new Map<string, string>(); // id -> nome (quem está na sala)
let talkClear: ReturnType<typeof setTimeout> | null = null;

// --- Persistência do último uso --------------------------------------------
function persist() {
  try {
    localStorage.setItem(
      "wt",
      JSON.stringify({ name: nameInput.value, server: serverInput.value, room: roomInput.value })
    );
  } catch {
    /* ignore */
  }
}
function restore() {
  try {
    const s = JSON.parse(localStorage.getItem("wt") || "{}");
    if (s.name) nameInput.value = s.name;
    if (s.server) serverInput.value = s.server;
    if (s.room) roomInput.value = s.room;
  } catch {
    /* ignore */
  }
}

// --- Presença ---------------------------------------------------------------
function renderRoster() {
  const arr = [...names.values()];
  rosterText.textContent = arr.length ? `🟢 Na sala (${arr.length}): ${arr.join(", ")}` : "";
}

function showTalking(who: string) {
  talkingText.textContent = `🔊 ${who} falando…`;
  if (talkClear) clearTimeout(talkClear);
  talkClear = setTimeout(() => (talkingText.textContent = ""), 500);
}

// --- Conexão ----------------------------------------------------------------
function doConnect() {
  const url = serverInput.value.trim();
  if (!url) {
    statusText.textContent = "Informe o servidor ou use HOST LAN";
    return;
  }
  persist();
  names.clear();
  renderRoster();
  active = true;
  connectBtn.textContent = "Desconectar";

  net.connect(url, roomInput.value.trim(), nameInput.value.trim(), {
    onStatus: (state, info) => {
      statusDot.classList.toggle("on", state === "connected");
      statusText.textContent = info;
    },
    onRoster: (peers) => {
      names.clear();
      for (const p of peers) names.set(p.id, p.name);
      renderRoster();
    },
    onJoin: (id, name) => {
      names.set(id, name);
      renderRoster();
    },
    onLeave: (id) => {
      names.delete(id);
      renderRoster();
    },
    onAudio: (id, pcm) => {
      if (!talking) audio.playPcm(pcm); // half-duplex: ignora enquanto falo
      showTalking(names.get(id) ?? id);
    },
  });
}

function doDisconnect() {
  active = false;
  connectBtn.textContent = "Conectar";
  net.disconnect();
  names.clear();
  renderRoster();
}

// --- Push-to-talk -----------------------------------------------------------
async function startTalk() {
  if (talking) return;
  if (!net.isConnected()) {
    statusText.textContent = "Conecte-se antes de falar.";
    return;
  }
  talking = true;
  pttBtn.classList.add("talking");
  audio.setMuted(true);
  try {
    await audio.startCapture((pcm) => {
      if (talking) net.sendPcm(pcm);
    });
  } catch (e) {
    talking = false;
    pttBtn.classList.remove("talking");
    audio.setMuted(false);
    statusText.textContent = `Sem acesso ao microfone: ${e}`;
  }
}

function stopTalk() {
  if (!talking) return;
  talking = false;
  pttBtn.classList.remove("talking");
  audio.stopCapture();
  audio.setMuted(false);
}

// --- Host LAN (relay embutido, sem internet) --------------------------------
async function toggleHost() {
  if (!hosting) {
    try {
      await invoke("start_host", { port: LAN_PORT });
      hosting = true;
      hostBtn.textContent = "Parar host";
      serverInput.value = `ws://127.0.0.1:${LAN_PORT}`;
      let ip = "SEU_IP";
      try {
        ip = await invoke<string>("get_local_ip");
      } catch {
        /* ignore */
      }
      hostHint.textContent = `Host ativo. Outros na MESMA WiFi conectam em: ws://${ip}:${LAN_PORT}`;
      doConnect();
    } catch (e) {
      statusText.textContent = `${e}`;
    }
  } else {
    doDisconnect();
    try {
      await invoke("stop_host");
    } catch {
      /* ignore */
    }
    hosting = false;
    hostBtn.textContent = "Host LAN";
    hostHint.textContent = "";
  }
}

// --- Configuração / Atualização ---------------------------------------------
function openSettings() {
  settingsPanel.classList.remove("hidden");
}
function closeSettings() {
  settingsPanel.classList.add("hidden");
}

/** Compara versões "x.y.z": retorna true se `a` for mais nova que `b`. */
function isNewer(a: string, b: string): boolean {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da > db;
  }
  return false;
}

async function checkUpdate() {
  updateMsg.textContent = "Verificando…";
  downloadUpdateBtn.classList.add("hidden");
  let current = "0.0.0";
  try {
    current = await getVersion();
  } catch {
    /* fora do Tauri */
  }
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!r.ok) throw new Error(String(r.status));
    const data = await r.json();
    const latest = String(data.tag_name || "").replace(/^v/, "");
    latestUrl = data.html_url || `https://github.com/${REPO}/releases/latest`;
    if (latest && isNewer(latest, current)) {
      updateMsg.textContent = `Nova versão disponível: v${latest} (você tem v${current}).`;
      downloadUpdateBtn.textContent = `⬇ Baixar v${latest}`;
      downloadUpdateBtn.classList.remove("hidden");
    } else {
      updateMsg.textContent = `Você está atualizado (v${current}).`;
    }
  } catch {
    updateMsg.textContent = "Não consegui verificar agora (sem internet?).";
  }
}

async function openLatest() {
  const url = latestUrl || `https://github.com/${REPO}/releases/latest`;
  try {
    await openUrl(url);
  } catch {
    window.open(url, "_blank");
  }
}

// --- Inicialização ----------------------------------------------------------
window.addEventListener("DOMContentLoaded", () => {
  nameInput = $("name");
  serverInput = $("server");
  roomInput = $("room");
  connectBtn = $("connect");
  hostBtn = $("host");
  statusDot = $("status-dot");
  statusText = $("status-text");
  talkingText = $("talking");
  rosterText = $("roster");
  pttBtn = $("ptt");
  volume = $("volume");
  pttKeyInput = $("ptt-key");
  setKeyBtn = $("set-key");
  hostHint = $("host-hint");
  settingsBtn = $("settings-btn");
  settingsClose = $("settings-close");
  settingsPanel = $("settings-panel");
  appVersionEl = $("app-version");
  checkUpdateBtn = $("check-update");
  downloadUpdateBtn = $("download-update");
  updateMsg = $("update-msg");

  if (DEFAULT_RELAY) serverInput.value = DEFAULT_RELAY;
  restore();

  // Mostra a versão instalada na config.
  getVersion()
    .then((v) => (appVersionEl.textContent = `v${v}`))
    .catch(() => (appVersionEl.textContent = "—"));

  // PTT por toque/mouse.
  pttBtn.addEventListener("pointerdown", (e) => {
    pttBtn.setPointerCapture(e.pointerId);
    startTalk();
  });
  pttBtn.addEventListener("pointerup", stopTalk);
  pttBtn.addEventListener("pointercancel", stopTalk);

  // PTT pela barra de espaço (janela focada, sem estar digitando).
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" && !isTyping(e.target) && !e.repeat) {
      e.preventDefault();
      startTalk();
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "Space" && !isTyping(e.target)) {
      e.preventDefault();
      stopTalk();
    }
  });

  // Atalho global vindo do Rust (PC, funciona minimizado).
  listen("ptt-down", () => startTalk());
  listen("ptt-up", () => stopTalk());

  connectBtn.addEventListener("click", () => (active ? doDisconnect() : doConnect()));
  hostBtn.addEventListener("click", toggleHost);
  volume.addEventListener("input", () => audio.setVolume(Number(volume.value)));
  nameInput.addEventListener("change", () => {
    persist();
    net.setName(nameInput.value.trim());
  });

  setKeyBtn.addEventListener("click", async () => {
    try {
      await invoke("register_ptt", { key: pttKeyInput.value.trim() });
      statusText.textContent = `Tecla de fala: ${pttKeyInput.value.trim()}`;
    } catch (e) {
      statusText.textContent = `${e}`;
    }
  });

  // Configuração / atualização.
  settingsBtn.addEventListener("click", openSettings);
  settingsClose.addEventListener("click", closeSettings);
  settingsPanel.addEventListener("click", (e) => {
    if (e.target === settingsPanel) closeSettings(); // clicar fora fecha
  });
  checkUpdateBtn.addEventListener("click", checkUpdate);
  downloadUpdateBtn.addEventListener("click", openLatest);

  // Sequência de boot (tema).
  const bootScreen = document.getElementById("boot-screen");
  const mainApp = document.getElementById("main-app");
  if (bootScreen && mainApp) {
    setTimeout(() => {
      bootScreen.classList.add("fade-out");
      mainApp.classList.remove("hidden");
      setTimeout(() => bootScreen.remove(), 500);
    }, 3500);
  }
});

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
}
