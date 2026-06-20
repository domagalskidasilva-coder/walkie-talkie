// Smoke test contra um relay AO VIVO (LAN ou internet).
//   node smoke.mjs wss://walkie-talkie-relay.onrender.com
// Conecta 2 clientes na mesma sala e confirma o round-trip de um quadro de áudio.

import { WebSocket } from "ws";

const url = process.argv[2] || "ws://127.0.0.1:7878";
const once = (e, ev) => new Promise((r) => e.once(ev, r));

const a = new WebSocket(url);
const b = new WebSocket(url);
a.on("error", (e) => fail(`erro A: ${e.message}`));
b.on("error", (e) => fail(`erro B: ${e.message}`));

function fail(msg) {
  console.error("FALHA:", msg);
  process.exit(1);
}

await Promise.all([once(a, "open"), once(b, "open")]);

const room = "smoke-" + Math.random().toString(36).slice(2, 7);
a.send(JSON.stringify({ t: "join", room, id: "aa", name: "aa" }));
b.send(JSON.stringify({ t: "join", room, id: "bb", name: "bb" }));
await new Promise((r) => setTimeout(r, 400));

const frame = Buffer.from([2, 97, 97, 10, 0, 20, 0, 30, 0]); // [idLen][aa][pcm]
const got = new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error("timeout: B não recebeu o áudio")), 8000);
  b.on("message", (d, isBin) => {
    if (isBin) {
      clearTimeout(t);
      res(Buffer.from(d));
    }
  });
});

a.send(frame, { binary: true });
try {
  const r = await got;
  if (Buffer.compare(r, frame) === 0) {
    console.log(`OK: round-trip de áudio pelo relay ${url} funcionou ✔`);
    process.exit(0);
  }
  fail("payload recebido diferente do enviado");
} catch (e) {
  fail(e.message);
}
