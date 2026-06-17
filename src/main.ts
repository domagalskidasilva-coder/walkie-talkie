import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import * as net from "./net";
import * as audio from "./audio";

const DEFAULT_PORT = 7878;

// --- Atalhos de DOM ---------------------------------------------------------
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let nameInput: HTMLInputElement;
let ipInput: HTMLInputElement;
let portInput: HTMLInputElement;
let connectBtn: HTMLButtonElement;
let hostBtn: HTMLButtonElement;
let statusDot: HTMLElement;
let statusText: HTMLElement;
let talkingText: HTMLElement;
let pttBtn: HTMLButtonElement;
let volume: HTMLInputElement;
let pttKeyInput: HTMLInputElement;
let setKeyBtn: HTMLButtonElement;
let hostHint: HTMLElement;

// --- Estado -----------------------------------------------------------------
let hosting = false;
let talking = false;
const names = new Map<string, string>();
let talkClear: ReturnType<typeof setTimeout> | null = null;

// --- Conexão ----------------------------------------------------------------
function wsUrl(): string {
  return `ws://${ipInput.value.trim()}:${portInput.value.trim()}`;
}

function doConnect() {
  net.setName(nameInput.value.trim());
  net.connect(wsUrl(), {
    onStatus: (connected, info) => {
      statusDot.classList.toggle("on", connected);
      statusText.textContent = info;
      connectBtn.textContent = connected ? "Desconectar" : "Conectar";
    },
    onHello: (id, name) => names.set(id, name),
    onAudio: (id, pcm) => {
      if (!talking) audio.playPcm(pcm); // half-duplex: ignora enquanto falo
      showTalking(names.get(id) ?? id);
    },
  });
}

function showTalking(who: string) {
  talkingText.textContent = `🔊 ${who} falando…`;
  if (talkClear) clearTimeout(talkClear);
  talkClear = setTimeout(() => (talkingText.textContent = ""), 400);
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

// --- Inicialização ----------------------------------------------------------
window.addEventListener("DOMContentLoaded", async () => {
  nameInput = $("name");
  ipInput = $("ip");
  portInput = $("port");
  connectBtn = $("connect");
  hostBtn = $("host");
  statusDot = $("status-dot");
  statusText = $("status-text");
  talkingText = $("talking");
  pttBtn = $("ptt");
  volume = $("volume");
  pttKeyInput = $("ptt-key");
  setKeyBtn = $("set-key");
  hostHint = $("host-hint");

  portInput.value = String(DEFAULT_PORT);

  // Descobre o IP local (para você passar aos outros quando for host).
  try {
    const ip = await invoke<string>("get_local_ip");
    ipInput.value = ip;
    hostHint.textContent = `Seu IP nesta rede: ${ip} — os outros conectam em ${ip}:${DEFAULT_PORT}`;
  } catch {
    ipInput.value = "127.0.0.1";
  }

  // Botão grande de falar (mouse + toque).
  pttBtn.addEventListener("pointerdown", (e) => {
    pttBtn.setPointerCapture(e.pointerId);
    startTalk();
  });
  const release = () => stopTalk();
  pttBtn.addEventListener("pointerup", release);
  pttBtn.addEventListener("pointercancel", release);

  // Barra de espaço como PTT quando a janela está focada (e não digitando).
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

  // Atalho global vindo do Rust (funciona com o app minimizado, no PC).
  listen("ptt-down", () => startTalk());
  listen("ptt-up", () => stopTalk());

  connectBtn.addEventListener("click", () => {
    if (net.isConnected()) net.disconnect();
    else doConnect();
  });

  hostBtn.addEventListener("click", async () => {
    if (!hosting) {
      try {
        await invoke("start_host", { port: Number(portInput.value) });
        hosting = true;
        hostBtn.textContent = "Parar host";
        ipInput.value = "127.0.0.1";
        doConnect(); // o host também entra na sala
      } catch (e) {
        statusText.textContent = `${e}`;
      }
    } else {
      net.disconnect();
      await invoke("stop_host");
      hosting = false;
      hostBtn.textContent = "Ser host";
    }
  });

  volume.addEventListener("input", () => audio.setVolume(Number(volume.value)));

  nameInput.addEventListener("change", () => net.setName(nameInput.value.trim()));

  setKeyBtn.addEventListener("click", async () => {
    try {
      await invoke("register_ptt", { key: pttKeyInput.value.trim() });
      statusText.textContent = `Tecla de fala: ${pttKeyInput.value.trim()}`;
    } catch (e) {
      statusText.textContent = `${e}`;
    }
  });

  // --- Boot Sequence Logic ---
  const bootScreen = document.getElementById("boot-screen");
  const mainApp = document.getElementById("main-app");
  if (bootScreen && mainApp) {
    setTimeout(() => {
      bootScreen.classList.add("fade-out");
      mainApp.classList.remove("hidden");
      setTimeout(() => {
        bootScreen.remove();
      }, 500);
    }, 3500); // 3.5 seconds boot time
  }
});

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
}
