# 📻 Walkie-Talkie (Tauri 2)

Walkie-talkie de voz por **WiFi** (mesma rede local), em **PC, Android e iOS**, feito
em Tauri 2. Push-to-talk: **segura pra falar, solta pra ouvir** (half-duplex).

- **PC:** fala segurando uma **tecla** (padrão `F8`, funciona até com o app minimizado)
  ou a **barra de espaço** com a janela aberta. O app vai pra **bandeja** ao fechar.
- **Celular:** fala segurando o **botão grande** na tela.
- **Rede:** um aparelho vira **host** (servidor de relay) e os outros conectam pelo
  **IP** dele. Sem internet — tudo dentro da WiFi.

## Como funciona (visão rápida)

```
 Cliente A ──ws──►  HOST (relay WebSocket em Rust)  ◄──ws── Cliente B
 Cliente A ◄─ws──   reenvia o áudio pros outros     ──ws─►  Cliente B
```

- Áudio é capturado/reproduzido no frontend com a **Web Audio API** (PCM int16, 48 kHz).
- O host (`src-tauri/src/relay.rs`) só reenvia cada pacote pra todo mundo, menos pra quem
  mandou. Cada pacote leva um `id` curto; o cliente ignora o próprio (não escuta a si).

## Onde mexer

| Quero mudar… | Arquivo |
|---|---|
| Captura/reprodução de áudio, taxa, tamanho do buffer | [`src/audio.ts`](src/audio.ts), [`public/pcm-worklet.js`](public/pcm-worklet.js) |
| Protocolo de rede / formato dos pacotes | [`src/net.ts`](src/net.ts) |
| Interface e lógica de PTT | [`src/main.ts`](src/main.ts), [`index.html`](index.html), [`src/styles.css`](src/styles.css) |
| Servidor de relay (host) | [`src-tauri/src/relay.rs`](src-tauri/src/relay.rs) |
| Atalho global, bandeja, comandos Rust | [`src-tauri/src/lib.rs`](src-tauri/src/lib.rs) |

## Rodar no PC (dev)

```bash
npm install
npm run tauri dev
```

### Testar com 2 aparelhos
1. No aparelho A: clique **Ser host** (porta padrão `7878`).
2. Anote o IP mostrado em "Seu IP nesta rede".
3. No aparelho B: digite esse IP no campo **IP do host**, mesma porta, **Conectar**.
4. Segure pra falar em um, ouça no outro.

> No primeiro uso o **Firewall do Windows** vai perguntar se libera a porta — aceite
> (redes privadas). Os dois aparelhos precisam estar na **mesma WiFi** e a rede não pode
> ter "isolamento de clientes" (AP isolation) ligado.

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

Ainda falta (anotado no plano):
- Permissões `RECORD_AUDIO` e `INTERNET` no `AndroidManifest.xml`.
- Tratar o pedido de microfone do WebView (`onPermissionRequest`).
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
