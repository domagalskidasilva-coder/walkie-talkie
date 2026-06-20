// Testes de integração do relay LAN embutido.
//
// Sobem o servidor numa porta efêmera e conectam clientes WebSocket de verdade
// para validar a propriedade central: o áudio é entregue só para quem está na
// MESMA sala, e nunca de volta para quem enviou.

use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;

use tauri_app_lib::relay;

async fn join(ws_url: &str, room: &str, id: &str) -> tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>> {
    let (mut ws, _) = connect_async(ws_url).await.expect("conecta");
    let join = format!(r#"{{"t":"join","room":"{room}","id":"{id}","name":"{id}"}}"#);
    ws.send(Message::Text(join.into())).await.unwrap();
    ws
}

/// Recebe a próxima mensagem binária, ignorando textos de presença, com timeout.
async fn next_binary(
    ws: &mut tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
) -> Option<Vec<u8>> {
    loop {
        let msg = tokio::time::timeout(Duration::from_millis(800), ws.next()).await;
        match msg {
            Ok(Some(Ok(Message::Binary(b)))) => return Some(b.to_vec()),
            Ok(Some(Ok(_))) => continue, // texto de presença: ignora
            _ => return None,
        }
    }
}

#[tokio::test]
async fn audio_chega_na_mesma_sala_e_nao_volta_pro_remetente() {
    let relay = relay::start(0).await.expect("inicia relay");
    let url = format!("ws://127.0.0.1:{}", relay.port());

    let mut a = join(&url, "sala1", "aa").await;
    let mut b = join(&url, "sala1", "bb").await;
    // pequena folga para o join ser processado
    tokio::time::sleep(Duration::from_millis(150)).await;

    // "aa" fala: quadro = [idLen][id][pcm...]
    let mut frame = vec![2u8, b'a', b'a'];
    frame.extend_from_slice(&[1, 0, 2, 0, 3, 0]); // 3 amostras int16
    a.send(Message::Binary(frame.clone().into())).await.unwrap();

    // "bb" recebe
    let got = next_binary(&mut b).await.expect("bb recebe o áudio");
    assert_eq!(got, frame);

    // "aa" NÃO recebe o próprio áudio
    assert!(next_binary(&mut a).await.is_none(), "remetente não deve ouvir a si mesmo");

    relay.stop();
}

#[tokio::test]
async fn audio_nao_vaza_entre_salas() {
    let relay = relay::start(0).await.expect("inicia relay");
    let url = format!("ws://127.0.0.1:{}", relay.port());

    let mut a = join(&url, "sala-A", "aa").await;
    let mut c = join(&url, "sala-B", "cc").await;
    tokio::time::sleep(Duration::from_millis(150)).await;

    let mut frame = vec![2u8, b'a', b'a'];
    frame.extend_from_slice(&[9, 0]);
    a.send(Message::Binary(frame.into())).await.unwrap();

    // "cc" está em outra sala: não recebe nada
    assert!(next_binary(&mut c).await.is_none(), "áudio não pode vazar entre salas");

    relay.stop();
}
