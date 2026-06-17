mod relay;

use tauri::State;

/// Liga o servidor de relay (este aparelho vira o "host").
#[tauri::command]
async fn start_host(port: u16, state: State<'_, relay::HostState>) -> Result<(), String> {
    {
        let guard = state.0.lock().map_err(|e| e.to_string())?;
        if guard.is_some() {
            return Err("O host já está ativo.".into());
        }
    }
    let r = relay::start(port)
        .await
        .map_err(|e| format!("Não consegui abrir a porta {port}: {e}"))?;
    *state.0.lock().map_err(|e| e.to_string())? = Some(r);
    Ok(())
}

/// Desliga o servidor de relay.
#[tauri::command]
fn stop_host(state: State<'_, relay::HostState>) -> Result<(), String> {
    if let Some(r) = state.0.lock().map_err(|e| e.to_string())?.take() {
        r.stop();
    }
    Ok(())
}

/// Descobre o IP local deste aparelho na rede WiFi (para os outros conectarem).
#[tauri::command]
fn get_local_ip() -> String {
    local_ip_address::local_ip()
        .map(|ip| ip.to_string())
        .unwrap_or_else(|_| "127.0.0.1".to_string())
}

/// Registra a tecla de push-to-talk (desktop). Solta a anterior antes.
#[cfg(desktop)]
#[tauri::command]
fn register_ptt(app: tauri::AppHandle, key: String) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let shortcut: tauri_plugin_global_shortcut::Shortcut =
        key.parse().map_err(|_| format!("Tecla inválida: {key}"))?;
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    gs.register(shortcut).map_err(|e| e.to_string())
}

/// No celular não há atalho global; o push-to-talk é o botão da tela.
#[cfg(not(desktop))]
#[tauri::command]
fn register_ptt(_key: String) -> Result<(), String> {
    Ok(())
}

/// Configuração só de desktop: atalho global de PTT + bandeja do sistema.
#[cfg(desktop)]
fn setup_desktop(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::Emitter;
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

    // Quando a tecla de PTT é pressionada/solta, avisa o frontend.
    app.handle().plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(|app, _shortcut, event| {
                let evt = match event.state() {
                    ShortcutState::Pressed => "ptt-down",
                    ShortcutState::Released => "ptt-up",
                };
                let _ = app.emit(evt, ());
            })
            .build(),
    )?;

    // Tecla padrão: F8 (trocável na UI via comando register_ptt).
    if let Ok(shortcut) = "F8".parse::<tauri_plugin_global_shortcut::Shortcut>() {
        let _ = app.global_shortcut().register(shortcut);
    }

    setup_tray(app)?;
    Ok(())
}

/// Ícone na bandeja com menu "Mostrar" / "Sair".
#[cfg(desktop)]
fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder};
    use tauri::tray::TrayIconBuilder;
    use tauri::Manager;

    let show = MenuItemBuilder::with_id("show", "Mostrar").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Sair").build(app)?;
    let menu = MenuBuilder::new(app).items(&[&show, &quit]).build()?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .tooltip("Walkie-Talkie")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "quit" => app.exit(0),
            "show" => {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
            _ => {}
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(relay::HostState::default())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(desktop)]
            setup_desktop(app)?;
            let _ = app;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Desktop: fechar a janela esconde para a bandeja em vez de sair.
            #[cfg(desktop)]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
            let _ = (window, event);
        })
        .invoke_handler(tauri::generate_handler![
            start_host,
            stop_host,
            get_local_ip,
            register_ptt
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
