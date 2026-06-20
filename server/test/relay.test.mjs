// Testes do relay público. Sobe o servidor numa porta efêmera e usa clientes
// WebSocket reais para validar isolamento por sala e o não-eco do remetente.

import { test } from "node:test";
import assert from "node:assert";
import { WebSocket } from "ws";
import { createRelay } from "../relay.mjs";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (emitter, ev) => new Promise((r) => emitter.once(ev, r));

async function startRelay() {
  const { server } = createRelay();
  await new Promise((r) => server.listen(0, r));
  return { server, port: server.address().port };
}

async function joinClient(port, room, id) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await once(ws, "open");
  ws.send(JSON.stringify({ t: "join", room, id, name: id }));
  return ws;
}

test("áudio chega na mesma sala e não volta pro remetente", async () => {
  const { server, port } = await startRelay();
  const a = await joinClient(port, "s1", "aa");
  const b = await joinClient(port, "s1", "bb");
  await wait(120);

  const frame = Buffer.from([2, 97, 97, 1, 0, 2, 0]); // [idLen=2]["aa"][pcm]
  let aaGotBinary = false;
  a.on("message", (d, isBin) => {
    if (isBin) aaGotBinary = true;
  });
  const received = new Promise((resolve) => {
    b.on("message", (d, isBin) => {
      if (isBin) resolve(Buffer.from(d));
    });
  });

  a.send(frame, { binary: true });
  const got = await received;
  assert.deepEqual([...got], [...frame], "bb deve receber o quadro idêntico");

  await wait(120);
  assert.equal(aaGotBinary, false, "remetente não deve ouvir a si mesmo");

  a.close();
  b.close();
  await new Promise((r) => server.close(r));
});

test("áudio não vaza entre salas", async () => {
  const { server, port } = await startRelay();
  const a = await joinClient(port, "salaA", "aa");
  const c = await joinClient(port, "salaB", "cc");
  await wait(120);

  let ccGotBinary = false;
  c.on("message", (d, isBin) => {
    if (isBin) ccGotBinary = true;
  });

  a.send(Buffer.from([2, 97, 97, 9, 0]), { binary: true });
  await wait(200);
  assert.equal(ccGotBinary, false, "áudio não pode vazar para outra sala");

  a.close();
  c.close();
  await new Promise((r) => server.close(r));
});

test("presença: roster + join + leave", async () => {
  const { server, port } = await startRelay();
  const a = await joinClient(port, "p", "aa");
  await wait(80);

  // aa deve ver bb entrar
  const sawJoin = new Promise((resolve) => {
    a.on("message", (d, isBin) => {
      if (isBin) return;
      const m = JSON.parse(d.toString());
      if (m.t === "join" && m.id === "bb") resolve(true);
    });
  });
  const b = await joinClient(port, "p", "bb");

  // bb deve receber roster contendo aa
  const bbRoster = new Promise((resolve) => {
    b.on("message", (d, isBin) => {
      if (isBin) return;
      const m = JSON.parse(d.toString());
      if (m.t === "roster") resolve(m.peers);
    });
  });

  assert.equal(await sawJoin, true);
  const roster = await bbRoster;
  assert.ok(roster.some((p) => p.id === "aa"), "roster do bb deve conter aa");

  // aa deve ver bb sair
  const sawLeave = new Promise((resolve) => {
    a.on("message", (d, isBin) => {
      if (isBin) return;
      const m = JSON.parse(d.toString());
      if (m.t === "leave" && m.id === "bb") resolve(true);
    });
  });
  b.close();
  assert.equal(await sawLeave, true);

  a.close();
  await new Promise((r) => server.close(r));
});
