# Relay público do Walkie-Talkie

Servidor WebSocket multi-sala que faz o app **funcionar de qualquer lugar** (não
só na mesma WiFi). Os apps conectam via `wss://SEU-RELAY/` informando um **canal**;
o relay reenvia o áudio só para quem está no mesmo canal.

- Sem estado/persistência, sem banco. Só repassa pacotes.
- Protocolo idêntico ao relay LAN embutido (`src-tauri/src/relay.rs`).
- Saúde: `GET /healthz` responde `200`.

## Rodar local
```bash
cd server
npm install
npm start            # ouve em :7878  (PORT configurável)
npm test             # testes (node --test)
```

## Deploy grátis

### Opção A — Render (mais fácil, 1 clique)
1. Suba este repo no GitHub (já está).
2. Acesse https://render.com → **New** → **Blueprint** → selecione o repo.
   O `render.yaml` na raiz configura tudo (plano free, healthcheck).
3. Pegue a URL gerada, ex.: `https://walkie-talkie-relay.onrender.com`.
4. No app, em **SERVIDOR (RELAY)**, use: `wss://walkie-talkie-relay.onrender.com`.

> Free do Render "dorme" após ~15 min ocioso (primeira conexão demora alguns
> segundos pra acordar). Para sempre-ligado, use um plano pago ou a opção B.

### Opção B — Fly.io / VPS / Docker
```bash
# Qualquer host com Docker:
cd server
docker build -t walkie-relay .
docker run -p 8080:8080 walkie-relay
# Exponha com HTTPS (proxy/Caddy/Nginx) e use wss://SEU-DOMINIO no app.
```

## Por que WSS (e não WS) pela internet?
O WebView do app é um contexto seguro; pela internet use **`wss://`** (TLS).
Render/Fly já entregam HTTPS/WSS automaticamente. Na LAN (mesma WiFi) o app usa
`ws://` com o relay embutido ("HOST LAN"), sem precisar deste servidor.
