// Servidor de relay do walkie-talkie.
//
// Quando um aparelho vira "host", ele liga este servidor WebSocket em
// 0.0.0.0:PORTA. Cada cliente (inclusive o frontend do próprio host) conecta
// nele. O servidor é "burro": tudo que um cliente envia (áudio binário ou
// texto/JSON de presença) é reenviado para TODOS os outros clientes — menos
// para quem mandou (sem eco). Quem fala identifica seus pacotes com um id, e
// o frontend ignora os pacotes com o próprio id.

use std::collections::HashMap;
use std::sync::Arc;

use futures_util::{SinkExt, StreamExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};
use tokio::sync::Mutex;
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;
use tokio_util::sync::CancellationToken;

/// Mapa de conexões ativas: id da conexão -> canal de envio para aquele cliente.
type Peers = Arc<Mutex<HashMap<usize, UnboundedSender<Message>>>>;

/// Handle guardado no estado do app enquanto o host está no ar.
pub struct Relay {
    token: CancellationToken,
}

impl Relay {
    /// Desliga o host: cancela o loop de accept e todas as conexões.
    pub fn stop(self) {
        self.token.cancel();
    }
}

/// Estado gerenciado pelo Tauri (`app.manage`). Guarda o relay quando ativo.
#[derive(Default)]
pub struct HostState(pub std::sync::Mutex<Option<Relay>>);

/// Liga o servidor na porta dada. Retorna erro se a porta já estiver em uso.
pub async fn start(port: u16) -> std::io::Result<Relay> {
    let listener = TcpListener::bind(("0.0.0.0", port)).await?;
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

    Ok(Relay { token })
}

/// Trata uma conexão: lê mensagens e reenvia para os outros peers.
async fn handle_conn(stream: TcpStream, id: usize, peers: Peers, token: CancellationToken) {
    let ws = match accept_async(stream).await {
        Ok(ws) => ws,
        Err(_) => return,
    };
    let (mut sink, mut source) = ws.split();

    // Canal por cliente: outras conexões empurram mensagens aqui; uma task
    // dedicada escreve no socket.
    let (tx, mut rx) = unbounded_channel::<Message>();
    peers.lock().await.insert(id, tx);

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
                    Some(Ok(m)) if m.is_binary() || m.is_text() => {
                        let guard = peers.lock().await;
                        for (peer_id, peer_tx) in guard.iter() {
                            if *peer_id != id {
                                let _ = peer_tx.send(m.clone());
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(_)) => break,
                    _ => {} // ping/pong/outros: ignora
                }
            }
        }
    }

    peers.lock().await.remove(&id);
    send_task.abort();
}
