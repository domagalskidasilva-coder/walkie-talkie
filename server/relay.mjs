// Relay público do walkie-talkie (funciona de qualquer lugar).
//
// Um servidor WebSocket multi-sala. Cada cliente manda um JSON de `join`
// {room,id,name}; depois manda quadros de áudio binários. O servidor só
// reenvia o áudio para quem está na MESMA sala (menos o remetente) e mantém
// presença (roster/join/leave). Hospede em qualquer lugar com HTTPS/WSS
// (Render, Fly, Deno, VPS...) e o app conecta de qualquer rede.
//
// Protocolo idêntico ao relay LAN embutido (src-tauri/src/relay.rs).

import http from "node:http";
import { pathToFileURL } from "node:url";
import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 7878;

export function createRelay() {
  const server = http.createServer((req, res) => {
    // Health check (e algo amigável ao abrir no navegador).
    if (req.method === "GET" && (req.url === "/" || req.url === "/healthz")) {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end("walkie-talkie relay: ok");
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ server });

  const peersInRoom = (room) => {
    const list = [];
    for (const c of wss.clients) {
      if (c.readyState === c.OPEN && c.room === room) list.push(c);
    }
    return list;
  };

  wss.on("connection", (ws) => {
    ws.isAlive = true;
    ws.room = "";
    ws.id = "";
    ws.name = "";
    ws.on("pong", () => {
      ws.isAlive = true;
    });

    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        if (!ws.room) return;
        for (const c of peersInRoom(ws.room)) {
          if (c !== ws) c.send(data, { binary: true });
        }
        return;
      }
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg.t !== "join" || !msg.room || !msg.id) return;

      ws.room = String(msg.room);
      ws.id = String(msg.id);
      ws.name = String(msg.name ?? "");

      // Roster para o recém-chegado.
      const roster = peersInRoom(ws.room)
        .filter((c) => c !== ws && c.id)
        .map((c) => ({ id: c.id, name: c.name }));
      ws.send(JSON.stringify({ t: "roster", peers: roster }));

      // Avisa os outros da sala.
      const join = JSON.stringify({ t: "join", id: ws.id, name: ws.name });
      for (const c of peersInRoom(ws.room)) if (c !== ws) c.send(join);
    });

    ws.on("close", () => {
      if (ws.room && ws.id) {
        const leave = JSON.stringify({ t: "leave", id: ws.id });
        for (const c of peersInRoom(ws.room)) if (c !== ws) c.send(leave);
      }
    });
  });

  // Heartbeat: derruba conexões mortas (NAT/proxy fecham conexões ociosas).
  const interval = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch {
        /* ignore */
      }
    }
  }, 25000);
  if (typeof interval.unref === "function") interval.unref();
  server.on("close", () => clearInterval(interval));

  return { server, wss };
}

// Sobe o servidor quando executado diretamente (`node relay.mjs`).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { server } = createRelay();
  server.listen(PORT, () => {
    console.log(`walkie-talkie relay ouvindo na porta ${PORT}`);
  });
}
