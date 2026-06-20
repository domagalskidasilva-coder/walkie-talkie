# 📻 Walkie-Talkie (Tauri 2)

Walkie-talkie de voz em **PC, Android e iOS**, feito em Tauri 2. Push-to-talk:
**segura pra falar, solta pra ouvir** (half-duplex). Funciona de duas formas:

- 🌍 **De qualquer lugar (internet):** conecta num **relay** (`wss://…`) e entra num
  **canal**. Quem estiver no mesmo canal se fala, em qualquer rede. (Veja [`server/`](server/).)
- 📶 **Mesma WiFi (offline):** um aparelho vira **HOST LAN** e os outros conectam, sem
  servidor nenhum.

## ⬇️ Baixar (última versão)

> Página com todos os arquivos: **[Releases](https://github.com/domagalskidasilva-coder/walkie-talkie/releases/latest)**

| Sistema | Arquivo |
|---|---|
| 📱 **Android** | **[walkie-talkie.apk](https://github.com/domagalskidasilva-coder/walkie-talkie/releases/latest/download/walkie-talkie.apk)** (permita "fontes desconhecidas" ao instalar) |
| 🪟 **Windows** | `.msi` ou `.exe` na página de Releases |
| 🐧 **Linux** | `.AppImage` (universal) ou `.deb` na página de Releases |

Os builds são gerados automaticamente pelo GitHub Actions a cada tag `v*`.

- **PC:** fala segurando uma **tecla** (padrão `F8`, funciona até com o app minimizado)
  ou a **barra de espaço** com a janela aberta. O app vai pra **bandeja** ao fechar.
- **Celular:** fala segurando o **botão grande** na tela.

## Como funciona (visão rápida)

```
 Cliente A ──►  RELAY (Node wss://  ou  HOST LAN ws:// em Rust)  ◄── Cliente B
 Cliente A ◄──  reenvia o áudio só pros do MESMO canal          ──► Cliente B
```

- Áudio é capturado/reproduzido no frontend com a **Web Audio API** (PCM int16, 16 kHz
  mono — boa voz com pouca banda).
- O relay (`server/relay.mjs` para internet; `src-tauri/src/relay.rs` para LAN) só reenvia
  cada pacote pra quem está no **mesmo canal**, menos pra quem mandou. Cada pacote leva um
  `id` curto; o cliente também ignora o próprio (não escuta a si). Mantém presença
  (quem está online no canal).

## Onde mexer

| Quero mudar… | Arquivo |
|---|---|
| Captura/reprodução de áudio, taxa, tamanho do buffer | [`src/audio.ts`](src/audio.ts), [`public/pcm-worklet.js`](public/pcm-worklet.js) |
| Protocolo de rede / formato dos pacotes | [`src/net.ts`](src/net.ts) |
| Interface e lógica de PTT | [`src/main.ts`](src/main.ts), [`index.html`](index.html), [`src/styles.css`](src/styles.css) |
| Relay público (internet) | [`server/relay.mjs`](server/relay.mjs) |
| Relay LAN embutido (host) | [`src-tauri/src/relay.rs`](src-tauri/src/relay.rs) |
| Atalho global, bandeja, comandos Rust | [`src-tauri/src/lib.rs`](src-tauri/src/lib.rs) |

## Rodar no PC (dev)

```bash
npm install
npm run tauri dev
```

### Usar de qualquer lugar (internet)
1. Faça o deploy do relay (veja [`server/`](server/) — Render tem deploy de 1 clique grátis).
2. No app, em **SERVIDOR (RELAY)**, ponha `wss://SEU-RELAY` e escolha um **CANAL**.
3. **Conectar** nos dois aparelhos (qualquer rede) → segure pra falar.

### Usar na mesma WiFi (offline, sem servidor)
1. No aparelho A: clique **HOST LAN**. Ele mostra o endereço `ws://SEU-IP:7878`.
2. No aparelho B: ponha esse endereço em **SERVIDOR (RELAY)**, mesmo **CANAL**, **Conectar**.
3. Segure pra falar em um, ouça no outro.

> Na 1ª vez o **Firewall do Windows** pede pra liberar a porta — aceite (rede privada).
> Os dois precisam estar na **mesma WiFi**, sem "isolamento de clientes" (AP isolation).

## Testes

```bash
npm test            # testes do cliente (codec de áudio) — vitest
npm run test:server # testes do relay público — node --test
cargo test --manifest-path src-tauri/Cargo.toml   # testes do relay LAN (Rust)
```

Tudo roda também no CI a cada push (veja [`.github/workflows/test.yml`](.github/workflows/test.yml)).

### Build de release (PC)
```bash
npm run tauri build   # gera instalador .msi/.exe em src-tauri/target/release/bundle
```

## Android (fase 2 — app aberto)

Pré-requisitos no Windows: Android Studio (SDK + NDK), `ANDROID_HOME`/`NDK_HOME` no PATH,
celular com depuração USB.

```bash
npm run tauri android init     # gera o projeto Android
npm run tauri android dev      # roda no celular conectado
```

O workflow de release roda `bash scripts/setup-android-mic.sh` depois do init. Se
voce compilar Android manualmente apos gerar o projeto, rode o mesmo script antes
do build. Ele injeta `RECORD_AUDIO`, `INTERNET`, `ACCESS_NETWORK_STATE`,
`android:usesCleartextTraffic="true"` e a `MainActivity.kt` que concede o
microfone ao WebView.

Ainda falta (anotado no plano):
- **Fase futura:** serviço em *background* + botão de PTT na **barra de notificação**
  (precisa de código nativo Kotlin).

## iOS (precisa de macOS)

iOS só compila em **Mac com Xcode** (ou CI macOS). O mesmo código roda no iPhone; o build
é uma etapa separada:

```bash
npm run tauri ios init
npm run tauri ios dev
```

Lembrar de adicionar `NSMicrophoneUsageDescription` no Info.plist.
