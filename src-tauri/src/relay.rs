// Servidor de relay LAN embutido (modo "host nesta máquina", offline).
//
// Mesmo protocolo do relay público (server/): clientes mandam um JSON de
// `join` com {room,id,name}; depois mandam quadros de áudio binários. O relay
// só reenvia áudio para quem está na MESMA sala (menos o remetente) e mantém
// presença (roster/join/leave). Para uso na mesma WiFi sem internet.

use std::collections::HashMap;
use std::sync::Arc;

use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};
use tokio::sync::Mutex;
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;
use tokio_util::sync::CancellationToken;

struct Peer {
    tx: UnboundedSender<Message>,
    room: String,
    id: String,
    name: String,
}

type Peers = Arc<Mutex<HashMap<usize, Peer>>>;

/// Handle do relay enquanto está no ar (guardado no estado do app).
pub struct Relay {
    token: CancellationToken,
    port: u16,
}

impl Relay {
    pub fn port(&self) -> u16 {
        self.port
    }
    pub fn stop(self) {
        self.token.cancel();
    }
}

/// Estado gerenciado pelo Tauri (`app.manage`).
#[derive(Default)]
pub struct HostState(pub std::sync::Mutex<Option<Relay>>);

/// Liga o servidor na porta dada (use 0 para porta efêmera, útil em testes).
pub async fn start(port: u16) -> std::io::Result<Relay> {
    let listener = TcpListener::bind(("0.0.0.0", port)).await?;
    let bound_port = listener.local_addr()?.port();
    let token = CancellationToken::new();
    let peers: Peers = Arc::new(Mutex::new(HashMap::new()));

    let accept_token = token.clone();
    tauri::async_runtime::spawn(async move {
        let mut next_id: usize = 0;
        loop {
            tokio::select! {
                _ = accept_token.cancelled() => break,
                accepted = listener.accept() => {
                    let Ok((stream, _addr)) = accepted else { continue };
                    let id = next_id;
                    next_id += 1;
                    let peers = peers.clone();
                    let conn_token = accept_token.clone();
                    tauri::async_runtime::spawn(handle_conn(stream, id, peers, conn_token));
                }
            }
        }
    });

    Ok(Relay { token, port: bound_port })
}

async fn handle_conn(stream: TcpStream, id: usize, peers: Peers, token: CancellationToken) {
    let ws = match accept_async(stream).await {
        Ok(ws) => ws,
        Err(_) => return,
    };
    let (mut sink, mut source) = ws.split();
    let (tx, mut rx) = unbounded_channel::<Message>();

    peers.lock().await.insert(
        id,
        Peer { tx, room: String::new(), id: String::new(), name: String::new() },
    );

    let send_task = tauri::async_runtime::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if sink.send(msg).await.is_err() {
                break;
            }
        }
    });

    loop {
        tokio::select! {
            _ = token.cancelled() => break,
            msg = source.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => handle_text(&peers, id, text.as_str()).await,
                    Some(Ok(Message::Binary(bin))) => {
                        forward_audio(&peers, id, Message::Binary(bin)).await;
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(_)) => break,
                    _ => {} // ping/pong: tratados pela tungstenite
                }
            }
        }
    }

    // Saída: remove e avisa a sala.
    let gone = peers.lock().await.remove(&id);
    if let Some(p) = gone {
        if !p.room.is_empty() && !p.id.is_empty() {
            let leave = json!({ "t": "leave", "id": p.id }).to_string();
            broadcast_text(&peers, &p.room, usize::MAX, leave).await;
        }
    }
    send_task.abort();
}

/// Processa um JSON do cliente. Só nos importamos com o `join`.
async fn handle_text(peers: &Peers, id: usize, text: &str) {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(text) else { return };
    if v.get("t").and_then(|t| t.as_str()) != Some("join") {
        return;
    }
    let room = v.get("room").and_then(|x| x.as_str()).unwrap_or("").to_string();
    let pid = v.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string();
    let name = v.get("name").and_then(|x| x.as_str()).unwrap_or("").to_string();
    if room.is_empty() || pid.is_empty() {
        return;
    }

    // Roster dos que já estão na sala -> envia para o recém-chegado.
    // Atualiza a entrada do próprio e forwarda o join para os outros.
    let mut guard = peers.lock().await;
    let mut roster: Vec<serde_json::Value> = Vec::new();
    for (other_id, p) in guard.iter() {
        if *other_id != id && p.room == room && !p.id.is_empty() {
            roster.push(json!({ "id": p.id, "name": p.name }));
        }
    }
    if let Some(me) = guard.get_mut(&id) {
        me.room = room.clone();
        me.id = pid.clone();
        me.name = name.clone();
        let _ = me.tx.send(Message::Text(
            json!({ "t": "roster", "peers": roster }).to_string().into(),
        ));
    }
    let join_msg = json!({ "t": "join", "id": pid, "name": name }).to_string();
    for (other_id, p) in guard.iter() {
        if *other_id != id && p.room == room {
            let _ = p.tx.send(Message::Text(join_msg.clone().into()));
        }
    }
}

/// Reenvia um quadro de áudio para os peers da mesma sala (menos o remetente).
async fn forward_audio(peers: &Peers, sender: usize, msg: Message) {
    let guard = peers.lock().await;
    let room = match guard.get(&sender) {
        Some(p) if !p.room.is_empty() => p.room.clone(),
        _ => return,
    };
    for (peer_id, p) in guard.iter() {
        if *peer_id != sender && p.room == room {
            let _ = p.tx.send(msg.clone());
        }
    }
}

/// Envia um texto para todos da sala (exceto `except`).
async fn broadcast_text(peers: &Peers, room: &str, except: usize, text: String) {
    let guard = peers.lock().await;
    for (peer_id, p) in guard.iter() {
        if *peer_id != except && p.room == room {
            let _ = p.tx.send(Message::Text(text.clone().into()));
        }
    }
}
